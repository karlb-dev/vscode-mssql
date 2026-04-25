/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { logger2 } from "../../models/logger2";
import { spawnCliProcess } from "./cliInvocation";

export type CliProviderKind = "anthropic" | "codex";
export type CliBinaryPathSource = "auto" | "configured";

export interface CliBinaryResolution {
    path: string;
    source: CliBinaryPathSource;
}

export interface CliProviderEnvironment {
    isEnabled(): boolean;
    resolveBinaryPath(): Promise<CliBinaryResolution | undefined>;
    isAvailable(): Promise<boolean>;
    isAuthenticated(): Promise<boolean>;
    getExtraArgs(): string[];
    getEnv(): NodeJS.ProcessEnv;
    getVersionMajor(): Promise<string>;
    invalidateCache(): void;
}

interface CliProviderEnvironmentOptions {
    kind: CliProviderKind;
    binaryName: string;
    pathSetting: string;
    enabledSetting: string;
    extraArgsSetting: string;
    envSetting: string;
}

interface TimedCache<T> {
    value: T;
    expiresAt: number;
}

const cacheTtlMs = 30_000;
const commandTimeoutMs = 5000;
const logger = logger2.withPrefix("CliLanguageModelEnvironment");

export class CliEnvironment implements CliProviderEnvironment {
    private _binaryCache: TimedCache<CliBinaryResolution | undefined> | undefined;
    private _authCache: TimedCache<boolean> | undefined;
    private _versionMajorCache: string | undefined;

    constructor(private readonly _options: CliProviderEnvironmentOptions) {}

    public isEnabled(): boolean {
        return (
            vscode.workspace.getConfiguration().get<boolean>(this._options.enabledSetting, false) ??
            false
        );
    }

    public async resolveBinaryPath(): Promise<CliBinaryResolution | undefined> {
        if (this._binaryCache && this._binaryCache.expiresAt > Date.now()) {
            return this._binaryCache.value;
        }

        const configuredPath = this.getConfiguredPath();
        const value = configuredPath
            ? await resolveConfiguredPath(configuredPath)
            : await resolveAutoPath(this._options.binaryName);
        this._binaryCache = {
            value: value
                ? {
                      path: value,
                      source: configuredPath ? "configured" : "auto",
                  }
                : undefined,
            expiresAt: Date.now() + cacheTtlMs,
        };
        return this._binaryCache.value;
    }

    public async isAvailable(): Promise<boolean> {
        return !!(await this.resolveBinaryPath());
    }

    public async isAuthenticated(): Promise<boolean> {
        if (this._authCache && this._authCache.expiresAt > Date.now()) {
            return this._authCache.value;
        }

        const resolved = await this.resolveBinaryPath();
        if (!resolved) {
            return false;
        }

        const authenticated =
            this._options.kind === "codex"
                ? await this.checkCodexAuthentication(resolved.path)
                : await this.checkAnthropicAuthentication(resolved.path);

        this._authCache = {
            value: authenticated,
            expiresAt: Date.now() + cacheTtlMs,
        };
        return authenticated;
    }

    public getExtraArgs(): string[] {
        const configured =
            vscode.workspace.getConfiguration().get<unknown>(this._options.extraArgsSetting, []) ??
            [];
        return Array.isArray(configured)
            ? configured.filter((value): value is string => typeof value === "string")
            : [];
    }

    public getEnv(): NodeJS.ProcessEnv {
        const configured =
            vscode.workspace
                .getConfiguration()
                .get<Record<string, unknown>>(this._options.envSetting, {}) ?? {};
        const env: NodeJS.ProcessEnv = { ...process.env };

        for (const [key, value] of Object.entries(configured)) {
            if (typeof value === "string") {
                env[key] = value;
            }
        }

        if (this._options.kind === "anthropic") {
            env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
        }

        return env;
    }

    public async getVersionMajor(): Promise<string> {
        if (this._versionMajorCache) {
            return this._versionMajorCache;
        }

        const resolved = await this.resolveBinaryPath();
        if (!resolved) {
            return "unknown";
        }

        const result = await runCliCommand(resolved.path, ["--version"], this.getEnv());
        this._versionMajorCache = extractVersionMajor(`${result.stdout}\n${result.stderr}`);
        return this._versionMajorCache;
    }

    public invalidateCache(): void {
        this._binaryCache = undefined;
        this._authCache = undefined;
        this._versionMajorCache = undefined;
    }

    private getConfiguredPath(): string | undefined {
        return (
            vscode.workspace
                .getConfiguration()
                .get<string>(this._options.pathSetting, "")
                ?.trim() || undefined
        );
    }

    private async checkAnthropicAuthentication(binaryPath: string): Promise<boolean> {
        const result = await runCliCommand(binaryPath, ["--version"], this.getEnv());
        return result.exitCode === 0;
    }

    private async checkCodexAuthentication(binaryPath: string): Promise<boolean> {
        const status = await runCliCommand(binaryPath, ["login", "status"], this.getEnv());
        if (status.exitCode === 0) {
            return true;
        }

        const stderr = `${status.stdout}\n${status.stderr}`.toLowerCase();
        if (
            stderr.includes("unknown command") ||
            stderr.includes("unrecognized") ||
            stderr.includes("invalid subcommand")
        ) {
            const version = await runCliCommand(binaryPath, ["--version"], this.getEnv());
            return version.exitCode === 0;
        }

        return false;
    }
}

export function createAnthropicEnvironment(): CliEnvironment {
    return new CliEnvironment({
        kind: "anthropic",
        binaryName: "claude",
        pathSetting: Constants.configCopilotCliProvidersAnthropicPath,
        enabledSetting: Constants.configCopilotCliProvidersAnthropicEnabled,
        extraArgsSetting: Constants.configCopilotCliProvidersAnthropicExtraArgs,
        envSetting: Constants.configCopilotCliProvidersAnthropicEnv,
    });
}

export function createCodexEnvironment(): CliEnvironment {
    return new CliEnvironment({
        kind: "codex",
        binaryName: "codex",
        pathSetting: Constants.configCopilotCliProvidersCodexPath,
        enabledSetting: Constants.configCopilotCliProvidersCodexEnabled,
        extraArgsSetting: Constants.configCopilotCliProvidersCodexExtraArgs,
        envSetting: Constants.configCopilotCliProvidersCodexEnv,
    });
}

async function resolveConfiguredPath(configuredPath: string): Promise<string | undefined> {
    return (await isExecutable(configuredPath)) ? configuredPath : undefined;
}

async function resolveAutoPath(binaryName: string): Promise<string | undefined> {
    const home = os.homedir();
    const probes = [
        `/opt/homebrew/bin/${binaryName}`,
        `/usr/local/bin/${binaryName}`,
        home ? path.join(home, ".npm-global", "bin", binaryName) : undefined,
        home ? path.join(home, ".local", "bin", binaryName) : undefined,
        ...getPathCandidates(binaryName),
    ].filter((value): value is string => !!value);

    for (const candidate of probes) {
        if (await isExecutable(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function getPathCandidates(binaryName: string): string[] {
    const pathValue = process.env.PATH ?? "";
    return pathValue
        .split(path.delimiter)
        .filter(Boolean)
        .map((entry) => path.join(entry, binaryName));
}

async function isExecutable(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

async function runCliCommand(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const child = spawnCliProcess(command, args, {
            cwd: os.tmpdir(),
            env,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
        });

        const finish = (exitCode: number | null) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve({ exitCode, stdout, stderr });
        };

        const timer = setTimeout(() => {
            logger.debug(`Timed out probing ${path.basename(command)} ${args.join(" ")}`);
            child.kill("SIGTERM");
            finish(null);
        }, commandTimeoutMs);
        timer.unref?.();

        child.stdout.on("data", (chunk: Buffer | string) => {
            stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer | string) => {
            stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });
        child.once("error", () => {
            clearTimeout(timer);
            finish(null);
        });
        child.once("exit", (code) => {
            clearTimeout(timer);
            finish(code);
        });
    });
}

function extractVersionMajor(versionText: string): string {
    const match = /\b(\d+)(?:\.\d+){0,3}\b/.exec(versionText);
    return match?.[1] ?? "unknown";
}
