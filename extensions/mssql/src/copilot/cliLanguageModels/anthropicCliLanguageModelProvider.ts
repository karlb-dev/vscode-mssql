/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { StreamYield } from "./cliInvocation";
import {
    CliInvocation,
    CliLanguageModelProviderBase,
    CliLanguageModelProviderOptions,
    getTextFromMessage,
    LanguageModelChatInformation,
} from "./cliLanguageModelProviderBase";
import { createAnthropicEnvironment } from "./cliEnvironment";

const argvPromptThreshold = 8 * 1024;

export class AnthropicCliLanguageModelProvider extends CliLanguageModelProviderBase {
    constructor(
        context: vscode.ExtensionContext,
        options?: Partial<CliLanguageModelProviderOptions>,
    ) {
        super(
            context,
            "anthropic-cli",
            "anthropic",
            options?.environment ?? createAnthropicEnvironment(),
            options,
        );
    }

    protected buildInvocation(
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        _options: vscode.LanguageModelChatRequestOptions,
    ): CliInvocation {
        const translated = translateAnthropicMessages(messages);
        const args = [
            "--print",
            "--bare",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--allowedTools",
            "",
            "--model",
            this.getModelId(model),
            "--system-prompt",
            translated.systemPrompt,
            ...this.environment.getExtraArgs(),
        ];

        if (translated.prompt.length <= argvPromptThreshold) {
            args.push(translated.prompt);
            return { args };
        }

        return {
            args,
            stdin: translated.prompt,
        };
    }

    protected createEventParser(): (event: unknown) => StreamYield | StreamYield[] | undefined {
        let sawDelta = false;
        let emittedFallback = false;

        return (event: unknown) => {
            if (!event || typeof event !== "object") {
                return undefined;
            }

            const record = event as Record<string, unknown>;
            if (record.type === "stream_event") {
                const streamEvent = record.event as Record<string, unknown> | undefined;
                const delta = streamEvent?.delta as Record<string, unknown> | undefined;
                if (
                    streamEvent?.type === "content_block_delta" &&
                    delta?.type === "text_delta" &&
                    typeof delta.text === "string"
                ) {
                    sawDelta = true;
                    return { kind: "text", value: delta.text };
                }
                return undefined;
            }

            if (record.type === "assistant" && !sawDelta && !emittedFallback) {
                const text = extractAssistantText(record.message);
                if (text) {
                    emittedFallback = true;
                    return { kind: "text", value: text };
                }
                return undefined;
            }

            if (record.type === "result") {
                const subtype = typeof record.subtype === "string" ? record.subtype : "";
                if (subtype && subtype !== "success") {
                    return {
                        kind: "error",
                        message: typeof record.error === "string" ? record.error : subtype,
                    };
                }

                const yielded: StreamYield[] = [];
                if (!sawDelta && !emittedFallback && typeof record.result === "string") {
                    emittedFallback = true;
                    yielded.push({ kind: "text", value: record.result });
                }

                const usage = extractUsage(record.usage);
                if (usage) {
                    yielded.push(usage);
                }
                return yielded.length ? yielded : undefined;
            }

            return undefined;
        };
    }
}

export function translateAnthropicMessages(messages: vscode.LanguageModelChatMessage[]): {
    systemPrompt: string;
    prompt: string;
} {
    const firstUserIndex = messages.findIndex(
        (message) => message.role === vscode.LanguageModelChatMessageRole.User,
    );
    const systemPrompt =
        firstUserIndex >= 0 ? getTextFromMessage(messages[firstUserIndex], "anthropic-cli") : "";
    const remaining = messages.filter((_message, index) => index !== firstUserIndex);
    const prompt = remaining.map(formatMessageForCli).join("\n\n");
    return {
        systemPrompt,
        prompt,
    };
}

function formatMessageForCli(message: vscode.LanguageModelChatMessage): string {
    const role =
        message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    return `<${role}>\n${getTextFromMessage(message, "anthropic-cli")}\n</${role}>`;
}

function extractAssistantText(message: unknown): string | undefined {
    if (!message || typeof message !== "object") {
        return undefined;
    }

    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
        return undefined;
    }

    return content
        .map((part) => {
            if (!part || typeof part !== "object") {
                return "";
            }
            const record = part as Record<string, unknown>;
            return record.type === "text" && typeof record.text === "string" ? record.text : "";
        })
        .join("");
}

function extractUsage(usage: unknown): StreamYield | undefined {
    if (!usage || typeof usage !== "object") {
        return undefined;
    }

    const record = usage as Record<string, unknown>;
    const input = asNumber(record.input_tokens);
    const output = asNumber(record.output_tokens);
    return input !== undefined && output !== undefined
        ? { kind: "usage", input, output }
        : undefined;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
