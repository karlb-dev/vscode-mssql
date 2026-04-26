/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, ReactNode, useCallback, useContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReducers,
    InlineCompletionDebugWebviewState,
} from "../../../sharedInterfaces/inlineCompletionDebug";

export interface InlineCompletionDebugContextProps {
    clearEvents: () => void;
    selectEvent: (eventId?: string) => void;
    updateOverrides: (overrides: Partial<InlineCompletionDebugWebviewState["overrides"]>) => void;
    selectProfile: (profileId: InlineCompletionDebugProfileId) => void;
    setRecordWhenClosed: (enabled: boolean) => void;
    openCustomPromptDialog: () => void;
    closeCustomPromptDialog: () => void;
    saveCustomPrompt: (value: string) => void;
    resetCustomPrompt: () => void;
    refreshSchemaContext: () => void;
    importSession: () => void;
    exportSession: () => void;
    saveTraceNow: () => void;
    sessionsActivated: () => void;
    sessionsRefresh: () => void;
    sessionsToggleTrace: (fileKey: string, included: boolean) => void;
    sessionsSetAllTraces: (included: boolean) => void;
    sessionsLoadIncluded: () => void;
    sessionsAddFile: () => void;
    sessionsChangeFolder: () => void;
    sessionsSyncToDatabase: () => void;
    replayEvent: (eventId: string) => void;
    replaySessionEvent: (event: InlineCompletionDebugEvent) => void;
    copyEventPayload: (
        eventId: string,
        kind:
            | "id"
            | "json"
            | "prompt"
            | "systemPrompt"
            | "userPrompt"
            | "rawResponse"
            | "sanitizedResponse",
    ) => void;
}

const InlineCompletionDebugContext = createContext<InlineCompletionDebugContextProps | undefined>(
    undefined,
);

export const InlineCompletionDebugStateProvider = ({ children }: { children: ReactNode }) => {
    const { extensionRpc } = useVscodeWebview<
        InlineCompletionDebugWebviewState,
        InlineCompletionDebugReducers
    >();

    const clearEvents = useCallback(() => {
        extensionRpc.action("clearEvents", {});
    }, [extensionRpc]);

    const selectEvent = useCallback(
        (eventId?: string) => {
            extensionRpc.action("selectEvent", { eventId });
        },
        [extensionRpc],
    );

    const updateOverrides = useCallback(
        (overrides: Partial<InlineCompletionDebugWebviewState["overrides"]>) => {
            extensionRpc.action("updateOverrides", { overrides });
        },
        [extensionRpc],
    );

    const selectProfile = useCallback(
        (profileId: InlineCompletionDebugProfileId) => {
            extensionRpc.action("selectProfile", { profileId });
        },
        [extensionRpc],
    );

    const setRecordWhenClosed = useCallback(
        (enabled: boolean) => {
            extensionRpc.action("setRecordWhenClosed", { enabled });
        },
        [extensionRpc],
    );

    const openCustomPromptDialog = useCallback(() => {
        extensionRpc.action("openCustomPromptDialog", {});
    }, [extensionRpc]);

    const closeCustomPromptDialog = useCallback(() => {
        extensionRpc.action("closeCustomPromptDialog", {});
    }, [extensionRpc]);

    const saveCustomPrompt = useCallback(
        (value: string) => {
            extensionRpc.action("saveCustomPrompt", { value });
        },
        [extensionRpc],
    );

    const resetCustomPrompt = useCallback(() => {
        extensionRpc.action("resetCustomPrompt", {});
    }, [extensionRpc]);

    const refreshSchemaContext = useCallback(() => {
        extensionRpc.action("refreshSchemaContext", {});
    }, [extensionRpc]);

    const importSession = useCallback(() => {
        extensionRpc.action("importSession", {});
    }, [extensionRpc]);

    const exportSession = useCallback(() => {
        extensionRpc.action("exportSession", {});
    }, [extensionRpc]);

    const saveTraceNow = useCallback(() => {
        extensionRpc.action("saveTraceNow", {});
    }, [extensionRpc]);

    const sessionsActivated = useCallback(() => {
        extensionRpc.action("sessionsActivated", {});
    }, [extensionRpc]);

    const sessionsRefresh = useCallback(() => {
        extensionRpc.action("sessionsRefresh", {});
    }, [extensionRpc]);

    const sessionsToggleTrace = useCallback(
        (fileKey: string, included: boolean) => {
            extensionRpc.action("sessionsToggleTrace", { fileKey, included });
        },
        [extensionRpc],
    );

    const sessionsSetAllTraces = useCallback(
        (included: boolean) => {
            extensionRpc.action("sessionsSetAllTraces", { included });
        },
        [extensionRpc],
    );

    const sessionsLoadIncluded = useCallback(() => {
        extensionRpc.action("sessionsLoadIncluded", {});
    }, [extensionRpc]);

    const sessionsAddFile = useCallback(() => {
        extensionRpc.action("sessionsAddFile", {});
    }, [extensionRpc]);

    const sessionsChangeFolder = useCallback(() => {
        extensionRpc.action("sessionsChangeFolder", {});
    }, [extensionRpc]);

    const sessionsSyncToDatabase = useCallback(() => {
        extensionRpc.action("sessionsSyncToDatabase", {});
    }, [extensionRpc]);

    const replayEvent = useCallback(
        (eventId: string) => {
            extensionRpc.action("replayEvent", { eventId });
        },
        [extensionRpc],
    );

    const replaySessionEvent = useCallback(
        (event: InlineCompletionDebugEvent) => {
            extensionRpc.action("replaySessionEvent", { event });
        },
        [extensionRpc],
    );

    const copyEventPayload = useCallback(
        (
            eventId: string,
            kind:
                | "id"
                | "json"
                | "prompt"
                | "systemPrompt"
                | "userPrompt"
                | "rawResponse"
                | "sanitizedResponse",
        ) => {
            extensionRpc.action("copyEventPayload", { eventId, kind });
        },
        [extensionRpc],
    );

    return (
        <InlineCompletionDebugContext.Provider
            value={{
                clearEvents,
                selectEvent,
                updateOverrides,
                selectProfile,
                setRecordWhenClosed,
                openCustomPromptDialog,
                closeCustomPromptDialog,
                saveCustomPrompt,
                resetCustomPrompt,
                refreshSchemaContext,
                importSession,
                exportSession,
                saveTraceNow,
                sessionsActivated,
                sessionsRefresh,
                sessionsToggleTrace,
                sessionsSetAllTraces,
                sessionsLoadIncluded,
                sessionsAddFile,
                sessionsChangeFolder,
                sessionsSyncToDatabase,
                replayEvent,
                replaySessionEvent,
                copyEventPayload,
            }}>
            {children}
        </InlineCompletionDebugContext.Provider>
    );
};

export function useInlineCompletionDebugContext(): InlineCompletionDebugContextProps {
    const context = useContext(InlineCompletionDebugContext);
    if (!context) {
        throw new Error(
            "useInlineCompletionDebugContext must be used within InlineCompletionDebugStateProvider",
        );
    }
    return context;
}
