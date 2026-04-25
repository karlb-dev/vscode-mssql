/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import * as Constants from "../../constants/constants";
import { WebviewPanelController } from "../../controllers/webviewPanelController";
import VscodeWrapper from "../../controllers/vscodeWrapper";
import { logger2 } from "../../models/logger2";
import { getErrorMessage } from "../../utils/utils";
import {
    automaticTriggerDebounceMs,
    buildCompletionRules,
    buildInlineCompletionPromptMessages,
    collectText,
    continuationModeMaxTokens,
    createLanguageModelMaxTokenOptions,
    fixLeadingWhitespace,
    getEffectiveMaxCompletionChars,
    getInlineCompletionCategory,
    intentModeMaxTokens,
    normalizeInlineCompletionCategories,
    resolveInlineCompletionRules,
    sanitizeInlineCompletionText,
    selectPreferredModel,
    suppressDocumentSuffixOverlap,
} from "../sqlInlineCompletionProvider";
import {
    matchLanguageModelChatToSelector,
    selectConfiguredLanguageModels,
} from "../languageModelSelection";
import {
    formatModelDisplayName,
    formatModelSelector,
    formatProviderLabel,
} from "../languageModels/shared/modelDisplay";
import {
    createInlineCompletionDebugPresetOverrides,
    getInlineCompletionDebugPresetProfile,
    inlineCompletionDebugCustomProfileId,
    inlineCompletionDebugProfileOptions,
    InlineCompletionModelPreference,
} from "./inlineCompletionDebugProfiles";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugExportData,
    InlineCompletionDebugModelOption,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers,
} from "../../sharedInterfaces/inlineCompletionDebug";

export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPrompt";
export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";
const DEFAULT_CUSTOM_PROMPT = buildCompletionRules(false, false);

export class InlineCompletionDebugController extends WebviewPanelController<
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers
> {
    private readonly _logger = logger2.withPrefix("InlineCompletionDebug");
    private _availableModels: InlineCompletionDebugModelOption[] = [];
    private _effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    private _savedCustomPromptValue: string | null;
    private _customPromptLastSavedAt: number | undefined;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
    ) {
        const savedCustomPrompt =
            _extensionContext.workspaceState.get<string | null>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
                null,
            ) ?? null;
        const savedCustomPromptAt =
            _extensionContext.workspaceState.get<number | undefined>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
                undefined,
            ) ?? undefined;

        super(
            _extensionContext,
            vscodeWrapper,
            "inlineCompletionDebug",
            "inlineCompletionDebug",
            createState({
                availableModels: [],
                effectiveDefaultModelOption: undefined,
                selectedEventId: undefined,
                customPromptDialogOpen: false,
                customPromptValue: savedCustomPrompt,
                customPromptLastSavedAt: savedCustomPromptAt,
            }),
            {
                title: "Copilot Completion Debug",
                viewColumn: vscode.ViewColumn.Active,
                showRestorePromptAfterClose: false,
            },
        );

        this._savedCustomPromptValue = savedCustomPrompt;
        this._customPromptLastSavedAt = savedCustomPromptAt;
        inlineCompletionDebugStore.setPanelOpen(true);
        this.registerDisposables();
        this.registerReducers();
        void this.refreshAvailableModels();
    }

    public override dispose(): void {
        inlineCompletionDebugStore.setPanelOpen(false);
        super.dispose();
    }

    private registerDisposables(): void {
        this.registerDisposable(
            inlineCompletionDebugStore.onDidChange(() => {
                if (!this.isDisposed) {
                    this.updateState(this.createState());
                }
            }),
        );
        this.registerDisposable(
            vscode.lm.onDidChangeChatModels(() => {
                void this.refreshAvailableModels();
            }),
        );
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    ) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsUseSchemaContext)
                ) {
                    this.updateState(this.createState());
                }
                if (
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelFamily) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelVendors)
                ) {
                    this._effectiveDefaultModelOption = pickDefaultModelOption(
                        this._availableModels,
                        getConfiguredModelSelector(),
                    );
                    this.updateState(this.createState());
                    void this.refreshAvailableModels();
                }
            }),
        );
    }

    private registerReducers(): void {
        this.registerReducer("clearEvents", (state) => {
            inlineCompletionDebugStore.clearEvents();
            return this.createState({
                selectedEventId: undefined,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("selectEvent", (state, payload) => {
            return this.createState({
                selectedEventId: payload.eventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("updateOverrides", (state, payload) => {
            inlineCompletionDebugStore.updateOverrides(
                this.prepareUserOverrideUpdate(payload.overrides),
            );
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("selectProfile", (state, payload) => {
            inlineCompletionDebugStore.updateOverrides(this.createProfileUpdate(payload.profileId));
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("setRecordWhenClosed", async (state, payload) => {
            await vscode.workspace
                .getConfiguration()
                .update(
                    Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    payload.enabled,
                    getConfigurationTarget(),
                );
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("openCustomPromptDialog", (state) => {
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: true,
            });
        });

        this.registerReducer("closeCustomPromptDialog", (state) => {
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: false,
            });
        });

        this.registerReducer("saveCustomPrompt", async (state, payload) => {
            const value = payload.value.length > 0 ? payload.value : null;
            const savedAt = value ? Date.now() : undefined;
            await this.persistCustomPrompt(value, savedAt, true);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: false,
            });
        });

        this.registerReducer("resetCustomPrompt", async (state) => {
            await this.persistCustomPrompt(null, undefined, false);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("exportSession", async (state) => {
            await this.exportSession();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("importSession", async (state) => {
            await this.importSession();
            return this.createState({
                selectedEventId: undefined,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("copyEventPayload", async (state, payload) => {
            await this.copyEventPayload(payload.eventId, payload.kind);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("replayEvent", async (state, payload) => {
            await this.replayEvent(payload.eventId);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });
    }

    private createState(
        overrides?: Partial<{
            selectedEventId: string | undefined;
            customPromptDialogOpen: boolean;
            customPromptValue: string | null;
            customPromptLastSavedAt: number | undefined;
        }>,
    ): InlineCompletionDebugWebviewState {
        const customPromptValue = overrides?.customPromptValue ?? this._savedCustomPromptValue;
        const customPromptLastSavedAt =
            overrides?.customPromptLastSavedAt ?? this._customPromptLastSavedAt;
        return createState({
            availableModels: this._availableModels,
            effectiveDefaultModelOption: this._effectiveDefaultModelOption,
            selectedEventId: overrides?.selectedEventId ?? this.state?.selectedEventId,
            customPromptDialogOpen:
                overrides?.customPromptDialogOpen ?? this.state?.customPrompt.dialogOpen ?? false,
            customPromptValue,
            customPromptLastSavedAt,
        });
    }

    private async refreshAvailableModels(): Promise<void> {
        try {
            const models = await selectConfiguredLanguageModels();
            const byModel = new Map<string, InlineCompletionDebugModelOption>();
            for (const model of models) {
                const selector = formatModelSelector(model);
                if (!byModel.has(selector)) {
                    byModel.set(selector, {
                        selector,
                        label: formatModelDisplayName(model),
                        providerLabel: formatProviderLabel(model.vendor),
                        id: model.id,
                        name: model.name,
                        family: model.family,
                        vendor: model.vendor,
                        version: model.version,
                    });
                }
            }

            this._availableModels = Array.from(byModel.values()).sort(compareModelOptions);
            this._effectiveDefaultModelOption = pickDefaultModelOption(
                this._availableModels,
                getConfiguredModelSelector(),
            );
            if (!this.isDisposed) {
                this.updateState(this.createState());
            }
        } catch (error) {
            this._logger.warn(
                `Failed to refresh inline completion debug models: ${getErrorMessage(error)}`,
            );
        }
    }

    private prepareUserOverrideUpdate(
        update: Partial<InlineCompletionDebugOverrides>,
    ): Partial<InlineCompletionDebugOverrides> {
        const current = inlineCompletionDebugStore.getOverrides();
        if (!this.shouldSwitchProfileToCustom(current, update)) {
            return update;
        }

        return {
            ...this.materializeProfileOverrides(current),
            ...update,
            profileId: inlineCompletionDebugCustomProfileId,
        };
    }

    private createProfileUpdate(
        profileId: InlineCompletionDebugProfileId,
    ): Partial<InlineCompletionDebugOverrides> {
        if (profileId === inlineCompletionDebugCustomProfileId) {
            return this.materializeProfileOverrides(inlineCompletionDebugStore.getOverrides());
        }

        return createInlineCompletionDebugPresetOverrides(profileId);
    }

    private shouldSwitchProfileToCustom(
        current: InlineCompletionDebugOverrides,
        update: Partial<InlineCompletionDebugOverrides>,
    ): boolean {
        if (!getInlineCompletionDebugPresetProfile(current.profileId)) {
            return false;
        }

        return (
            Object.prototype.hasOwnProperty.call(update, "modelSelector") ||
            Object.prototype.hasOwnProperty.call(update, "forceIntentMode") ||
            Object.prototype.hasOwnProperty.call(update, "enabledCategories") ||
            Object.prototype.hasOwnProperty.call(update, "debounceMs") ||
            Object.prototype.hasOwnProperty.call(update, "maxTokens") ||
            Object.prototype.hasOwnProperty.call(update, "customSystemPrompt")
        );
    }

    private materializeProfileOverrides(
        current: InlineCompletionDebugOverrides,
    ): Partial<InlineCompletionDebugOverrides> {
        const profile = getInlineCompletionDebugPresetProfile(current.profileId);
        if (!profile) {
            return {
                profileId: inlineCompletionDebugCustomProfileId,
            };
        }

        const modelOption = pickDefaultModelOption(
            this._availableModels,
            getConfiguredModelSelector(),
            profile.modelPreference,
        );

        return {
            profileId: inlineCompletionDebugCustomProfileId,
            modelSelector: current.modelSelector ?? modelOption?.selector ?? null,
            forceIntentMode: current.forceIntentMode ?? profile.forceIntentMode,
            enabledCategories: current.enabledCategories ?? [...profile.enabledCategories],
            debounceMs: current.debounceMs ?? profile.debounceMs,
            maxTokens: current.maxTokens ?? profile.maxTokens,
        };
    }

    private async persistCustomPrompt(
        value: string | null,
        savedAt: number | undefined,
        markProfileCustom: boolean,
    ): Promise<void> {
        this._savedCustomPromptValue = value;
        this._customPromptLastSavedAt = savedAt;
        await this._extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
            value,
        );
        await this._extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
            savedAt,
        );
        inlineCompletionDebugStore.updateOverrides(
            markProfileCustom
                ? this.prepareUserOverrideUpdate({ customSystemPrompt: value })
                : { customSystemPrompt: value },
        );
    }

    private async exportSession(): Promise<void> {
        const defaultFileName = `inline-completion-debug-${Date.now()}.json`;
        const defaultFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri ?? this._extensionContext.globalStorageUri;
        const fileUri = await vscode.window.showSaveDialog({
            title: "Export Inline Completion Debug Session",
            filters: {
                JSON: ["json"],
            },
            defaultUri: vscode.Uri.joinPath(defaultFolder, defaultFileName),
        });

        if (!fileUri) {
            return;
        }

        const exportData = inlineCompletionDebugStore.exportSession(
            getRecordWhenClosedSetting(),
            this._customPromptLastSavedAt,
        );
        await vscode.workspace.fs.writeFile(
            fileUri,
            new TextEncoder().encode(JSON.stringify(exportData, undefined, 2)),
        );
    }

    private async importSession(): Promise<void> {
        const fileUris = await vscode.window.showOpenDialog({
            title: "Import Inline Completion Debug Session",
            canSelectFiles: true,
            canSelectMany: false,
            filters: {
                JSON: ["json"],
            },
        });

        const fileUri = fileUris?.[0];
        if (!fileUri) {
            return;
        }

        const fileContents = await vscode.workspace.fs.readFile(fileUri);
        const parsed = JSON.parse(
            new TextDecoder().decode(fileContents),
        ) as InlineCompletionDebugExportData;
        inlineCompletionDebugStore.importSession(parsed);
        await vscode.workspace
            .getConfiguration()
            .update(
                Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                parsed.recordWhenClosed ?? false,
                getConfigurationTarget(),
            );
        await this.persistCustomPrompt(
            parsed.overrides?.customSystemPrompt ?? null,
            parsed.customPromptLastSavedAt,
            false,
        );
    }

    private async copyEventPayload(
        eventId: string,
        kind:
            | "id"
            | "json"
            | "prompt"
            | "systemPrompt"
            | "userPrompt"
            | "rawResponse"
            | "sanitizedResponse",
    ): Promise<void> {
        const event = inlineCompletionDebugStore.getEvent(eventId);
        if (!event) {
            return;
        }

        let text = "";
        switch (kind) {
            case "id":
                text = event.id;
                break;
            case "json":
                text = JSON.stringify(event, undefined, 2);
                break;
            case "prompt":
                text = event.promptMessages
                    .map((message, index) => `#${index + 1} ${message.role}\n${message.content}`)
                    .join("\n\n");
                break;
            case "systemPrompt":
                text = event.promptMessages[0]?.content ?? "";
                break;
            case "userPrompt":
                text = event.promptMessages[1]?.content ?? "";
                break;
            case "rawResponse":
                text = event.rawResponse;
                break;
            case "sanitizedResponse":
                text = event.sanitizedResponse ?? event.finalCompletionText ?? "";
                break;
        }

        await vscode.env.clipboard.writeText(text);
    }

    private async replayEvent(eventId: string): Promise<void> {
        const sourceEvent = inlineCompletionDebugStore.getEvent(eventId);
        if (!sourceEvent) {
            return;
        }

        const overrides = inlineCompletionDebugStore.getOverrides();
        const profile = getInlineCompletionDebugPresetProfile(overrides.profileId);
        const selectedModel = await this.selectReplayModel(
            overrides.modelSelector,
            profile?.modelPreference,
        );
        if (!selectedModel) {
            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                result: "noModel",
                latencyMs: 0,
                modelFamily: undefined,
                modelId: undefined,
                modelVendor: undefined,
                usedSchemaContext: false,
                schemaObjectCount: 0,
                schemaSystemObjectCount: 0,
                schemaForeignKeyCount: 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: sourceEvent.promptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted: sourceEvent.schemaContextFormatted,
                locals: {
                    ...sourceEvent.locals,
                    replaySourceEventId: sourceEvent.id,
                },
            });
            return;
        }

        const canSendRequest =
            this._extensionContext.languageModelAccessInformation?.canSendRequest(selectedModel);
        if (canSendRequest === false) {
            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                result: "noPermission",
                latencyMs: 0,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                usedSchemaContext: false,
                schemaObjectCount: 0,
                schemaSystemObjectCount: 0,
                schemaForeignKeyCount: 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: sourceEvent.promptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted: sourceEvent.schemaContextFormatted,
                locals: {
                    ...sourceEvent.locals,
                    replaySourceEventId: sourceEvent.id,
                },
            });
            return;
        }

        const linePrefix = asString(sourceEvent.locals.linePrefix);
        const lineSuffix = asString(sourceEvent.locals.lineSuffix);
        const recentPrefix = asString(sourceEvent.locals.recentPrefix);
        const statementPrefix = asString(sourceEvent.locals.statementPrefix);
        const suffix = asString(sourceEvent.locals.suffix);
        const intentMode =
            overrides.forceIntentMode ?? profile?.forceIntentMode ?? sourceEvent.intentMode;
        const completionCategory = getInlineCompletionCategory(intentMode);
        const useSchemaContext = overrides.useSchemaContext ?? getConfiguredUseSchemaContext();
        const schemaContextText =
            useSchemaContext && sourceEvent.schemaContextFormatted
                ? sourceEvent.schemaContextFormatted
                : "-- unavailable";
        const rulesText = resolveInlineCompletionRules({
            customSystemPrompt: overrides.customSystemPrompt,
            inferredSystemQuery: sourceEvent.inferredSystemQuery,
            intentMode,
            schemaContextText,
            linePrefix,
            recentPrefix,
            statementPrefix,
        });
        const promptMessages = buildInlineCompletionPromptMessages({
            rulesText,
            intentMode,
            recentPrefix,
            statementPrefix,
            suffix,
            linePrefix,
            lineSuffix,
            schemaContextText,
        });
        const maxTokens =
            overrides.maxTokens ??
            profile?.maxTokens ??
            (intentMode ? intentModeMaxTokens : continuationModeMaxTokens);
        const startedAt = Date.now();
        const cancellationTokenSource = new vscode.CancellationTokenSource();

        try {
            const response = await selectedModel.sendRequest(
                promptMessages,
                {
                    justification:
                        "MSSQL inline SQL completion debug replay compares the same prompt against different overrides.",
                    modelOptions: createLanguageModelMaxTokenOptions(maxTokens),
                },
                cancellationTokenSource.token,
            );
            const rawResponse = await collectText(response, cancellationTokenSource.token);
            const sanitizedResponse = sanitizeInlineCompletionText(
                rawResponse,
                getEffectiveMaxCompletionChars(
                    intentMode ? 2000 : 400,
                    overrides.maxTokens ?? profile?.maxTokens,
                ),
                linePrefix,
                intentMode,
            );
            let finalCompletionText = fixLeadingWhitespace(
                sanitizedResponse,
                linePrefix,
                undefined,
                intentMode,
            );
            finalCompletionText = suppressDocumentSuffixOverlap(finalCompletionText, suffix);
            const result = !sanitizedResponse
                ? rawResponse.trim()
                    ? "emptyFromSanitizer"
                    : "emptyFromModel"
                : finalCompletionText
                  ? "success"
                  : "emptyFromSanitizer";

            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result,
                latencyMs: Date.now() - startedAt,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaObjectCount
                        : 0,
                schemaSystemObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaSystemObjectCount
                        : 0,
                schemaForeignKeyCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaForeignKeyCount
                        : 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map((message) => ({
                    role:
                        message.role === vscode.LanguageModelChatMessageRole.Assistant
                            ? "assistant"
                            : "user",
                    content: message.content
                        .map((part) =>
                            part instanceof vscode.LanguageModelTextPart ? part.value : "",
                        )
                        .join(""),
                })),
                rawResponse,
                sanitizedResponse,
                finalCompletionText,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                locals: {
                    ...sourceEvent.locals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    useSchemaContext,
                    effectiveMaxTokens: maxTokens,
                    replaySourceEventId: sourceEvent.id,
                    replayedAt: new Date().toISOString(),
                },
            });
        } catch (error) {
            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result: "error",
                latencyMs: Date.now() - startedAt,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaObjectCount
                        : 0,
                schemaSystemObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaSystemObjectCount
                        : 0,
                schemaForeignKeyCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaForeignKeyCount
                        : 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map((message) => ({
                    role:
                        message.role === vscode.LanguageModelChatMessageRole.Assistant
                            ? "assistant"
                            : "user",
                    content: message.content
                        .map((part) =>
                            part instanceof vscode.LanguageModelTextPart ? part.value : "",
                        )
                        .join(""),
                })),
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                locals: {
                    ...sourceEvent.locals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    useSchemaContext,
                    effectiveMaxTokens: maxTokens,
                    replaySourceEventId: sourceEvent.id,
                    replayedAt: new Date().toISOString(),
                },
                error: {
                    message: getErrorMessage(error),
                    ...(error instanceof Error && error.name ? { name: error.name } : {}),
                    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
                },
            });
        } finally {
            cancellationTokenSource.dispose();
        }
    }

    private async selectReplayModel(
        modelSelectorOverride: string | null,
        modelPreference: InlineCompletionModelPreference | undefined,
    ): Promise<vscode.LanguageModelChat | undefined> {
        const effectiveSelector =
            modelSelectorOverride ?? (modelPreference ? undefined : getConfiguredModelSelector());
        const all = await selectConfiguredLanguageModels();
        if (effectiveSelector) {
            const matched = matchLanguageModelChatToSelector(all, effectiveSelector);
            if (matched) {
                return matched;
            }
        }

        return selectPreferredModel(all, modelPreference);
    }
}

function createState(options: {
    availableModels: InlineCompletionDebugModelOption[];
    effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    selectedEventId: string | undefined;
    customPromptDialogOpen: boolean;
    customPromptValue: string | null;
    customPromptLastSavedAt: number | undefined;
}): InlineCompletionDebugWebviewState {
    const overrides = inlineCompletionDebugStore.getOverrides();
    const profile = getInlineCompletionDebugPresetProfile(overrides.profileId);
    const configuredModelSelector = getConfiguredModelSelector();
    const effectiveOption =
        (profile ? undefined : options.effectiveDefaultModelOption) ??
        pickDefaultModelOption(
            options.availableModels,
            configuredModelSelector,
            profile?.modelPreference,
        );
    return {
        events: inlineCompletionDebugStore.getEvents(),
        overrides,
        defaults: {
            configuredModelSelector,
            effectiveModelSelector: effectiveOption?.selector,
            effectiveModelLabel: effectiveOption?.label,
            useSchemaContext: getConfiguredUseSchemaContext(),
            debounceMs: profile?.debounceMs ?? automaticTriggerDebounceMs,
            continuationMaxTokens: continuationModeMaxTokens,
            intentMaxTokens: intentModeMaxTokens,
            enabledCategories: profile
                ? [...profile.enabledCategories]
                : getConfiguredEnabledCategories(),
            allowAutomaticTriggers: true,
        },
        profiles: [...inlineCompletionDebugProfileOptions],
        availableModels: options.availableModels,
        selectedEventId: options.selectedEventId,
        recordWhenClosed: getRecordWhenClosedSetting(),
        customPrompt: {
            dialogOpen: options.customPromptDialogOpen,
            savedValue: options.customPromptValue,
            defaultValue: DEFAULT_CUSTOM_PROMPT,
            lastSavedAt: options.customPromptLastSavedAt,
        },
    };
}

function pickDefaultModelOption(
    availableModels: InlineCompletionDebugModelOption[],
    configuredSelector: string | undefined,
    modelPreference?: InlineCompletionModelPreference,
): InlineCompletionDebugModelOption | undefined {
    if (!modelPreference && configuredSelector) {
        const trimmed = configuredSelector.trim();
        const matched =
            availableModels.find((model) => model.selector === trimmed) ??
            availableModels.find((model) => model.family === trimmed);
        if (matched) {
            return matched;
        }
    }

    return selectPreferredModel(availableModels, modelPreference);
}

function compareModelOptions(
    left: InlineCompletionDebugModelOption,
    right: InlineCompletionDebugModelOption,
): number {
    return (
        left.providerLabel.localeCompare(right.providerLabel, undefined, { sensitivity: "base" }) ||
        left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
            numeric: true,
        }) ||
        left.id.localeCompare(right.id, undefined, { sensitivity: "base" })
    );
}

function getConfiguredModelSelector(): string | undefined {
    return (
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsModelFamily, "")
            ?.trim() || undefined
    );
}

function getConfiguredUseSchemaContext(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ?? false
    );
}

function getConfiguredEnabledCategories() {
    const configured = vscode.workspace
        .getConfiguration()
        .get<unknown>(Constants.configCopilotInlineCompletionsEnabledCategories, undefined);
    return normalizeInlineCompletionCategories(configured);
}

function getRecordWhenClosedSetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsDebugRecordWhenClosed, false) ??
        false
    );
}

function getConfigurationTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function cloneBaseEvent(event: InlineCompletionDebugEvent): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: event.timestamp,
        documentUri: event.documentUri,
        documentFileName: event.documentFileName,
        line: event.line,
        column: event.column,
        triggerKind: "invoke",
        explicitFromUser: true,
        completionCategory:
            event.completionCategory ?? getInlineCompletionCategory(event.intentMode),
        intentMode: event.intentMode,
        inferredSystemQuery: event.inferredSystemQuery,
        modelFamily: event.modelFamily,
        modelId: event.modelId,
        modelVendor: event.modelVendor,
        result: event.result,
        latencyMs: event.latencyMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        schemaObjectCount: event.schemaObjectCount,
        schemaSystemObjectCount: event.schemaSystemObjectCount,
        schemaForeignKeyCount: event.schemaForeignKeyCount,
        usedSchemaContext: event.usedSchemaContext,
        overridesApplied: event.overridesApplied,
        promptMessages: event.promptMessages,
        rawResponse: event.rawResponse,
        sanitizedResponse: event.sanitizedResponse,
        finalCompletionText: event.finalCompletionText,
        schemaContextFormatted: event.schemaContextFormatted,
        locals: event.locals,
        error: event.error,
    };
}

function getOverridesApplied(overrides: InlineCompletionDebugOverrides) {
    return {
        ...(overrides.profileId ? { profileId: overrides.profileId } : {}),
        ...(overrides.modelSelector ? { modelSelector: overrides.modelSelector } : {}),
        ...(overrides.useSchemaContext !== null
            ? { useSchemaContext: overrides.useSchemaContext }
            : {}),
        ...(overrides.debounceMs !== null ? { debounceMs: overrides.debounceMs } : {}),
        ...(overrides.maxTokens !== null ? { maxTokens: overrides.maxTokens } : {}),
        ...(overrides.enabledCategories !== null
            ? { enabledCategories: overrides.enabledCategories }
            : {}),
        customSystemPromptUsed: !!overrides.customSystemPrompt,
    };
}
