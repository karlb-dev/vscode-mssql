/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import { AnthropicCliLanguageModelProvider } from "../../../../src/copilot/cliLanguageModels/anthropicCliLanguageModelProvider";
import { defaultAnthropicCliModels } from "../../../../src/copilot/cliLanguageModels/cliModelCatalog";
import { stubTelemetry } from "../../utils";
import {
    CapturedSpawn,
    createCapturingProcessFactory,
    createExtensionContext,
    FakeCliEnvironment,
    textOf,
} from "./cliProviderTestUtils";

suite("AnthropicCliLanguageModelProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let environment: FakeCliEnvironment;
    let captures: CapturedSpawn[];
    let provider: AnthropicCliLanguageModelProvider;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        environment = new FakeCliEnvironment();
        captures = [];
        provider = new AnthropicCliLanguageModelProvider(createExtensionContext(), {
            environment,
            processFactory: createCapturingProcessFactory((process) => {
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
                    usage: { input_tokens: 11, output_tokens: 2 },
                });
                process.finish();
            }, captures),
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    test("prepareLanguageModelChat returns the curated catalog when available and authenticated", async () => {
        const models = await provider.prepareLanguageModelChat({}, {
            isCancellationRequested: false,
        } as vscode.CancellationToken);

        expect(models.map((model) => model.id)).to.deep.equal(
            defaultAnthropicCliModels.map((model) => `anthropic-cli/${model.id}`),
        );
        expect(models[0].capabilities).to.deep.equal({ toolCalling: false, imageInput: false });
    });

    test("prepareLanguageModelChat returns [] when binary is missing or auth fails", async () => {
        environment.resolved = undefined;
        expect(
            await provider.prepareLanguageModelChat({}, {
                isCancellationRequested: false,
            } as vscode.CancellationToken),
        ).to.deep.equal([]);

        environment.resolved = { path: "/tmp/fake-cli", source: "configured" };
        environment.authenticated = false;
        provider.invalidateCache();
        expect(
            await provider.prepareLanguageModelChat({}, {
                isCancellationRequested: false,
            } as vscode.CancellationToken),
        ).to.deep.equal([]);
    });

    test("translates messages into claude args with system prompt extraction", async () => {
        const progressParts: vscode.LanguageModelTextPart[] = [];
        await provider.provideLanguageModelChatResponse(
            defaultModel(),
            [
                vscode.LanguageModelChatMessage.User("system rules"),
                vscode.LanguageModelChatMessage.User("complete this"),
                vscode.LanguageModelChatMessage.Assistant("prior answer"),
            ],
            {},
            { report: (part) => progressParts.push(part) },
            {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose() {} }),
            } as vscode.CancellationToken,
        );

        expect(textOf(progressParts)).to.equal("SELECT");
        expect(captures[0].command).to.equal("/tmp/fake-cli");
        expect(captures[0].args).to.include.members([
            "--print",
            "--bare",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--allowedTools",
            "",
            "--model",
            "claude-sonnet-4-5-20250929",
            "--system-prompt",
            "system rules",
        ]);
        expect(captures[0].args.at(-1)).to.include("<user>\ncomplete this\n</user>");
        expect(captures[0].args.at(-1)).to.include("<assistant>\nprior answer\n</assistant>");
    });

    test("cancellation interrupts the child process cleanly", async () => {
        const cts = new vscode.CancellationTokenSource();
        const localCaptures: CapturedSpawn[] = [];
        const cancellingProvider = new AnthropicCliLanguageModelProvider(createExtensionContext(), {
            environment,
            processFactory: createCapturingProcessFactory((process) => {
                cts.cancel();
                process.writeJsonLine({
                    type: "stream_event",
                    event: {
                        type: "content_block_delta",
                        delta: { type: "text_delta", text: "ignored" },
                    },
                });
            }, localCaptures),
        });

        await cancellingProvider.provideLanguageModelChatResponse(
            defaultModel(),
            [
                vscode.LanguageModelChatMessage.User("rules"),
                vscode.LanguageModelChatMessage.User("prompt"),
            ],
            {},
            { report: sandbox.stub() },
            cts.token,
        );

        expect(localCaptures[0].process.killSignals).to.include("SIGTERM");
        cts.dispose();
    });

    test("auth-failed stderr maps to NoPermissions", async () => {
        const failingProvider = new AnthropicCliLanguageModelProvider(createExtensionContext(), {
            environment,
            processFactory: createCapturingProcessFactory((process) => {
                process.writeStderr("authentication required: not logged in");
                process.finish(1);
            }, []),
        });

        let thrown: unknown;
        try {
            await failingProvider.provideLanguageModelChatResponse(
                defaultModel(),
                [
                    vscode.LanguageModelChatMessage.User("rules"),
                    vscode.LanguageModelChatMessage.User("prompt"),
                ],
                {},
                { report: sandbox.stub() },
                {
                    isCancellationRequested: false,
                    onCancellationRequested: () => ({ dispose() {} }),
                } as vscode.CancellationToken,
            );
        } catch (error) {
            thrown = error;
        }

        expect((thrown as vscode.LanguageModelError).code).to.equal("NoPermissions");
    });

    test("provideTokenCount approximates text tokens", async () => {
        expect(
            await provider.provideTokenCount(defaultModel(), "123456789", {
                isCancellationRequested: false,
            } as vscode.CancellationToken),
        ).to.equal(3);
    });
});

function defaultModel() {
    return {
        id: "anthropic-cli/claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5 (CLI)",
        family: "claude-sonnet",
        version: "claude-sonnet-4-5-20250929",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
        capabilities: { toolCalling: false, imageInput: false },
    };
}
