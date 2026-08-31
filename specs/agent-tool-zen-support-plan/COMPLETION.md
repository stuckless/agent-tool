# Zen Support Completion Status

This document tracks implementation progress against `agent-tool-zen-plan/08-IMPLEMENTATION-PHASES.md`.

## Phase Z0 — Baseline and branch

**Status:** Complete.

Delivered:

- pre-Zen baseline documentation at `../../docs/zen-z0-baseline.md`, covering the current Ollama-only CLI/eval behavior and normalized message/tool shapes
- a JSON eval fixture at `../../test/fixtures/ollama-tool-smoke-eval.json` that requires a `get_current_test_value` tool call
- a deterministic eval-CLI test that runs that fixture through the existing Ollama adapter, verifies the two-turn tool continuation, and checks the objective eval result

Verification completed:

```text
npm test          # 50 passed, 1 opt-in stdio test skipped
npm run typecheck
npm run build
node dist/cli.js --help
node dist/eval-cli.js --help
```

The documented remote Ollama smoke check completed successfully with `granite4.2:8b`: a direct `2 + 2` request returned `2 + 2 equals 4.` The first intentionally one-step request hit the expected `maxSteps` guard after the model chose a tool call, confirming that the limit remains enforced.

No provider refactor or Zen code was added. The repository remains on its existing `main` branch; Phase Z0 did not require creating a feature branch.

## Phase Z1 — Introduce ModelProvider boundary

**Status:** Complete.

Delivered:

- provider-neutral request/response/message types in `../../src/model/model-types.ts` and the `ModelProvider` interface in `../../src/model/model-provider.ts`
- an Ollama-only `providerRegistry` which creates the migrated `OllamaProvider`
- moved Ollama HTTP request/response mapping into `../../src/model/ollama/ollama-provider.ts`; the previous `model/ollama.ts` path remains a compatibility re-export
- updated CLI and eval CLI construction to resolve the provider through the registry
- updated `Agent` to invoke the provider-neutral `generate()` operation, with no Ollama or Zen imports
- a provider registry unit test, an explicit agent-source import-boundary test, and fake-provider agent/test doubles

Behavior preserved:

- assistant messages (including opaque provider-exposed thinking), tool calls, and ordered tool results are replayed as a complete normalized conversation
- Ollama request mapping, usage/finish-reason normalization, trace events, and `maxSteps` behavior are unchanged

Verification completed:

```text
npm test          # 52 passed, 1 opt-in stdio test skipped
npm run typecheck
npm run build
node dist/cli.js --help
node dist/eval-cli.js --help
AGENT_OLLAMA_URL=http://192.168.11.10:11434 AGENT_MODEL=granite4.2:8b node dist/cli.js --max-steps 1 "What is 2 + 2? Answer briefly."  # 4
```

No Zen protocol, credential, routing, discovery, streaming, or other Z2+ functionality was added.

## Phase Z2 — Zen provider shell + authentication + discovery

**Status:** Complete.

Delivered:

- `ZenProvider` model discovery using `GET /zen/v1/models` through Node's built-in `fetch`
- `OPENCODE_ZEN_API_KEY` validation before any Zen request, with a clear configuration error when absent
- provider-neutral Zen `ModelDescriptor` normalization from the catalog response
- explicit `zen` registry entry and Zen configuration (`model.provider`, `providers.zen.baseUrl`, and CLI `--provider`)
- `agent-tool models --provider zen`, which lists discovered model IDs without requiring a selected inference model
- safe Zen error types/redaction for credentials, Authorization values, transport errors, and HTTP authentication failures

Scope preserved:

- Zen discovery intentionally remains separate from protocol routing.
- `ZenProvider.generate()` only reports that a protocol adapter is not configured; no inference, routing, protocol adapter, tool mapping, streaming, fallback, or persistent catalog behavior was added.
- API keys are read only from `OPENCODE_ZEN_API_KEY`; they are not stored in runtime config, traces, fixtures, or output.

Verification completed:

```text
npm test          # 58 passed, 1 opt-in stdio test skipped
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js models --provider zen  # safe missing-model/credential path checked
git diff --check
```

The normal test suite uses fixtures and fetch mocks only; it does not require Zen connectivity or credentials. A live catalog check remains manual and opt-in:

```bash
OPENCODE_ZEN_API_KEY=... node dist/cli.js models --provider zen
```

## Next phase

## Phase Z3 — Zen protocol router

**Status:** Complete.

Delivered:

- isolated Zen protocol resolution in `../../src/model/zen/zen-protocol-router.ts`, using the documented config-override, exact-route, family-route, then unknown order
- documented family mappings for Responses, Anthropic Messages, OpenAI-compatible Chat Completions, and Google Generative models
- `providers.zen.modelRoutes` configuration that is passed through provider construction without embedding routing rules in configuration parsing or CLI logic
- Zen catalog descriptors now include safe protocol and routing-status metadata
- `agent-tool models --provider zen` emits a `MODEL`, `PROTOCOL`, and `STATUS` table, clearly marking unknown catalog entries as `discovered/unroutable`
- offline tests for all documented families, configured-route precedence, unknown models, prefix boundary/collision behavior, and routed plus unroutable CLI output

Scope preserved:

- Zen inference remains unavailable; no protocol adapter, request, tool, streaming, fallback, retry, or model-selection behavior was added.
- No network requests are used to infer a model protocol.
- No API key or Authorization value is added to configuration, output, fixtures, or routing metadata.

Verification completed:

```text
npm test          # 77 passed, 1 opt-in stdio test skipped
npm run typecheck
npm run build
git diff --check
```

The safe manual CLI path remains available without a credential:

```bash
cd /tmp && node /home/sls/git/agent-tool/dist/cli.js models --provider zen
```

It fails before any Zen fetch with the existing missing-credential message. A live catalog listing remains manual and opt-in:

```bash
OPENCODE_ZEN_API_KEY=... node dist/cli.js models --provider zen
```

## Phase Z4 — OpenAI-compatible Chat Completions adapter

**Status:** Complete.

Delivered:

- `../../src/model/zen/adapters/zen-openai-chat.ts`, a narrow adapter for Zen's `/zen/v1/chat/completions` endpoint using `@ai-sdk/openai-compatible` behind the existing normalized model, message, tool, and tool-result contract
- request mapping for system/user/assistant/tool messages, OpenAI-compatible function tools, assistant tool-call replay, and correlated tool results
- response normalization for text, ordered tool calls and IDs, finish reasons, and prompt/completion usage metadata; safe provider/model/protocol metadata and per-request duration are included in traces
- Zen provider selection through the existing Z3 protocol router; only models routed to `openai-chat` invoke the adapter, while other or unknown protocols fail before a network call with a clear routing error
- centralized Zen base-URL and Authorization construction in `ZenProvider`, shared by model discovery and the chat adapter; authentication, transport, and invalid-response errors are credential-redacted
- offline adapter tests using fake `fetch` responses, including request mapping, tool-result continuation, response mapping, safe authentication/transport failures, registry routing, and unsupported protocol behavior

Scope preserved:

- Added direct `@ai-sdk/openai-compatible` and `@ai-sdk/provider` dependencies. The adapter uses the provider's low-level non-streaming `doGenerate()` operation only; the project-owned agent loop remains unchanged.
- Normalized Zen reasoning is passed to the AI SDK for disabled and explicit effort modes (`max` maps to `xhigh`). The ambiguous generic `enabled` mode fails clearly instead of being silently dropped.
- No Responses, Anthropic, Gemini, streaming, auto-selection, fallback, retry, persistent catalog, or Z5+ behavior was added.
- Ollama remains unchanged and continues to use its existing provider implementation.

Verification completed:

```text
npm test          # 85 passed, 1 opt-in stdio test skipped
npm run typecheck
npm run build
git diff --check
```

Normal tests remain credential-free and offline. The user subsequently confirmed a successful manual Zen chat-completions invocation. This verifies live text generation; a live multi-turn tool or MCP interaction remains an opt-in acceptance check unless separately confirmed. After setting a real key and selecting a currently routed chat model, run:

```bash
OPENCODE_ZEN_API_KEY=... node dist/cli.js --provider zen --model <chat-model> "What is 2+2?"
OPENCODE_ZEN_API_KEY=... node dist/cli.js --provider zen --model <chat-model> "Use the test tool and report its result."
```

## Next phase

Phase Z5 — OpenAI Responses adapter. Do not begin it until explicitly requested.
