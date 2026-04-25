/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio, spawn } from "child_process";
import * as readline from "readline";
import { Writable } from "stream";
import { logger2 } from "../../models/logger2";

export type StreamYield =
    | { kind: "text"; value: string }
    | { kind: "usage"; input: number; output: number }
    | { kind: "error"; message: string };

export interface CliChildProcess {
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: Writable;
    killed: boolean;
    kill(signal?: NodeJS.Signals | number): boolean;
    once(
        event: "exit",
        listener: (code: number | null, signal: NodeJS.Signals | null) => void,
    ): this;
    once(event: "error", listener: (error: Error) => void): this;
}

export type CliProcessFactory = (
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio,
) => CliChildProcess;

const logger = logger2.withPrefix("CliLanguageModelInvocation");

export function spawnCliProcess(
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
    return spawn(command, args, {
        ...options,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
    });
}

export async function* streamCliJsonl(
    child: Pick<CliChildProcess, "stdout">,
    parser: (event: unknown) => StreamYield | StreamYield[] | undefined,
): AsyncIterable<StreamYield> {
    const lines = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
    });

    for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            logger.debug(`Skipping malformed CLI JSONL line: ${error}`);
            continue;
        }

        const yielded = parser(parsed);
        if (!yielded) {
            continue;
        }

        if (Array.isArray(yielded)) {
            for (const item of yielded) {
                yield item;
            }
        } else {
            yield yielded;
        }
    }
}

export function waitForExit(
    child: Pick<CliChildProcess, "once">,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
    });
}

export class StreamTextCollector {
    private _text = "";
    private readonly _done: Promise<void>;

    constructor(
        stream: NodeJS.ReadableStream,
        private readonly _maxLength: number = 4096,
    ) {
        this._done = new Promise((resolve) => {
            stream.on("data", (chunk: Buffer | string) => {
                if (this._text.length >= this._maxLength) {
                    return;
                }

                const next = typeof chunk === "string" ? chunk : chunk.toString("utf8");
                this._text = `${this._text}${next}`.slice(0, this._maxLength);
            });
            stream.on("end", resolve);
            stream.on("close", resolve);
            stream.on("error", resolve);
        });
    }

    public get text(): string {
        return this._text;
    }

    public async waitForEnd(): Promise<string> {
        await this._done;
        return this._text;
    }
}

export function killCliProcess(child: CliChildProcess, forceAfterMs: number = 2000): void {
    if (!child.killed) {
        child.kill("SIGTERM");
    }

    const timer = setTimeout(() => {
        if (!child.killed) {
            child.kill("SIGKILL");
        }
    }, forceAfterMs);
    timer.unref?.();
}
