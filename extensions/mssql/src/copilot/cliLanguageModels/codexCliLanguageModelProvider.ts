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
import { createCodexEnvironment } from "./cliEnvironment";

export class CodexCliLanguageModelProvider extends CliLanguageModelProviderBase {
    constructor(
        context: vscode.ExtensionContext,
        options?: Partial<CliLanguageModelProviderOptions>,
    ) {
        super(
            context,
            "openai-cli",
            "codex",
            options?.environment ?? createCodexEnvironment(),
            options,
        );
    }

    protected buildInvocation(
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        _options: vscode.LanguageModelChatRequestOptions,
    ): CliInvocation {
        return {
            args: [
                "exec",
                "--json",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--model",
                this.getModelId(model),
                "-c",
                "approval_policy=never",
                ...this.environment.getExtraArgs(),
                "-",
            ],
            stdin: translateCodexMessages(messages),
        };
    }

    protected createEventParser(): (event: unknown) => StreamYield | StreamYield[] | undefined {
        const lastSeenByItemId = new Map<string, string>();

        return (event: unknown) => {
            if (!event || typeof event !== "object") {
                return undefined;
            }

            const record = event as Record<string, unknown>;
            if (record.type === "turn.failed") {
                return {
                    kind: "error",
                    message:
                        typeof record.error === "string" ? record.error : "Codex CLI turn failed.",
                };
            }

            if (record.type === "turn.completed") {
                const usage = extractUsage(record.usage);
                return usage;
            }

            if (record.type !== "item.updated" && record.type !== "item.completed") {
                return undefined;
            }

            const item = record.item as Record<string, unknown> | undefined;
            if (item?.item_type !== "agent_message" || typeof item.text !== "string") {
                return undefined;
            }

            const itemId = typeof item.id === "string" ? item.id : "__default__";
            const previous = lastSeenByItemId.get(itemId) ?? "";
            lastSeenByItemId.set(itemId, item.text);

            // Codex JSON events have historically reported accumulated text. Compute the
            // delta locally so VS Code receives streaming text parts without duplicates.
            const delta = item.text.startsWith(previous)
                ? item.text.slice(previous.length)
                : item.text;
            return delta ? { kind: "text", value: delta } : undefined;
        };
    }
}

export function translateCodexMessages(messages: vscode.LanguageModelChatMessage[]): string {
    const firstUserIndex = messages.findIndex(
        (message) => message.role === vscode.LanguageModelChatMessageRole.User,
    );
    const systemPrompt =
        firstUserIndex >= 0 ? getTextFromMessage(messages[firstUserIndex], "openai-cli") : "";
    const remaining = messages.filter((_message, index) => index !== firstUserIndex);
    const conversation = remaining.map(formatMessageForCli).join("\n\n");

    return `<system>
${systemPrompt}
</system>

<conversation>
${conversation}
</conversation>

Respond with only the assistant's next message, no preamble or explanation.`;
}

function formatMessageForCli(message: vscode.LanguageModelChatMessage): string {
    const role =
        message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    return `<${role}>\n${getTextFromMessage(message, "openai-cli")}\n</${role}>`;
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
