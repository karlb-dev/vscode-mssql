/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { logger2 } from "../../models/logger2";
import { AnthropicCliLanguageModelProvider } from "./anthropicCliLanguageModelProvider";
import { CodexCliLanguageModelProvider } from "./codexCliLanguageModelProvider";

type RegisterLanguageModelChatProvider = (vendor: string, provider: unknown) => vscode.Disposable;

const logger = logger2.withPrefix("CliLanguageModelProviders");

export function registerCliLanguageModelProviders(context: vscode.ExtensionContext): void {
    const registeredProviders: Array<{ label: string; invalidateCache(): void }> = [];

    context.subscriptions.push(
        vscode.commands.registerCommand(Constants.cmdManageAnthropicCliLanguageModelProvider, () =>
            manageCliProvider(
                "Claude Code CLI provider",
                Constants.configCopilotCliProvidersAnthropicPath,
                registeredProviders,
            ),
        ),
        vscode.commands.registerCommand(Constants.cmdManageCodexCliLanguageModelProvider, () =>
            manageCliProvider(
                "Codex CLI provider",
                Constants.configCopilotCliProvidersCodexPath,
                registeredProviders,
            ),
        ),
    );

    const registerLanguageModelChatProvider = (
        vscode.lm as unknown as {
            registerLanguageModelChatProvider?: RegisterLanguageModelChatProvider;
        }
    ).registerLanguageModelChatProvider;

    if (typeof registerLanguageModelChatProvider !== "function") {
        logger.warn("VS Code does not expose registerLanguageModelChatProvider in this build.");
        return;
    }

    if (isSettingEnabled(Constants.configCopilotCliProvidersAnthropicEnabled)) {
        const provider = new AnthropicCliLanguageModelProvider(context);
        registeredProviders.push({
            label: "Claude Code CLI",
            invalidateCache: () => provider.invalidateCache(),
        });
        context.subscriptions.push(registerLanguageModelChatProvider("anthropic-cli", provider));
    }

    if (isSettingEnabled(Constants.configCopilotCliProvidersCodexEnabled)) {
        const provider = new CodexCliLanguageModelProvider(context);
        registeredProviders.push({
            label: "Codex CLI",
            invalidateCache: () => provider.invalidateCache(),
        });
        context.subscriptions.push(registerLanguageModelChatProvider("openai-cli", provider));
    }
}

function isSettingEnabled(setting: string): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(setting, false) ?? false;
}

async function manageCliProvider(
    title: string,
    primarySetting: string,
    providers: Array<{ label: string; invalidateCache(): void }>,
): Promise<void> {
    const choice = await vscode.window.showQuickPick(
        [
            {
                label: "Open Settings",
                description: "Open this provider's CLI path setting.",
            },
            {
                label: "Refresh Model Detection",
                description: "Clear cached binary, auth, and model enumeration results.",
            },
        ],
        { title },
    );

    if (!choice) {
        return;
    }

    if (choice.label === "Refresh Model Detection") {
        providers.forEach((provider) => provider.invalidateCache());
        return;
    }

    await vscode.commands.executeCommand("workbench.action.openSettings", `@id:${primarySetting}`);
}

export { AnthropicCliLanguageModelProvider } from "./anthropicCliLanguageModelProvider";
export { CodexCliLanguageModelProvider } from "./codexCliLanguageModelProvider";
export { approximateTokenCount } from "./tokenApproximation";
