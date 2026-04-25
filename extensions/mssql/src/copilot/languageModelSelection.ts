/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
export {
    defaultInlineCompletionModelVendors,
    getConfiguredInlineCompletionModelVendors,
} from "./languageModels/shared/vendorAllowList";
import { getConfiguredInlineCompletionModelVendors } from "./languageModels/shared/vendorAllowList";

export async function selectConfiguredLanguageModels(
    family?: string,
): Promise<vscode.LanguageModelChat[]> {
    const all: vscode.LanguageModelChat[] = [];

    for (const vendor of getConfiguredInlineCompletionModelVendors()) {
        const models = await vscode.lm.selectChatModels({
            vendor,
            ...(family ? { family } : {}),
        });
        all.push(...models);
    }

    return dedupeLanguageModels(all);
}

function dedupeLanguageModels(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat[] {
    const seen = new Set<string>();
    const deduped: vscode.LanguageModelChat[] = [];

    for (const model of models) {
        const key = `${model.vendor}/${model.id}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(model);
    }

    return deduped;
}
