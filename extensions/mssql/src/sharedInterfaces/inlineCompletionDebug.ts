/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type InlineCompletionResult =
    | "success"
    | "accepted"
    | "emptyFromModel"
    | "emptyFromSanitizer"
    | "noModel"
    | "noPermission"
    | "error";

export type InlineCompletionDebugEventResult = InlineCompletionResult | "cancelled";

export const inlineCompletionCategories = ["continuation", "intent"] as const;

export type InlineCompletionCategory = (typeof inlineCompletionCategories)[number];

export const inlineCompletionDebugProfileIds = ["focused", "balanced", "broad", "custom"] as const;

export type InlineCompletionDebugProfileId = (typeof inlineCompletionDebugProfileIds)[number];

export interface InlineCompletionDebugProfileOption {
    id: InlineCompletionDebugProfileId;
    label: string;
    description: string;
}

export interface InlineCompletionDebugPromptMessage {
    role: "user" | "assistant";
    content: string;
}

export interface InlineCompletionDebugOverridesApplied {
    profileId?: InlineCompletionDebugProfileId;
    modelSelector?: string;
    useSchemaContext?: boolean;
    debounceMs?: number;
    maxTokens?: number;
    enabledCategories?: InlineCompletionCategory[];
    customSystemPromptUsed: boolean;
}

export interface InlineCompletionDebugEvent {
    id: string;
    timestamp: number;
    documentUri: string;
    documentFileName: string;
    line: number;
    column: number;
    triggerKind: "automatic" | "invoke";
    explicitFromUser: boolean;
    completionCategory: InlineCompletionCategory;
    intentMode: boolean;
    inferredSystemQuery: boolean;
    modelFamily: string | undefined;
    modelId: string | undefined;
    modelVendor: string | undefined;
    result: InlineCompletionDebugEventResult;
    latencyMs: number;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
    usedSchemaContext: boolean;
    overridesApplied: InlineCompletionDebugOverridesApplied;
    promptMessages: InlineCompletionDebugPromptMessage[];
    rawResponse: string;
    sanitizedResponse: string | undefined;
    finalCompletionText: string | undefined;
    schemaContextFormatted: string | undefined;
    locals: {
        [key: string]: unknown;
    };
    error?: {
        message: string;
        name?: string;
        stack?: string;
    };
}

export interface InlineCompletionDebugOverrides {
    profileId: InlineCompletionDebugProfileId | null;
    // A model selector is `<vendor>/<id>`, but a bare family string is also
    // accepted for backwards compatibility with `mssql.copilot.inlineCompletions.modelFamily`.
    modelSelector: string | null;
    useSchemaContext: boolean | null;
    debounceMs: number | null;
    maxTokens: number | null;
    enabledCategories: InlineCompletionCategory[] | null;
    forceIntentMode: boolean | null;
    customSystemPrompt: string | null;
    allowAutomaticTriggers: boolean | null;
}

export interface InlineCompletionDebugModelOption {
    selector: string;
    label: string;
    providerLabel: string;
    id: string;
    name: string;
    family: string;
    vendor: string;
    version?: string;
}

export interface InlineCompletionDebugDefaults {
    configuredModelSelector?: string;
    effectiveModelSelector?: string;
    effectiveModelLabel?: string;
    useSchemaContext: boolean;
    debounceMs: number;
    continuationMaxTokens: number;
    intentMaxTokens: number;
    enabledCategories: InlineCompletionCategory[];
    allowAutomaticTriggers: boolean;
}

export interface InlineCompletionDebugCustomPromptState {
    dialogOpen: boolean;
    savedValue: string | null;
    defaultValue: string;
    lastSavedAt?: number;
}

export interface InlineCompletionDebugWebviewState {
    events: InlineCompletionDebugEvent[];
    overrides: InlineCompletionDebugOverrides;
    defaults: InlineCompletionDebugDefaults;
    profiles: InlineCompletionDebugProfileOption[];
    availableModels: InlineCompletionDebugModelOption[];
    selectedEventId?: string;
    recordWhenClosed: boolean;
    customPrompt: InlineCompletionDebugCustomPromptState;
}

export interface InlineCompletionDebugReducers {
    clearEvents: Record<string, never>;
    selectEvent: {
        eventId?: string;
    };
    updateOverrides: {
        overrides: Partial<InlineCompletionDebugOverrides>;
    };
    selectProfile: {
        profileId: InlineCompletionDebugProfileId;
    };
    setRecordWhenClosed: {
        enabled: boolean;
    };
    openCustomPromptDialog: Record<string, never>;
    closeCustomPromptDialog: Record<string, never>;
    saveCustomPrompt: {
        value: string;
    };
    resetCustomPrompt: Record<string, never>;
    importSession: Record<string, never>;
    exportSession: Record<string, never>;
    replayEvent: {
        eventId: string;
    };
    copyEventPayload: {
        eventId: string;
        kind:
            | "id"
            | "json"
            | "prompt"
            | "systemPrompt"
            | "userPrompt"
            | "rawResponse"
            | "sanitizedResponse";
    };
}

export interface InlineCompletionDebugExportData {
    version: 1;
    exportedAt: number;
    overrides: InlineCompletionDebugOverrides;
    recordWhenClosed: boolean;
    customPromptLastSavedAt?: number;
    events: InlineCompletionDebugEvent[];
}
