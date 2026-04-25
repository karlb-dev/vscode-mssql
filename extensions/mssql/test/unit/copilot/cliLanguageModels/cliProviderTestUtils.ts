/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from "events";
import { SpawnOptionsWithoutStdio } from "child_process";
import { PassThrough } from "stream";
import * as vscode from "vscode";
import {
    CliBinaryResolution,
    CliProviderEnvironment,
} from "../../../../src/copilot/cliLanguageModels/cliEnvironment";
import {
    CliChildProcess,
    CliProcessFactory,
} from "../../../../src/copilot/cliLanguageModels/cliInvocation";

export class FakeCliProcess extends EventEmitter implements CliChildProcess {
    public readonly stdout = new PassThrough();
    public readonly stderr = new PassThrough();
    public readonly stdin = new PassThrough();
    public readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];
    public killed = false;

    public kill(signal?: NodeJS.Signals | number): boolean {
        this.killSignals.push(signal);
        this.killed = true;
        setImmediate(() => {
            this.stdout.end();
            this.stderr.end();
            this.emit("exit", null, typeof signal === "string" ? signal : null);
        });
        return true;
    }

    public writeJsonLine(value: unknown): void {
        this.stdout.write(`${JSON.stringify(value)}\n`);
    }

    public writeStdoutLine(value: string): void {
        this.stdout.write(`${value}\n`);
    }

    public writeStderr(value: string): void {
        this.stderr.write(value);
    }

    public finish(code: number | null = 0): void {
        this.stdout.end();
        this.stderr.end();
        setImmediate(() => this.emit("exit", code, null));
    }
}

export interface CapturedSpawn {
    command: string;
    args: string[];
    options: SpawnOptionsWithoutStdio;
    process: FakeCliProcess;
}

export function createCapturingProcessFactory(
    onSpawn: (process: FakeCliProcess, captured: CapturedSpawn) => void,
    captures: CapturedSpawn[],
): CliProcessFactory {
    return (command, args, options) => {
        const process = new FakeCliProcess();
        const captured = { command, args, options, process };
        captures.push(captured);
        setImmediate(() => onSpawn(process, captured));
        return process;
    };
}

export class FakeCliEnvironment implements CliProviderEnvironment {
    public enabled = true;
    public authenticated = true;
    public resolved: CliBinaryResolution | undefined = {
        path: "/tmp/fake-cli",
        source: "configured",
    };
    public extraArgs: string[] = [];
    public env: NodeJS.ProcessEnv = {};
    public versionMajor = "1";
    public invalidated = false;

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async resolveBinaryPath(): Promise<CliBinaryResolution | undefined> {
        return this.resolved;
    }

    public async isAvailable(): Promise<boolean> {
        return !!this.resolved;
    }

    public async isAuthenticated(): Promise<boolean> {
        return this.authenticated;
    }

    public getExtraArgs(): string[] {
        return this.extraArgs;
    }

    public getEnv(): NodeJS.ProcessEnv {
        return this.env;
    }

    public async getVersionMajor(): Promise<string> {
        return this.versionMajor;
    }

    public invalidateCache(): void {
        this.invalidated = true;
    }
}

export function createExtensionContext(): vscode.ExtensionContext {
    return {
        subscriptions: [],
    } as unknown as vscode.ExtensionContext;
}

export function textOf(parts: vscode.LanguageModelTextPart[]): string {
    return parts.map((part) => part.value).join("");
}
