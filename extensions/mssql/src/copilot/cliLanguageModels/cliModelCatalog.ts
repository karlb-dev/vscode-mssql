/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../../constants/constants";
import {
    getConfiguredAdditionalModels as getConfiguredProviderAdditionalModels,
    ProviderModelEntry,
} from "../languageModels/shared/providerModelCatalog";
import { CliProviderKind } from "./cliEnvironment";

export type CliModelCatalogEntry = ProviderModelEntry;

// Anthropic model ids are intentionally the currently verified Claude Code/API ids
// instead of unverified future aliases. Additional preview ids can be supplied by setting.
export const defaultAnthropicCliModels: CliModelCatalogEntry[] = [
    {
        id: "claude-opus-4-1-20250805",
        displayName: "Claude Opus 4.1 (CLI)",
        family: "claude-opus",
        maxInputTokens: 200000,
        maxOutputTokens: 32000,
    },
    {
        id: "claude-opus-4-20250514",
        displayName: "Claude Opus 4 (CLI)",
        family: "claude-opus",
        maxInputTokens: 200000,
        maxOutputTokens: 32000,
    },
    {
        id: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5 (CLI)",
        family: "claude-sonnet",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: "claude-sonnet-4-20250514",
        displayName: "Claude Sonnet 4 (CLI)",
        family: "claude-sonnet",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: "claude-3-5-haiku-20241022",
        displayName: "Claude Haiku 3.5 (CLI)",
        family: "claude-haiku",
        maxInputTokens: 200000,
        maxOutputTokens: 8192,
    },
];

export const defaultCodexCliModels: CliModelCatalogEntry[] = [
    {
        id: "gpt-5-codex",
        displayName: "GPT-5 Codex (CLI)",
        family: "gpt-5-codex",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5",
        displayName: "GPT-5 (CLI)",
        family: "gpt-5",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5-mini",
        displayName: "GPT-5 Mini (CLI)",
        family: "gpt-5-mini",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
];

export function getCliModelCatalog(kind: CliProviderKind): CliModelCatalogEntry[] {
    const defaults = kind === "anthropic" ? defaultAnthropicCliModels : defaultCodexCliModels;
    return [...defaults, ...getConfiguredAdditionalModels(kind)];
}

function getConfiguredAdditionalModels(kind: CliProviderKind): CliModelCatalogEntry[] {
    const setting =
        kind === "anthropic"
            ? Constants.configCopilotCliProvidersAnthropicAdditionalModels
            : Constants.configCopilotCliProvidersCodexAdditionalModels;
    return getConfiguredProviderAdditionalModels(setting);
}
