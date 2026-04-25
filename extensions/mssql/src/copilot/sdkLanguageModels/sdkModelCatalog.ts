/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../../constants/constants";
import {
    getConfiguredAdditionalModels,
    ProviderModelEntry,
} from "../languageModels/shared/providerModelCatalog";
import { SdkProviderKind } from "./apiKeyResolution";

export type SdkModelCatalogEntry = ProviderModelEntry;

export const defaultAnthropicSdkModels: SdkModelCatalogEntry[] = [
    {
        id: "claude-opus-4-7",
        displayName: "Claude Opus 4.7",
        family: "claude-opus",
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
    },
    {
        id: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        family: "claude-opus",
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
    },
    {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        family: "claude-sonnet",
        maxInputTokens: 1000000,
        maxOutputTokens: 64000,
    },
    {
        id: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5",
        family: "claude-sonnet",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: "claude-haiku-4-5-20251001",
        displayName: "Claude Haiku 4.5",
        family: "claude-haiku",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
    },
];

export const defaultOpenAiSdkModels: SdkModelCatalogEntry[] = [
    {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        family: "gpt-5.4",
        maxInputTokens: 1050000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        family: "gpt-5.4-mini",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5",
        displayName: "GPT-5",
        family: "gpt-5",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5-mini",
        displayName: "GPT-5 Mini",
        family: "gpt-5-mini",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
    {
        id: "o3",
        displayName: "o3",
        family: "o3",
        maxInputTokens: 200000,
        maxOutputTokens: 100000,
    },
];

export function getSdkModelCatalog(kind: SdkProviderKind): SdkModelCatalogEntry[] {
    const defaults = kind === "anthropic" ? defaultAnthropicSdkModels : defaultOpenAiSdkModels;
    return [...defaults, ...getConfiguredAdditionalModels(getAdditionalModelsSetting(kind))];
}

function getAdditionalModelsSetting(kind: SdkProviderKind): string {
    return kind === "anthropic"
        ? Constants.configCopilotSdkProvidersAnthropicAdditionalModels
        : Constants.configCopilotSdkProvidersOpenAiAdditionalModels;
}
