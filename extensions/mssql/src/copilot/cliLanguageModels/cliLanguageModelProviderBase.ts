/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import { SpawnOptionsWithoutStdio } from "child_process";
import { logger2 } from "../../models/logger2";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import { sendActionEvent } from "../../telemetry/telemetry";
import {
    LanguageModelChatInformation,
    ProviderModelEntry,
    toLanguageModelChatInformation,
} from "../languageModels/shared/providerModelCatalog";
import { approximateTokenCount } from "../languageModels/shared/tokenApproximation";
import {
    classifyCliError,
    CliProviderErrorClass,
    mapCliExitToLanguageModelError,
    mapSpawnErrorToLanguageModelError,
    sanitizeCliErrorMessage,
} from "./cliErrors";
import {
    CliChildProcess,
    CliProcessFactory,
    killCliProcess,
    spawnCliProcess,
    StreamTextCollector,
    StreamYield,
    streamCliJsonl,
    waitForExit,
} from "./cliInvocation";
import { CliBinaryResolution, CliProviderEnvironment, CliProviderKind } from "./cliEnvironment";
import { getCliModelCatalog } from "./cliModelCatalog";

export type { LanguageModelChatInformation } from "../languageModels/shared/providerModelCatalog";

export interface LanguageModelChatResponseProgress {
    report(part: vscode.LanguageModelTextPart): void;
}

export interface CliInvocation {
    args: string[];
    stdin?: string;
}

export interface CliLanguageModelProviderOptions {
    environment: CliProviderEnvironment;
    processFactory?: CliProcessFactory;
}

interface PrepareCache {
    expiresAt: number;
    key: string;
    models: LanguageModelChatInformation[];
}

interface ProviderUsage {
    input: number;
    output: number;
}

const prepareCacheTtlMs = 30_000;

export abstract class CliLanguageModelProviderBase {
    private readonly _logger = logger2.withPrefix("CliLanguageModelProvider");
    private readonly _processFactory: CliProcessFactory;
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private _prepareCache: PrepareCache | undefined;
    public readonly onDidChange = this._onDidChange.event;
    public readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

    protected constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly vendor: "anthropic-cli" | "openai-cli",
        protected readonly kind: CliProviderKind,
        protected readonly environment: CliProviderEnvironment,
        options?: Pick<CliLanguageModelProviderOptions, "processFactory">,
    ) {
        this._processFactory = options?.processFactory ?? spawnCliProcess;
        this.context.subscriptions.push(
            this._onDidChange,
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("mssql.copilot.cliProviders")) {
                    this.invalidateCache();
                    this._logger.info(
                        "CLI language model provider settings changed; reload may be required " +
                            "for enable/disable changes to affect provider registration.",
                    );
                }
            }),
        );
    }

    public invalidateCache(): void {
        this._prepareCache = undefined;
        this.environment.invalidateCache();
        this._onDidChange.fire();
    }

    public async prepareLanguageModelChat(
        _options: unknown,
        token: vscode.CancellationToken,
    ): Promise<LanguageModelChatInformation[]> {
        if (token.isCancellationRequested || !this.environment.isEnabled()) {
            return [];
        }

        const resolved = await this.environment.resolveBinaryPath();
        if (!resolved || token.isCancellationRequested) {
            return [];
        }

        const cacheKey = `${resolved.path}|${this.kind}`;
        if (
            this._prepareCache &&
            this._prepareCache.key === cacheKey &&
            this._prepareCache.expiresAt > Date.now()
        ) {
            return [...this._prepareCache.models];
        }

        if (!(await this.environment.isAuthenticated()) || token.isCancellationRequested) {
            return [];
        }

        const models = getCliModelCatalog(this.kind).map((entry) =>
            this.toLanguageModelChatInformation(entry),
        );
        this._prepareCache = {
            key: cacheKey,
            expiresAt: Date.now() + prepareCacheTtlMs,
            models,
        };
        return [...models];
    }

    public provideLanguageModelChatInformation(
        options: unknown,
        token: vscode.CancellationToken,
    ): Promise<LanguageModelChatInformation[]> {
        return this.prepareLanguageModelChat(options, token);
    }

    public async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        progress: LanguageModelChatResponseProgress,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const startedAt = Date.now();
        const resolved = await this.environment.resolveBinaryPath();
        if (!resolved) {
            this.sendErrorTelemetry("spawn");
            throw vscode.LanguageModelError.NotFound(`${this.vendor} CLI binary was not found.`);
        }

        const invocation = this.buildInvocation(model, messages, options);
        const parser = this.createEventParser();
        const child = this.spawn(resolved, invocation);
        const stderr = new StreamTextCollector(child.stderr);
        const exit = waitForExit(child);
        let usage: ProviderUsage | undefined;
        let result: "success" | "error" | "cancelled" = "success";

        const cancellationDisposable = token.onCancellationRequested(() => {
            result = "cancelled";
            killCliProcess(child);
        });

        try {
            if (invocation.stdin !== undefined) {
                child.stdin.end(invocation.stdin);
            } else {
                child.stdin.end();
            }

            for await (const yielded of streamCliJsonl(child, parser)) {
                if (token.isCancellationRequested) {
                    break;
                }

                if (yielded.kind === "text") {
                    progress.report(new vscode.LanguageModelTextPart(yielded.value));
                } else if (yielded.kind === "usage") {
                    usage = { input: yielded.input, output: yielded.output };
                } else {
                    result = "error";
                    this.sendErrorTelemetry("other");
                    throw new vscode.LanguageModelError(sanitizeCliErrorMessage(yielded.message));
                }
            }
        } catch (error) {
            if (token.isCancellationRequested) {
                result = "cancelled";
            } else {
                result = "error";
                if (!child.killed) {
                    child.kill("SIGTERM");
                }
                if (error instanceof vscode.LanguageModelError) {
                    throw error;
                }
                this.sendErrorTelemetry("parse");
                throw error;
            }
        } finally {
            cancellationDisposable.dispose();
        }

        const exitResult = await exit.catch((error) => {
            result = "error";
            this.sendErrorTelemetry("spawn");
            throw mapSpawnErrorToLanguageModelError(error);
        });
        const stderrText = await stderr.waitForEnd();

        if (token.isCancellationRequested) {
            result = "cancelled";
            await this.sendInvocationTelemetry(model, resolved, startedAt, result, usage);
            return;
        }

        if (exitResult.code !== 0) {
            result = "error";
            const errorClass = classifyCliError(stderrText);
            this.sendErrorTelemetry(errorClass);
            await this.sendInvocationTelemetry(model, resolved, startedAt, result, usage);
            throw mapCliExitToLanguageModelError(exitResult.code, stderrText);
        }

        await this.sendInvocationTelemetry(model, resolved, startedAt, result, usage);
    }

    public async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatMessage,
        token: vscode.CancellationToken,
    ): Promise<number> {
        if (token.isCancellationRequested) {
            return 0;
        }

        return approximateTokenCount(
            typeof text === "string" ? text : getTextFromMessage(text, this.vendor),
        );
    }

    protected abstract buildInvocation(
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
    ): CliInvocation;

    protected abstract createEventParser(): (
        event: unknown,
    ) => StreamYield | StreamYield[] | undefined;

    protected getModelId(model: LanguageModelChatInformation): string {
        return model.id.startsWith(`${this.vendor}/`)
            ? model.id.slice(this.vendor.length + 1)
            : model.id;
    }

    private toLanguageModelChatInformation(
        entry: ProviderModelEntry,
    ): LanguageModelChatInformation {
        return toLanguageModelChatInformation(this.vendor, entry);
    }

    private spawn(resolved: CliBinaryResolution, invocation: CliInvocation): CliChildProcess {
        const spawnOptions: SpawnOptionsWithoutStdio = {
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir(),
            env: this.environment.getEnv(),
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
        };
        return this._processFactory(resolved.path, invocation.args, spawnOptions);
    }

    private async sendInvocationTelemetry(
        model: LanguageModelChatInformation,
        resolved: CliBinaryResolution,
        startedAt: number,
        result: "success" | "error" | "cancelled",
        usage: ProviderUsage | undefined,
    ): Promise<void> {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.CliProviderInvocation, {
            vendor: this.vendor,
            family: model.family,
            latencyBucket: getLatencyBucket(Date.now() - startedAt),
            result,
            binaryPathSource: resolved.source,
            cliVersionMajor: await this.environment.getVersionMajor(),
            inputTokenBucket: usage ? getTokenBucket(usage.input) : "unknown",
            outputTokenBucket: usage ? getTokenBucket(usage.output) : "unknown",
        });
    }

    private sendErrorTelemetry(errorClass: CliProviderErrorClass): void {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.CliProviderError, {
            vendor: this.vendor,
            errorClass,
        });
    }
}

export function getTextFromMessage(
    message: vscode.LanguageModelChatMessage,
    vendor: string,
): string {
    return message.content
        .map((part) => {
            if (part instanceof vscode.LanguageModelTextPart) {
                return part.value;
            }

            throw new vscode.LanguageModelError(
                `${vendor} CLI providers support only text message parts.`,
            );
        })
        .join("");
}

function getLatencyBucket(latencyMs: number): string {
    if (latencyMs < 100) {
        return "<100";
    }
    if (latencyMs < 300) {
        return "100-300";
    }
    if (latencyMs < 800) {
        return "300-800";
    }
    if (latencyMs < 2000) {
        return "800-2000";
    }
    return "2000+";
}

function getTokenBucket(tokens: number): string {
    if (tokens < 1000) {
        return "<1k";
    }
    if (tokens < 4000) {
        return "1k-4k";
    }
    if (tokens < 16000) {
        return "4k-16k";
    }
    if (tokens < 64000) {
        return "16k-64k";
    }
    return "64k+";
}
