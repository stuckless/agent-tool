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

Phase Z3 — Zen protocol router. Do not begin it until explicitly requested.
