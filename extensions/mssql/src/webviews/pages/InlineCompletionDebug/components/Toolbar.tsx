/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReactNode, type Ref, useCallback, useMemo, useState } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    Option,
    Slider,
    Switch,
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
    ArrowClockwise16Regular,
    ArrowDown16Regular,
    ArrowDownloadRegular,
    ArrowUploadRegular,
    ChevronDown16Regular,
    ChevronRight16Regular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
    FilterRegular,
    Info16Regular,
    SaveRegular,
} from "@fluentui/react-icons";
import {
    InlineCompletionCategory,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugSchemaContextOverrides,
    InlineCompletionDebugWebviewState,
    InlineCompletionSchemaBudgetProfileId,
    InlineCompletionSchemaColumnRepresentation,
    InlineCompletionSchemaContextChannel,
    InlineCompletionSchemaPromptMessageOrder,
    inlineCompletionCategories,
    inlineCompletionSchemaBudgetProfileIds,
} from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";

type SchemaSectionId = "shape" | "size" | "caps" | "prompt" | "weights" | "cache" | "assembly";

type SchemaBudgetNumberKey =
    | "maxSchemas"
    | "maxTables"
    | "maxViews"
    | "maxRoutines"
    | "maxColumnsPerObject"
    | "maxForeignKeys"
    | "maxTableNameOnlyInventory"
    | "maxViewNameOnlyInventory"
    | "maxRoutineNameOnlyInventory"
    | "maxSystemObjects"
    | "maxSchemaContextRelevanceTerms"
    | "maxParametersPerRoutine"
    | "smallSchemaThreshold"
    | "largeSchemaThreshold"
    | "outlierSchemaThreshold"
    | "maxPromptChars"
    | "maxPromptTokens"
    | "defaultSchemaWeight"
    | "cacheTtlMs";

interface SchemaBudgetBaseline {
    columnRepresentation: InlineCompletionSchemaColumnRepresentation;
    foreignKeyExpansionDepth: 0 | 1 | 2;
    includeRoutines: boolean;
    relevanceTermRecencyBias: boolean;
    schemaSizeAdaptive: boolean;
    columnNameRelevanceWeight: number;
}

interface SchemaNumberControl {
    key: SchemaBudgetNumberKey;
    label: string;
    tooltip: string;
    min?: number;
    step?: number;
}

const schemaProfileOptions: readonly {
    id: InlineCompletionSchemaBudgetProfileId;
    label: string;
    description: string;
}[] = [
    {
        id: "tight",
        label: "Tight",
        description: "Smallest prompt footprint; favors the most relevant objects.",
    },
    {
        id: "balanced",
        label: "Balanced (default)",
        description: "Default schema budget close to production behavior.",
    },
    {
        id: "generous",
        label: "Generous",
        description: "More objects, columns, routines, and two-hop FK expansion.",
    },
    {
        id: "unlimited",
        label: "Unlimited",
        description: "Very broad context for stress testing large prompt windows.",
    },
    {
        id: "custom",
        label: "Custom",
        description: "Session-only schema context overrides from the controls below.",
    },
];

const schemaBaselines: Record<InlineCompletionSchemaBudgetProfileId, SchemaBudgetBaseline> = {
    tight: {
        columnRepresentation: "compact",
        foreignKeyExpansionDepth: 1,
        includeRoutines: true,
        relevanceTermRecencyBias: true,
        schemaSizeAdaptive: true,
        columnNameRelevanceWeight: 0.28,
    },
    balanced: {
        columnRepresentation: "verbose",
        foreignKeyExpansionDepth: 1,
        includeRoutines: true,
        relevanceTermRecencyBias: true,
        schemaSizeAdaptive: true,
        columnNameRelevanceWeight: 0.36,
    },
    generous: {
        columnRepresentation: "verbose",
        foreignKeyExpansionDepth: 2,
        includeRoutines: true,
        relevanceTermRecencyBias: true,
        schemaSizeAdaptive: true,
        columnNameRelevanceWeight: 0.45,
    },
    unlimited: {
        columnRepresentation: "verbose",
        foreignKeyExpansionDepth: 2,
        includeRoutines: true,
        relevanceTermRecencyBias: true,
        schemaSizeAdaptive: true,
        columnNameRelevanceWeight: 0.5,
    },
    custom: {
        columnRepresentation: "verbose",
        foreignKeyExpansionDepth: 1,
        includeRoutines: true,
        relevanceTermRecencyBias: true,
        schemaSizeAdaptive: true,
        columnNameRelevanceWeight: 0.36,
    },
};

const capControls: readonly SchemaNumberControl[] = [
    {
        key: "maxSchemas",
        label: "Schemas",
        tooltip: "Maximum schemas listed in the prompt-ready context.",
        min: 0,
    },
    {
        key: "maxTables",
        label: "Tables",
        tooltip: "Maximum detailed table entries after relevance ranking.",
        min: 0,
    },
    {
        key: "maxViews",
        label: "Views",
        tooltip: "Maximum detailed view entries after relevance ranking.",
        min: 0,
    },
    {
        key: "maxRoutines",
        label: "Routines",
        tooltip: "Maximum detailed procedure and function entries.",
        min: 0,
    },
    {
        key: "maxColumnsPerObject",
        label: "Cols/object",
        tooltip: "Maximum columns emitted for each detailed table or view.",
        min: 0,
    },
    {
        key: "maxForeignKeys",
        label: "FKs/object",
        tooltip: "Maximum foreign keys kept for each detailed table.",
        min: 0,
    },
    {
        key: "maxTableNameOnlyInventory",
        label: "Table inventory",
        tooltip: "Additional table names shown without column details.",
        min: 0,
    },
    {
        key: "maxViewNameOnlyInventory",
        label: "View inventory",
        tooltip: "Additional view names shown without column details.",
        min: 0,
    },
    {
        key: "maxRoutineNameOnlyInventory",
        label: "Routine inventory",
        tooltip: "Additional routine names shown without parameter details.",
        min: 0,
    },
    {
        key: "maxSystemObjects",
        label: "System objects",
        tooltip: "Maximum system catalog and DMV objects shown.",
        min: 0,
    },
    {
        key: "maxSchemaContextRelevanceTerms",
        label: "Relevance terms",
        tooltip: "Maximum extracted SQL/name terms used for relevance scoring.",
        min: 0,
    },
    {
        key: "maxParametersPerRoutine",
        label: "Params/routine",
        tooltip: "Maximum parameters emitted for each detailed routine.",
        min: 0,
    },
];

const sizeControls: readonly SchemaNumberControl[] = [
    {
        key: "smallSchemaThreshold",
        label: "Small threshold",
        tooltip: "Object count at or below which small-schema expansion can include more detail.",
        min: 0,
    },
    {
        key: "largeSchemaThreshold",
        label: "Large threshold",
        tooltip: "Object count where large-schema compaction starts.",
        min: 0,
    },
    {
        key: "outlierSchemaThreshold",
        label: "Outlier threshold",
        tooltip: "Object count where inventory-first outlier safeguards kick in.",
        min: 0,
    },
];

const promptBudgetControls: readonly SchemaNumberControl[] = [
    {
        key: "maxPromptChars",
        label: "Max prompt chars",
        tooltip: "Hard character budget for formatted schema context before degradation.",
        min: 0,
        step: 500,
    },
    {
        key: "maxPromptTokens",
        label: "Max prompt tokens",
        tooltip: "Optional token budget for formatted schema context before degradation.",
        min: 0,
        step: 100,
    },
];

const cacheControls: readonly SchemaNumberControl[] = [
    {
        key: "cacheTtlMs",
        label: "TTL (ms)",
        tooltip: "How long fetched schema metadata remains cached for this connection.",
        min: 0,
        step: 1000,
    },
];

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
    schemaField: {
        minWidth: "146px",
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
    schemaPanel: {
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.padding("0", "12px", "10px"),
        maxHeight: "min(62vh, 640px)",
        overflowY: "auto",
    },
    schemaPanelHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        minHeight: "38px",
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: "var(--vscode-sideBar-background)",
        ...shorthands.padding("2px", 0),
    },
    schemaPanelCollapseButton: {
        justifyContent: "flex-start",
        fontWeight: tokens.fontWeightSemibold,
    },
    schemaPanelActions: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    schemaPanelBody: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        columnGap: "18px",
        rowGap: "10px",
    },
    schemaSection: {
        minWidth: 0,
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.padding("4px", 0, 0),
    },
    schemaSectionWide: {
        gridColumn: "1 / -1",
    },
    schemaSectionHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
    },
    schemaSectionBody: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: "10px",
        ...shorthands.padding("8px", 0, "6px"),
    },
    schemaSectionBodyWide: {
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    },
    schemaInlineControls: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        alignItems: "center",
    },
    schemaSwitches: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "8px",
        alignItems: "center",
    },
    schemaControlLabel: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        minWidth: 0,
        whiteSpace: "normal",
    },
    schemaOverrideDot: {
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: "var(--vscode-focusBorder)",
        flexShrink: 0,
    },
    infoIcon: {
        color: "var(--vscode-descriptionForeground)",
        flexShrink: 0,
    },
    segmented: {
        display: "inline-flex",
        flexWrap: "wrap",
        gap: "4px",
        alignItems: "center",
    },
    segmentButton: {
        minWidth: "auto",
    },
    numberInput: {
        width: "100%",
    },
    weightSlider: {
        minWidth: "210px",
        flex: 1,
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
    const [schemaPanelOpen, setSchemaPanelOpen] = useState(false);
    const [openSchemaSections, setOpenSchemaSections] = useState<Record<SchemaSectionId, boolean>>({
        shape: true,
        size: false,
        caps: false,
        prompt: false,
        weights: false,
        cache: false,
        assembly: false,
    });
    const {
        clearEvents,
        selectProfile,
        updateOverrides,
        setRecordWhenClosed,
        openCustomPromptDialog,
        importSession,
        exportSession,
        saveTraceNow,
        resetCustomPrompt,
        refreshSchemaContext,
    } = useInlineCompletionDebugContext();

    const blurActiveElementSoon = useCallback(() => {
        requestAnimationFrame(() => {
            (document.activeElement as HTMLElement | null)?.blur?.();
        });
    }, []);

    const schemaContextOverride = asSchemaContextOverride(state.overrides.schemaContext);
    const defaultSchemaContext = asSchemaContextOverride(state.defaults.schemaContext);
    const selectedSchemaProfileOption = getSchemaProfileForDisplay(
        schemaContextOverride,
        defaultSchemaContext,
    );
    const schemaBaseline = schemaBaselines[selectedSchemaProfileOption];
    const selectedSchemaProfile = schemaProfileOptions.find(
        (profile) => profile.id === selectedSchemaProfileOption,
    );
    const schemaBudgetOverrides = getBudgetOverrides(schemaContextOverride);
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

    const setSchemaContextOverride = useCallback(
        (next: InlineCompletionDebugSchemaContextOverrides | null) => {
            updateOverrides({ schemaContext: compactSchemaContextOverride(next) });
        },
        [updateOverrides],
    );

    const updateSchemaTopLevel = useCallback(
        (key: keyof InlineCompletionDebugSchemaContextOverrides, value: unknown) => {
            const next: InlineCompletionDebugSchemaContextOverrides = {
                ...(schemaContextOverride ?? {}),
                budgetProfile: "custom",
            };
            if (value === undefined) {
                delete next[key];
            } else {
                next[key] = value;
            }
            setSchemaContextOverride(next);
        },
        [schemaContextOverride, setSchemaContextOverride],
    );

    const updateBudgetOverride = useCallback(
        (key: string, value: unknown) => {
            const nextBudgetOverrides: Record<string, unknown> = {
                ...getBudgetOverrides(schemaContextOverride),
            };
            if (value === undefined) {
                delete nextBudgetOverrides[key];
            } else {
                nextBudgetOverrides[key] = value;
            }

            const next: InlineCompletionDebugSchemaContextOverrides = {
                ...(schemaContextOverride ?? {}),
                budgetProfile: "custom",
                budgetOverrides: nextBudgetOverrides,
            };
            setSchemaContextOverride(next);
        },
        [schemaContextOverride, setSchemaContextOverride],
    );

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

    const handleSchemaProfileChange = (value?: string) => {
        const profileId = getSchemaBudgetProfileId(value) ?? "balanced";
        if (profileId === "custom") {
            setSchemaContextOverride({
                ...(schemaContextOverride ?? {}),
                budgetProfile: "custom",
            });
        } else {
            setSchemaContextOverride({ budgetProfile: profileId });
        }
        blurActiveElementSoon();
    };

    const toggleSchemaSection = (section: SchemaSectionId) => {
        setOpenSchemaSections((current) => ({
            ...current,
            [section]: !current[section],
        }));
    };

    const renderControlLabel = (label: string, tooltip: string, active: boolean) => (
        <span className={classes.schemaControlLabel}>
            {active ? <span className={classes.schemaOverrideDot} /> : null}
            <span>{label}</span>
            <Tooltip content={tooltip} relationship="description">
                <Info16Regular className={classes.infoIcon} />
            </Tooltip>
        </span>
    );

    const renderSection = (
        id: SchemaSectionId,
        label: string,
        content: ReactNode,
        wide: boolean = false,
    ) => {
        const open = openSchemaSections[id];
        return (
            <section
                className={`${classes.schemaSection} ${wide ? classes.schemaSectionWide : ""}`}>
                <Button
                    appearance="subtle"
                    className={classes.schemaSectionHeader}
                    icon={open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                    onClick={() => toggleSchemaSection(id)}>
                    {label}
                </Button>
                {open ? content : null}
            </section>
        );
    };

    const renderSegmented = <T extends string | number>({
        value,
        options,
        onChange,
    }: {
        value: T;
        options: readonly { value: T; label: string }[];
        onChange: (value: T) => void;
    }) => (
        <div className={classes.segmented}>
            {options.map((option) => (
                <Button
                    key={option.value}
                    size="small"
                    className={classes.segmentButton}
                    appearance={option.value === value ? "primary" : "secondary"}
                    onClick={() => {
                        onChange(option.value);
                        blurActiveElementSoon();
                    }}>
                    {option.label}
                </Button>
            ))}
        </div>
    );

    const renderNumberInput = (control: SchemaNumberControl) => {
        const value = readBudgetNumber(schemaBudgetOverrides, control.key);
        return (
            <Field
                key={control.key}
                label={renderControlLabel(
                    control.label,
                    control.tooltip,
                    hasBudgetOverride(schemaContextOverride, control.key),
                )}>
                <Input
                    className={classes.numberInput}
                    size="small"
                    type="number"
                    min={control.min}
                    step={control.step}
                    value={value === undefined ? "" : value.toString()}
                    placeholder="auto"
                    onChange={(_, data) => {
                        updateBudgetOverride(control.key, parseOptionalNumber(data.value));
                    }}
                />
            </Field>
        );
    };

    const columnRepresentation = readSchemaString(
        schemaContextOverride,
        defaultSchemaContext,
        "columnRepresentation",
        schemaBaseline.columnRepresentation,
    ) as InlineCompletionSchemaColumnRepresentation;
    const fkExpansionDepth = readSchemaBudgetNumber(
        schemaContextOverride,
        defaultSchemaContext,
        "foreignKeyExpansionDepth",
        schemaBaseline.foreignKeyExpansionDepth,
    ) as 0 | 1 | 2;
    const includeRoutines = readSchemaBoolean(
        schemaContextOverride,
        defaultSchemaContext,
        "includeRoutines",
        schemaBaseline.includeRoutines,
    );
    const relevanceTermRecencyBias = readSchemaBoolean(
        schemaContextOverride,
        defaultSchemaContext,
        "relevanceTermRecencyBias",
        schemaBaseline.relevanceTermRecencyBias,
    );
    const schemaSizeAdaptive = readSchemaBoolean(
        schemaContextOverride,
        defaultSchemaContext,
        "schemaSizeAdaptive",
        schemaBaseline.schemaSizeAdaptive,
    );
    const columnNameRelevanceWeight = readSchemaBudgetNumber(
        schemaContextOverride,
        defaultSchemaContext,
        "columnNameRelevanceWeight",
        schemaBaseline.columnNameRelevanceWeight,
    );
    const messageOrder = readSchemaString(
        schemaContextOverride,
        defaultSchemaContext,
        "messageOrder",
        "rules-then-data",
    ) as InlineCompletionSchemaPromptMessageOrder;
    const schemaContextChannel = readSchemaString(
        schemaContextOverride,
        defaultSchemaContext,
        "schemaContextChannel",
        "inline-with-data",
    ) as InlineCompletionSchemaContextChannel;

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

                <Tooltip
                    content={selectedSchemaProfile?.description ?? "Schema context budget"}
                    relationship="description">
                    <Field label="Schema" className={classes.schemaField}>
                        <Dropdown
                            size="small"
                            selectedOptions={[selectedSchemaProfileOption]}
                            value={selectedSchemaProfile?.label ?? "Balanced (default)"}
                            onOptionSelect={(_, data) =>
                                handleSchemaProfileChange(data.optionValue)
                            }>
                            {schemaProfileOptions.map((profile) => (
                                <Option key={profile.id} value={profile.id} text={profile.label}>
                                    {profile.label}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>
                </Tooltip>

                <ToggleButton
                    checked={schemaPanelOpen}
                    icon={schemaPanelOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                    onClick={() => {
                        setSchemaPanelOpen((value) => !value);
                        blurActiveElementSoon();
                    }}>
                    Customize schema
                </ToggleButton>

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
                    <Button
                        appearance="primary"
                        icon={<SaveRegular />}
                        onClick={() => {
                            saveTraceNow();
                            blurActiveElementSoon();
                        }}>
                        Save trace now
                    </Button>
                </Toolbar>
            </div>

            {schemaPanelOpen ? (
                <div className={classes.schemaPanel}>
                    <div className={classes.schemaPanelHeader}>
                        <Button
                            appearance="subtle"
                            className={classes.schemaPanelCollapseButton}
                            icon={<ChevronDown16Regular />}
                            onClick={() => {
                                setSchemaPanelOpen(false);
                                blurActiveElementSoon();
                            }}>
                            Customize schema
                        </Button>
                        <div className={classes.schemaPanelActions}>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<ArrowClockwise16Regular />}
                                onClick={() => {
                                    refreshSchemaContext();
                                    blurActiveElementSoon();
                                }}>
                                Refresh now
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<DismissRegular />}
                                onClick={() => {
                                    setSchemaContextOverride(null);
                                    blurActiveElementSoon();
                                }}>
                                Reset overrides
                            </Button>
                        </div>
                    </div>

                    <div className={classes.schemaPanelBody}>
                        {renderSection(
                            "shape",
                            "Shape",
                            <div className={classes.schemaSectionBody}>
                                <Field
                                    label={renderControlLabel(
                                        "Column representation",
                                        "Controls whether columns are names only, types without nullability, or verbose definitions.",
                                        hasTopLevelOverride(
                                            schemaContextOverride,
                                            "columnRepresentation",
                                        ),
                                    )}>
                                    {renderSegmented({
                                        value: columnRepresentation,
                                        options: [
                                            { value: "compact", label: "Compact" },
                                            { value: "types", label: "Types" },
                                            { value: "verbose", label: "Verbose" },
                                        ],
                                        onChange: (value) =>
                                            updateSchemaTopLevel("columnRepresentation", value),
                                    })}
                                </Field>
                                <Field
                                    label={renderControlLabel(
                                        "FK expansion depth",
                                        "Promotes directly or indirectly related foreign-key tables into detailed context.",
                                        hasBudgetOverride(
                                            schemaContextOverride,
                                            "foreignKeyExpansionDepth",
                                        ),
                                    )}>
                                    {renderSegmented({
                                        value: fkExpansionDepth,
                                        options: [
                                            { value: 0, label: "Off (0)" },
                                            { value: 1, label: "Direct (1)" },
                                            { value: 2, label: "Two-hop (2)" },
                                        ],
                                        onChange: (value) =>
                                            updateBudgetOverride("foreignKeyExpansionDepth", value),
                                    })}
                                </Field>
                                <div className={classes.schemaSwitches}>
                                    <Switch
                                        checked={includeRoutines}
                                        label={renderControlLabel(
                                            "Include routines",
                                            "Includes procedures and scalar/table-valued functions in the schema context.",
                                            hasTopLevelOverride(
                                                schemaContextOverride,
                                                "includeRoutines",
                                            ),
                                        )}
                                        onChange={(_, data) =>
                                            updateSchemaTopLevel("includeRoutines", data.checked)
                                        }
                                    />
                                    <Switch
                                        checked={relevanceTermRecencyBias}
                                        label={renderControlLabel(
                                            "Recency bias",
                                            "Weights terms near the cursor more strongly during schema ranking.",
                                            hasTopLevelOverride(
                                                schemaContextOverride,
                                                "relevanceTermRecencyBias",
                                            ),
                                        )}
                                        onChange={(_, data) =>
                                            updateSchemaTopLevel(
                                                "relevanceTermRecencyBias",
                                                data.checked,
                                            )
                                        }
                                    />
                                </div>
                            </div>,
                        )}

                        {renderSection(
                            "size",
                            "Size adaptivity",
                            <div className={classes.schemaSectionBody}>
                                <Switch
                                    checked={schemaSizeAdaptive}
                                    label={renderControlLabel(
                                        "Adaptive",
                                        "Changes strategy for small, medium, large, and outlier schemas.",
                                        hasTopLevelOverride(
                                            schemaContextOverride,
                                            "schemaSizeAdaptive",
                                        ),
                                    )}
                                    onChange={(_, data) =>
                                        updateSchemaTopLevel("schemaSizeAdaptive", data.checked)
                                    }
                                />
                                {sizeControls.map(renderNumberInput)}
                            </div>,
                        )}

                        {renderSection(
                            "caps",
                            "Caps",
                            <div
                                className={`${classes.schemaSectionBody} ${classes.schemaSectionBodyWide}`}>
                                {capControls.map(renderNumberInput)}
                            </div>,
                            true,
                        )}

                        {renderSection(
                            "prompt",
                            "Prompt budgets",
                            <div className={classes.schemaSectionBody}>
                                {promptBudgetControls.map(renderNumberInput)}
                            </div>,
                        )}

                        {renderSection(
                            "weights",
                            "Weights",
                            <div className={classes.schemaSectionBody}>
                                <Field
                                    label={renderControlLabel(
                                        "Default schema weight",
                                        "Adds relevance to objects in the connection default schema.",
                                        hasBudgetOverride(
                                            schemaContextOverride,
                                            "defaultSchemaWeight",
                                        ),
                                    )}>
                                    <Input
                                        className={classes.numberInput}
                                        size="small"
                                        type="number"
                                        min={0}
                                        step={100}
                                        value={
                                            readBudgetNumber(
                                                schemaBudgetOverrides,
                                                "defaultSchemaWeight",
                                            )?.toString() ?? ""
                                        }
                                        placeholder="auto"
                                        onChange={(_, data) =>
                                            updateBudgetOverride(
                                                "defaultSchemaWeight",
                                                parseOptionalNumber(data.value),
                                            )
                                        }
                                    />
                                </Field>
                                <Field
                                    label={renderControlLabel(
                                        `Column-name relevance ${columnNameRelevanceWeight.toFixed(2)}`,
                                        "Multiplier for matches between query terms and column names.",
                                        hasBudgetOverride(
                                            schemaContextOverride,
                                            "columnNameRelevanceWeight",
                                        ),
                                    )}>
                                    <div className={classes.schemaInlineControls}>
                                        <Slider
                                            className={classes.weightSlider}
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={columnNameRelevanceWeight}
                                            onChange={(_, data) =>
                                                updateBudgetOverride(
                                                    "columnNameRelevanceWeight",
                                                    data.value,
                                                )
                                            }
                                            onMouseUp={blurActiveElementSoon}
                                            onKeyUp={blurActiveElementSoon}
                                        />
                                        <Text size={200}>
                                            {hasBudgetOverride(
                                                schemaContextOverride,
                                                "columnNameRelevanceWeight",
                                            )
                                                ? columnNameRelevanceWeight.toFixed(2)
                                                : "auto"}
                                        </Text>
                                    </div>
                                </Field>
                            </div>,
                        )}

                        {renderSection(
                            "cache",
                            "Cache",
                            <div className={classes.schemaSectionBody}>
                                {cacheControls.map(renderNumberInput)}
                                <Button
                                    icon={<ArrowClockwise16Regular />}
                                    onClick={() => {
                                        refreshSchemaContext();
                                        blurActiveElementSoon();
                                    }}>
                                    Refresh now
                                </Button>
                            </div>,
                        )}

                        {renderSection(
                            "assembly",
                            "Prompt assembly",
                            <div className={classes.schemaSectionBody}>
                                <Field
                                    label={renderControlLabel(
                                        "Message order",
                                        "Orders the rules and data messages sent to the language model.",
                                        hasTopLevelOverride(schemaContextOverride, "messageOrder"),
                                    )}>
                                    {renderSegmented({
                                        value: messageOrder,
                                        options: [
                                            { value: "rules-then-data", label: "Rules then data" },
                                            { value: "data-then-rules", label: "Data then rules" },
                                        ],
                                        onChange: (value) =>
                                            updateSchemaTopLevel("messageOrder", value),
                                    })}
                                </Field>
                                <Field
                                    label={renderControlLabel(
                                        "Schema channel",
                                        "Places schema context inside the data message or in its own message.",
                                        hasTopLevelOverride(
                                            schemaContextOverride,
                                            "schemaContextChannel",
                                        ),
                                    )}>
                                    {renderSegmented({
                                        value: schemaContextChannel,
                                        options: [
                                            {
                                                value: "inline-with-data",
                                                label: "Inline with data",
                                            },
                                            {
                                                value: "separate-message",
                                                label: "Separate message",
                                            },
                                        ],
                                        onChange: (value) =>
                                            updateSchemaTopLevel("schemaContextChannel", value),
                                    })}
                                </Field>
                            </div>,
                        )}
                    </div>
                </div>
            ) : null}

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

function getSchemaBudgetProfileId(
    value: unknown,
): InlineCompletionSchemaBudgetProfileId | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    return inlineCompletionSchemaBudgetProfileIds.includes(
        value as InlineCompletionSchemaBudgetProfileId,
    )
        ? (value as InlineCompletionSchemaBudgetProfileId)
        : undefined;
}

function getSchemaProfileForDisplay(
    override: InlineCompletionDebugSchemaContextOverrides | null,
    defaults: InlineCompletionDebugSchemaContextOverrides | null,
): InlineCompletionSchemaBudgetProfileId {
    const candidate = override ?? defaults;
    const profile = getSchemaBudgetProfileId(candidate?.budgetProfile);
    if (profile) {
        return profile;
    }

    return candidate && hasSchemaContextValues(candidate) ? "custom" : "balanced";
}

function asSchemaContextOverride(
    value: unknown,
): InlineCompletionDebugSchemaContextOverrides | null {
    return isRecord(value) ? (value as InlineCompletionDebugSchemaContextOverrides) : null;
}

function compactSchemaContextOverride(
    value: InlineCompletionDebugSchemaContextOverrides | null,
): InlineCompletionDebugSchemaContextOverrides | null {
    if (!value) {
        return null;
    }

    const compacted: InlineCompletionDebugSchemaContextOverrides = {};
    for (const [key, rawValue] of Object.entries(value)) {
        if (rawValue === undefined || rawValue === "") {
            continue;
        }
        if (key === "budgetOverrides" && isRecord(rawValue)) {
            const compactedBudget = compactRecord(rawValue);
            if (Object.keys(compactedBudget).length > 0) {
                compacted.budgetOverrides = compactedBudget;
            }
            continue;
        }
        compacted[key] = rawValue;
    }

    return hasSchemaContextValues(compacted) ? compacted : null;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
    const compacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        if (value !== undefined && value !== "") {
            compacted[key] = value;
        }
    }
    return compacted;
}

function hasSchemaContextValues(value: InlineCompletionDebugSchemaContextOverrides): boolean {
    return Object.entries(value).some(([key, rawValue]) => {
        if (rawValue === undefined || rawValue === null || rawValue === "") {
            return false;
        }
        if (key === "budgetOverrides") {
            return isRecord(rawValue) && Object.keys(compactRecord(rawValue)).length > 0;
        }
        return true;
    });
}

function getBudgetOverrides(
    value: InlineCompletionDebugSchemaContextOverrides | null,
): Record<string, unknown> {
    return isRecord(value?.budgetOverrides) ? value.budgetOverrides : {};
}

function hasTopLevelOverride(
    value: InlineCompletionDebugSchemaContextOverrides | null,
    key: keyof InlineCompletionDebugSchemaContextOverrides,
): boolean {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function hasBudgetOverride(
    value: InlineCompletionDebugSchemaContextOverrides | null,
    key: string,
): boolean {
    const budgetOverrides = getBudgetOverrides(value);
    return Object.prototype.hasOwnProperty.call(budgetOverrides, key);
}

function readBudgetNumber(
    budgetOverrides: Record<string, unknown>,
    key: string,
): number | undefined {
    const value = budgetOverrides[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readSchemaBudgetNumber(
    override: InlineCompletionDebugSchemaContextOverrides | null,
    defaults: InlineCompletionDebugSchemaContextOverrides | null,
    key: string,
    fallback: number,
): number {
    return (
        readBudgetNumber(getBudgetOverrides(override), key) ??
        readBudgetNumber(getBudgetOverrides(defaults), key) ??
        fallback
    );
}

function readSchemaBoolean(
    override: InlineCompletionDebugSchemaContextOverrides | null,
    defaults: InlineCompletionDebugSchemaContextOverrides | null,
    key: keyof InlineCompletionDebugSchemaContextOverrides,
    fallback: boolean,
): boolean {
    if (typeof override?.[key] === "boolean") {
        return override[key] as boolean;
    }
    if (typeof defaults?.[key] === "boolean") {
        return defaults[key] as boolean;
    }
    return fallback;
}

function readSchemaString(
    override: InlineCompletionDebugSchemaContextOverrides | null,
    defaults: InlineCompletionDebugSchemaContextOverrides | null,
    key: keyof InlineCompletionDebugSchemaContextOverrides,
    fallback: string,
): string {
    if (typeof override?.[key] === "string") {
        return override[key] as string;
    }
    if (typeof defaults?.[key] === "string") {
        return defaults[key] as string;
    }
    return fallback;
}

function parseOptionalNumber(value: string): number | undefined {
    if (value.trim().length === 0) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
