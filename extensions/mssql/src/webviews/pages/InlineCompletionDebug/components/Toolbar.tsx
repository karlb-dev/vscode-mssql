/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Ref, useCallback, useMemo } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    Option,
    Slider,
    Text,
    ToggleButton,
    Toolbar,
    ToolbarDivider,
    Tooltip,
    makeStyles,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowDown16Regular,
    ArrowDownloadRegular,
    ArrowUploadRegular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
    FilterRegular,
} from "@fluentui/react-icons";
import {
    InlineCompletionCategory,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugWebviewState,
    inlineCompletionCategories,
} from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";

const useStyles = makeStyles({
    wrapper: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    row: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        rowGap: "8px",
        columnGap: "8px",
        ...shorthands.padding("8px", "12px"),
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        columnGap: "12px",
        ...shorthands.padding("8px", "12px"),
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
    },
    field: {
        minWidth: "170px",
    },
    compactField: {
        minWidth: "120px",
    },
    sliderField: {
        minWidth: "240px",
    },
    checkboxLabel: {
        display: "flex",
        alignItems: "center",
    },
    recordDot: {
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: "var(--vscode-editorWarning-foreground)",
        ...shorthands.margin("0", "6px", "0", 0),
    },
    recordDotActive: {
        backgroundColor: "var(--vscode-errorForeground)",
        boxShadow: `0 0 0 2px color-mix(in srgb, var(--vscode-errorForeground) 35%, transparent)`,
    },
    textureGroup: {
        display: "flex",
        alignItems: "flex-end",
        columnGap: "6px",
    },
    stretchInput: {
        flex: 1,
    },
    summary: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        columnGap: "8px",
        minWidth: "280px",
        color: "var(--vscode-descriptionForeground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: tokens.fontSizeBase200,
        whiteSpace: "nowrap",
    },
    warning: {
        color: "var(--vscode-editorWarning-foreground)",
    },
    filterInput: {
        flex: 1,
    },
});

export const InlineCompletionDebugToolbar = ({
    state,
    filterInputRef,
    filterQuery,
    onFilterQueryChange,
    filterWarning,
    summary,
    autoScroll,
    onAutoScrollChange,
}: {
    state: InlineCompletionDebugWebviewState;
    filterInputRef?: Ref<HTMLInputElement>;
    filterQuery: string;
    onFilterQueryChange: (value: string) => void;
    filterWarning?: string;
    summary: {
        eventCount: number;
        documentCount: number;
        averageLatency: number;
    };
    autoScroll: boolean;
    onAutoScrollChange: (value: boolean) => void;
}) => {
    const classes = useStyles();
    const {
        clearEvents,
        selectProfile,
        updateOverrides,
        setRecordWhenClosed,
        openCustomPromptDialog,
        importSession,
        exportSession,
        resetCustomPrompt,
    } = useInlineCompletionDebugContext();

    const blurActiveElementSoon = useCallback(() => {
        requestAnimationFrame(() => {
            (document.activeElement as HTMLElement | null)?.blur?.();
        });
    }, []);

    const selectedProfileOption =
        state.overrides.profileId ?? state.defaults.effectiveProfileId ?? "custom";
    const selectedProfile = state.profiles.find((profile) => profile.id === selectedProfileOption);
    const selectedProfileDisplayValue = selectedProfile?.label ?? "Custom";
    const selectedModelOption = state.overrides.modelSelector ?? "__default__";
    const defaultModelLabel = getDefaultModelLabel(state);
    const selectedModelDisplayValue =
        state.availableModels.find((model) => model.selector === state.overrides.modelSelector)
            ?.label ??
        state.overrides.modelSelector ??
        defaultModelLabel;
    const schemaContextChecked =
        state.overrides.useSchemaContext ?? state.defaults.useSchemaContext;
    const autoTriggerChecked =
        state.overrides.allowAutomaticTriggers ?? state.defaults.allowAutomaticTriggers;
    const enabledCategories = state.overrides.enabledCategories ?? state.defaults.enabledCategories;
    const debounceValue = state.overrides.debounceMs ?? state.defaults.debounceMs;
    const customPromptIsActive = !!state.overrides.customSystemPrompt;
    const textureValue = useMemo(() => {
        if (customPromptIsActive) {
            return "custom";
        }
        if (state.overrides.forceIntentMode === true) {
            return "intent";
        }
        if (state.overrides.forceIntentMode === false) {
            return "continuation";
        }
        return "default";
    }, [customPromptIsActive, state.overrides.forceIntentMode]);

    const handleTextureChange = (value?: string) => {
        switch (value) {
            case "continuation":
                updateOverrides({
                    forceIntentMode: false,
                    customSystemPrompt: null,
                });
                blurActiveElementSoon();
                return;
            case "intent":
                updateOverrides({
                    forceIntentMode: true,
                    customSystemPrompt: null,
                });
                blurActiveElementSoon();
                return;
            case "custom":
                openCustomPromptDialog();
                return;
            default:
                updateOverrides({
                    forceIntentMode: null,
                    customSystemPrompt: null,
                });
                blurActiveElementSoon();
        }
    };

    const handleCategoryChange = (category: InlineCompletionCategory, enabled: boolean) => {
        const next = new Set(enabledCategories);
        if (enabled) {
            next.add(category);
        } else {
            next.delete(category);
        }

        const orderedNext = inlineCompletionCategories.filter((item) => next.has(item));
        updateOverrides({
            enabledCategories: completionCategoriesEqual(
                orderedNext,
                state.defaults.enabledCategories,
            )
                ? null
                : orderedNext,
        });
        blurActiveElementSoon();
    };

    return (
        <div className={classes.wrapper}>
            <div className={classes.row}>
                <Tooltip
                    content="Keep recording while the debug panel is closed"
                    relationship="label">
                    <ToggleButton
                        checked={state.recordWhenClosed}
                        onClick={() => {
                            setRecordWhenClosed(!state.recordWhenClosed);
                            blurActiveElementSoon();
                        }}>
                        <span
                            className={`${classes.recordDot} ${
                                state.recordWhenClosed ? classes.recordDotActive : ""
                            }`}
                        />
                        Record Closed
                    </ToggleButton>
                </Tooltip>

                <Tooltip content="Clear the in-memory ring buffer" relationship="label">
                    <Button
                        icon={<DeleteRegular />}
                        onClick={() => {
                            clearEvents();
                            blurActiveElementSoon();
                        }}>
                        Clear
                    </Button>
                </Tooltip>

                <Tooltip
                    content="Keep the newest event visible as rows arrive"
                    relationship="label">
                    <ToggleButton
                        checked={autoScroll}
                        icon={<ArrowDown16Regular />}
                        onClick={() => {
                            onAutoScrollChange(!autoScroll);
                            blurActiveElementSoon();
                        }}>
                        Auto Scroll
                    </ToggleButton>
                </Tooltip>

                <ToolbarDivider />

                <Tooltip
                    content={selectedProfile?.description ?? "Session-only debug settings"}
                    relationship="description">
                    <Field label="Profile" className={classes.field}>
                        <Dropdown
                            size="small"
                            selectedOptions={[selectedProfileOption]}
                            value={selectedProfileDisplayValue}
                            onOptionSelect={(_, data) => {
                                selectProfile(
                                    (data.optionValue ??
                                        "custom") as InlineCompletionDebugProfileId,
                                );
                                blurActiveElementSoon();
                            }}>
                            {state.profiles.map((profile) => (
                                <Option key={profile.id} value={profile.id} text={profile.label}>
                                    {profile.label}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>
                </Tooltip>

                <Field label="Model" className={classes.field}>
                    <Dropdown
                        size="small"
                        selectedOptions={[selectedModelOption]}
                        value={selectedModelDisplayValue}
                        onOptionSelect={(_, data) => {
                            updateOverrides({
                                modelSelector:
                                    data.optionValue === "__default__"
                                        ? null
                                        : (data.optionValue ?? null),
                            });
                            blurActiveElementSoon();
                        }}>
                        <Option value="__default__" text={defaultModelLabel}>
                            {defaultModelLabel}
                        </Option>
                        {state.availableModels.map((model) => (
                            <Option key={model.selector} value={model.selector} text={model.label}>
                                {model.label}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>

                <div className={classes.textureGroup}>
                    <Field label="Texture" className={classes.field}>
                        <Dropdown
                            size="small"
                            selectedOptions={[textureValue]}
                            value={
                                textureValue === "custom"
                                    ? "Custom (active)"
                                    : textureValue === "continuation"
                                      ? "Continuation"
                                      : textureValue === "intent"
                                        ? "Intent"
                                        : "Default (auto)"
                            }
                            onOptionSelect={(_, data) => handleTextureChange(data.optionValue)}>
                            <Option value="default">Default (auto)</Option>
                            <Option value="continuation">Continuation</Option>
                            <Option value="intent">Intent</Option>
                            <Option value="custom">Custom</Option>
                        </Dropdown>
                    </Field>

                    {state.customPrompt.savedValue ? (
                        <>
                            <Tooltip content="Edit the saved custom prompt" relationship="label">
                                <Button icon={<EditRegular />} onClick={openCustomPromptDialog}>
                                    Edit
                                </Button>
                            </Tooltip>
                            <Tooltip content="Clear the saved custom prompt" relationship="label">
                                <Button
                                    appearance="subtle"
                                    icon={<DismissRegular />}
                                    onClick={() => {
                                        resetCustomPrompt();
                                        blurActiveElementSoon();
                                    }}
                                />
                            </Tooltip>
                        </>
                    ) : null}
                </div>

                <Checkbox
                    checked={enabledCategories.includes("continuation")}
                    label="Continuation"
                    className={classes.checkboxLabel}
                    onChange={(_, data) => handleCategoryChange("continuation", !!data.checked)}
                />

                <Checkbox
                    checked={enabledCategories.includes("intent")}
                    label="Intent"
                    className={classes.checkboxLabel}
                    onChange={(_, data) => handleCategoryChange("intent", !!data.checked)}
                />

                <Field
                    label={`Eagerness ${debounceValue} ms`}
                    className={classes.sliderField}
                    hint="Automatic-trigger debounce">
                    <Slider
                        min={50}
                        max={1500}
                        step={50}
                        value={debounceValue}
                        onChange={(_, data) =>
                            updateOverrides({
                                debounceMs:
                                    data.value === state.defaults.debounceMs ? null : data.value,
                            })
                        }
                        onMouseUp={blurActiveElementSoon}
                        onKeyUp={blurActiveElementSoon}
                    />
                </Field>

                <Field label="Max Tokens" className={classes.compactField}>
                    <Input
                        size="small"
                        type="number"
                        value={state.overrides.maxTokens?.toString() ?? ""}
                        placeholder="auto"
                        onChange={(_, data) =>
                            updateOverrides({
                                maxTokens: data.value ? Number(data.value) : null,
                            })
                        }
                    />
                </Field>

                <Checkbox
                    checked={schemaContextChecked}
                    label="Schema ctx"
                    className={classes.checkboxLabel}
                    onChange={(_, data) => {
                        updateOverrides({
                            useSchemaContext:
                                data.checked === state.defaults.useSchemaContext
                                    ? null
                                    : !!data.checked,
                        });
                        blurActiveElementSoon();
                    }}
                />

                <Checkbox
                    checked={autoTriggerChecked}
                    label="Auto trigger"
                    className={classes.checkboxLabel}
                    onChange={(_, data) => {
                        updateOverrides({
                            allowAutomaticTriggers:
                                data.checked === state.defaults.allowAutomaticTriggers
                                    ? null
                                    : !!data.checked,
                        });
                        blurActiveElementSoon();
                    }}
                />

                <Toolbar aria-label="Inline completion debug imports" size="small">
                    <Button
                        icon={<ArrowUploadRegular />}
                        onClick={() => {
                            importSession();
                            blurActiveElementSoon();
                        }}>
                        Import JSON
                    </Button>
                    <Button
                        icon={<ArrowDownloadRegular />}
                        onClick={() => {
                            exportSession();
                            blurActiveElementSoon();
                        }}>
                        Export JSON
                    </Button>
                </Toolbar>
            </div>

            <div className={classes.filterRow}>
                <Input
                    ref={filterInputRef}
                    className={classes.filterInput}
                    size="small"
                    value={filterQuery}
                    onChange={(_, data) => onFilterQueryChange(data.value)}
                    contentBefore={<FilterRegular />}
                    placeholder='result != "error" and doc ~= "orders"'
                />

                <div className={classes.summary}>
                    {filterWarning ? (
                        <Text size={200} className={classes.warning}>
                            {filterWarning}
                        </Text>
                    ) : null}
                    <span>
                        {summary.eventCount} events | {summary.documentCount} docs | avg{" "}
                        {summary.averageLatency} ms
                    </span>
                </div>
            </div>
        </div>
    );
};

function getDefaultModelLabel(state: InlineCompletionDebugWebviewState): string {
    const profile = state.profiles.find(
        (item) => item.id === state.defaults.effectiveProfileId && item.id !== "custom",
    );
    const suffix = profile ? `${profile.label} default` : "default";
    const label = state.defaults.effectiveModelLabel;
    if (label) {
        return `${label} (${suffix})`;
    }

    const fallback =
        state.defaults.effectiveModelSelector ?? state.defaults.configuredModelSelector;
    return fallback ? `${fallback} (${suffix})` : `(${suffix})`;
}

function completionCategoriesEqual(
    left: readonly InlineCompletionCategory[],
    right: readonly InlineCompletionCategory[],
): boolean {
    return (
        left.length === right.length &&
        inlineCompletionCategories.every(
            (category) => left.includes(category) === right.includes(category),
        )
    );
}
