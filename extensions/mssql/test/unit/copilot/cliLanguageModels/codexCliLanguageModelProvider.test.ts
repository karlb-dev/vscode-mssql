/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import { CodexCliLanguageModelProvider } from "../../../../src/copilot/cliLanguageModels/codexCliLanguageModelProvider";
import { defaultCodexCliModels } from "../../../../src/copilot/cliLanguageModels/cliModelCatalog";
import { stubTelemetry } from "../../utils";
import {
    CapturedSpawn,
    createCapturingProcessFactory,
    createExtensionContext,
    FakeCliEnvironment,
    textOf,
} from "./cliProviderTestUtils";

suite("CodexCliLanguageModelProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let environment: FakeCliEnvironment;
    let captures: CapturedSpawn[];
    let provider: CodexCliLanguageModelProvider;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        environment = new FakeCliEnvironment();
        captures = [];
        provider = new CodexCliLanguageModelProvider(createExtensionContext(), {
            environment,
            processFactory: createCapturingProcessFactory((process) => {
                process.writeJsonLine({
                    type: "item.updated",
                    item: { item_type: "agent_message", id: "m1", text: "FROM" },
                });
                process.writeJsonLine({
                    type: "item.updated",
                    item: { item_type: "agent_message", id: "m1", text: "FROM dbo.Customers" },
                });
                process.writeJsonLine({
                    type: "turn.completed",
                    usage: { input_tokens: 14, output_tokens: 4 },
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
            defaultCodexCliModels.map((model) => `openai-cli/${model.id}`),
        );
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

    test("translates messages into codex exec args and stdin payload", async () => {
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

        expect(textOf(progressParts)).to.equal("FROM dbo.Customers");
        expect(captures[0].args).to.deep.equal([
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--model",
            "gpt-5-codex",
            "-c",
            "approval_policy=never",
            "-",
        ]);

        const stdin = captures[0].process.stdin.read()?.toString("utf8") ?? "";
        expect(stdin).to.include("<system>\nsystem rules\n</system>");
        expect(stdin).to.include("<user>\ncomplete this\n</user>");
        expect(stdin).to.include("<assistant>\nprior answer\n</assistant>");
    });

    test("auth-failed stderr maps to NoPermissions", async () => {
        const failingProvider = new CodexCliLanguageModelProvider(createExtensionContext(), {
            environment,
            processFactory: createCapturingProcessFactory((process) => {
                process.writeStderr("not logged in");
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
});

function defaultModel() {
    return {
        id: "openai-cli/gpt-5-codex",
        name: "GPT-5 Codex (CLI)",
        family: "gpt-5-codex",
        version: "gpt-5-codex",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
        capabilities: { toolCalling: false, imageInput: false },
    };
}
