# External Language Model Providers

The MSSQL extension can register external `vscode.lm` providers for SQL inline completion:

- `anthropic-api`: streams directly from the Anthropic Messages API.
- `openai-api`: streams directly from the OpenAI Chat Completions API.
- `anthropic-cli`: legacy Claude Code CLI provider.
- `openai-cli`: legacy Codex CLI provider.

Use the SDK providers by default. They avoid per-request CLI startup, support native cancellation, return API usage when available, and are the path expected to make automatic inline completion responsive. Typical first-token latency is 300-800ms for Anthropic and 200-600ms for OpenAI; full continuation completions are usually 1-3s, while larger intent-mode completions are usually 2-6s.

## API Providers

Set API keys with the command palette:

- **Set Anthropic API Key**
- **Set OpenAI API Key**

Keys are stored in VS Code SecretStorage, backed by the OS keychain, and are not written to `settings.json`. The providers resolve keys in this order:

1. SecretStorage.
2. `mssql.copilot.sdkProviders.<vendor>.env` fallback value for `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
3. The process environment variable.

SDK settings:

- `mssql.copilot.sdkProviders.anthropic.enabled`
- `mssql.copilot.sdkProviders.anthropic.additionalModels`
- `mssql.copilot.sdkProviders.anthropic.baseUrl`
- `mssql.copilot.sdkProviders.anthropic.timeout`
- `mssql.copilot.sdkProviders.anthropic.env`
- `mssql.copilot.sdkProviders.openai.enabled`
- `mssql.copilot.sdkProviders.openai.additionalModels`
- `mssql.copilot.sdkProviders.openai.baseUrl`
- `mssql.copilot.sdkProviders.openai.timeout`
- `mssql.copilot.sdkProviders.openai.env`

Use `baseUrl` for corporate gateways, proxies, LiteLLM, or Azure OpenAI-compatible routing. Add preview or organization-specific models with `additionalModels`.

## CLI Providers

The CLI providers remain available for experiments and agent-harness comparisons, but they are disabled by default. They typically take 10-60 seconds per request because each call starts a CLI process and runs the CLI's full harness. That makes them impractical for automatic-trigger inline completion.

To use them anyway, enable the provider and reload VS Code:

- `mssql.copilot.cliProviders.anthropic.enabled`
- `mssql.copilot.cliProviders.codex.enabled`

Other CLI settings:

- `mssql.copilot.cliProviders.anthropic.path`
- `mssql.copilot.cliProviders.anthropic.additionalModels`
- `mssql.copilot.cliProviders.anthropic.extraArgs`
- `mssql.copilot.cliProviders.anthropic.env`
- `mssql.copilot.cliProviders.codex.path`
- `mssql.copilot.cliProviders.codex.additionalModels`
- `mssql.copilot.cliProviders.codex.extraArgs`
- `mssql.copilot.cliProviders.codex.env`

## Selection

Inline completion queries vendors from `mssql.copilot.inlineCompletions.modelVendors`, which defaults to:

```jsonc
["copilot", "anthropic-api", "openai-api", "anthropic-cli", "openai-cli"]
```

`mssql.copilot.inlineCompletions.modelFamily` still applies first. When no exact family is available, the extension uses its built-in family preference list while preserving vendor priority.

## Limitations

- Providers are text-in/text-out only.
- Tool calls and image inputs are intentionally unsupported.
- OpenAI token counting is approximate before a request; Anthropic uses the native count endpoint with approximation fallback.
- Streaming usage is recorded for telemetry, but prompt text, response text, API keys, and user queries are never logged.
