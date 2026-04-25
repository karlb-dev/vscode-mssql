/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";

export type CliProviderErrorClass =
    | "auth"
    | "spawn"
    | "exit"
    | "parse"
    | "rateLimit"
    | "network"
    | "other";

const maxErrorMessageLength = 500;

export function mapCliExitToLanguageModelError(
    exitCode: number | null,
    stderr: string,
): vscode.LanguageModelError {
    const message = sanitizeCliErrorMessage(stderr || `CLI exited with code ${exitCode ?? "null"}`);
    const errorClass = classifyCliError(stderr);

    switch (errorClass) {
        case "auth":
            return vscode.LanguageModelError.NoPermissions(message);
        case "rateLimit":
            return vscode.LanguageModelError.Blocked(message);
        default:
            if (isModelUnavailable(stderr)) {
                return vscode.LanguageModelError.NotFound(message);
            }
            return new vscode.LanguageModelError(message);
    }
}

export function mapSpawnErrorToLanguageModelError(error: unknown): vscode.LanguageModelError {
    const message = sanitizeCliErrorMessage(error instanceof Error ? error.message : String(error));
    return vscode.LanguageModelError.NotFound(message || "CLI binary was not found.");
}

export function classifyCliError(stderr: string): CliProviderErrorClass {
    const normalized = stderr.toLowerCase();
    if (
        normalized.includes("not logged in") ||
        normalized.includes("login required") ||
        normalized.includes("authentication required") ||
        normalized.includes("unauthorized") ||
        normalized.includes("401")
    ) {
        return "auth";
    }

    if (
        normalized.includes("rate limit") ||
        normalized.includes("quota") ||
        normalized.includes("too many requests") ||
        normalized.includes("429")
    ) {
        return "rateLimit";
    }

    if (
        normalized.includes("network") ||
        normalized.includes("econnrefused") ||
        normalized.includes("enotfound") ||
        normalized.includes("etimedout") ||
        normalized.includes("timeout")
    ) {
        return "network";
    }

    return "exit";
}

export function sanitizeCliErrorMessage(message: string): string {
    const home = os.homedir();
    let sanitized = message || "";

    if (home) {
        sanitized = sanitized.split(home).join("~");
    }

    sanitized = sanitized.replace(
        /\b(token|api[_ -]?key|authorization|bearer)\b(\s*[:=]\s*|\s+)[^\s"'`]+/gi,
        "$1$2[redacted]",
    );
    sanitized = sanitized.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted]");
    sanitized = sanitized.trim();

    if (sanitized.length > maxErrorMessageLength) {
        return `${sanitized.slice(0, maxErrorMessageLength)}...`;
    }

    return sanitized;
}

function isModelUnavailable(stderr: string): boolean {
    const normalized = stderr.toLowerCase();
    return (
        normalized.includes("unknown model") ||
        normalized.includes("model not found") ||
        normalized.includes("model unavailable") ||
        normalized.includes("invalid model")
    );
}
