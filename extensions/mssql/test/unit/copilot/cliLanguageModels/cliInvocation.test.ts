/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    streamCliJsonl,
    StreamYield,
} from "../../../../src/copilot/cliLanguageModels/cliInvocation";
import { FakeCliProcess } from "./cliProviderTestUtils";

suite("CLI language model invocation utilities", () => {
    test("parses Claude stream-json text deltas", async () => {
        const process = new FakeCliProcess();
        const yielded = collect(process, parseClaudeEvent);

        process.writeJsonLine({ type: "system" });
        process.writeJsonLine({
            type: "stream_event",
            event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "SELECT" },
            },
        });
        process.writeJsonLine({
            type: "result",
            subtype: "success",
            usage: { input_tokens: 10, output_tokens: 2 },
        });
        process.finish();

        expect(await yielded).to.deep.equal([
            { kind: "text", value: "SELECT" },
            { kind: "usage", input: 10, output: 2 },
        ]);
    });

    test("parses Codex accumulated agent_message updates as deltas", async () => {
        const process = new FakeCliProcess();
        const lastSeen = new Map<string, string>();
        const yielded = collect(process, (event) => parseCodexEvent(event, lastSeen));

        process.writeJsonLine({ type: "thread.started", thread_id: "t1" });
        process.writeJsonLine({
            type: "item.updated",
            item: { item_type: "agent_message", id: "a1", text: "FROM" },
        });
        process.writeJsonLine({
            type: "item.updated",
            item: { item_type: "agent_message", id: "a1", text: "FROM dbo" },
        });
        process.writeJsonLine({ type: "item.updated", item: { item_type: "reasoning" } });
        process.writeJsonLine({
            type: "turn.completed",
            usage: { input_tokens: 12, output_tokens: 3 },
        });
        process.finish();

        expect(await yielded).to.deep.equal([
            { kind: "text", value: "FROM" },
            { kind: "text", value: " dbo" },
            { kind: "usage", input: 12, output: 3 },
        ]);
    });

    test("skips malformed JSON lines and ignores unknown events", async () => {
        const process = new FakeCliProcess();
        const yielded = collect(process, parseClaudeEvent);

        process.writeStdoutLine("{not-json");
        process.writeJsonLine({ type: "unknown" });
        process.writeJsonLine({
            type: "stream_event",
            event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "ok" },
            },
        });
        process.finish();

        expect(await yielded).to.deep.equal([{ kind: "text", value: "ok" }]);
    });

    test("does not lose stdout data when exit is emitted before stdout drains", async () => {
        const process = new FakeCliProcess();
        const yielded = collect(process, parseClaudeEvent);

        process.writeJsonLine({
            type: "stream_event",
            event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "late" },
            },
        });
        process.emit("exit", 0, null);
        process.stdout.end();
        process.stderr.end();

        expect(await yielded).to.deep.equal([{ kind: "text", value: "late" }]);
    });
});

async function collect(
    process: FakeCliProcess,
    parser: (event: unknown) => StreamYield | StreamYield[] | undefined,
): Promise<StreamYield[]> {
    const yielded: StreamYield[] = [];
    for await (const item of streamCliJsonl(process, parser)) {
        yielded.push(item);
    }
    return yielded;
}

function parseClaudeEvent(event: unknown): StreamYield | StreamYield[] | undefined {
    const record = event as Record<string, unknown>;
    if (record.type === "stream_event") {
        const streamEvent = record.event as Record<string, unknown> | undefined;
        const delta = streamEvent?.delta as Record<string, unknown> | undefined;
        if (typeof delta?.text === "string") {
            return { kind: "text", value: delta.text };
        }
    }

    if (record.type === "result") {
        const usage = record.usage as Record<string, unknown> | undefined;
        return {
            kind: "usage",
            input: Number(usage?.input_tokens),
            output: Number(usage?.output_tokens),
        };
    }

    return undefined;
}

function parseCodexEvent(event: unknown, lastSeen: Map<string, string>): StreamYield | undefined {
    const record = event as Record<string, unknown>;
    if (record.type === "turn.completed") {
        const usage = record.usage as Record<string, unknown> | undefined;
        return {
            kind: "usage",
            input: Number(usage?.input_tokens),
            output: Number(usage?.output_tokens),
        };
    }

    const item = record.item as Record<string, unknown> | undefined;
    if (record.type !== "item.updated" || item?.item_type !== "agent_message") {
        return undefined;
    }

    const id = String(item.id);
    const text = String(item.text);
    const previous = lastSeen.get(id) ?? "";
    lastSeen.set(id, text);
    return { kind: "text", value: text.slice(previous.length) };
}
