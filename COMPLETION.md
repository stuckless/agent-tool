# Completion Status

This document tracks implementation progress against `agent-tool-implementation-plan/agent-tool-plan/03-IMPLEMENTATION-PHASES.md`.

## Phase 0 — Repository Bootstrap

**Status:** Complete and committed.

Delivered:

- Node 22+ ESM TypeScript/npm project setup
- `agent-tool` executable wiring and development scripts
- build, typecheck, and Vitest configuration
- initial README and placeholder CLI test

Verification completed:

```text
npm test
npm run typecheck
npm run build
npm run dev -- "hello"
```

## Phase 1 — Ollama Chat Without Agent Behavior

**Status:** Complete and live-verified.

Delivered:

- JSON configuration loader with model, Ollama URL, prompt, options, and reasoning settings
- environment and CLI overrides for model/URL/reasoning
- Markdown system-prompt loader
- provider-neutral model contracts
- native Ollama `/api/chat` adapter using built-in `fetch`
- reasoning configuration mapped to Ollama `think`
- opaque normalization and replay support for provider-exposed `message.thinking`
- one prompt → one model response CLI path

Deterministic verification completed:

```text
npm test          # 11 tests
npm run typecheck
npm run build
```

The tests cover malformed configuration, prompt loading, native request/response normalization, HTTP failures, all four reasoning mappings, and provider-exposed thinking replay.

Live verification used the configured remote server:

```bash
AGENT_OLLAMA_URL=http://192.168.11.10:11434
AGENT_MODEL=granite4.2:8b
```

The CLI successfully returned a final answer for `is react good for server code?` with `--reasoning on`. A direct non-streaming `/api/chat` diagnostic also returned distinct non-empty `message.content` and provider-exposed `message.thinking` fields with `done_reason: "stop"`. The CLI intentionally displays only the final content; thinking remains normalized internal state until Phase 5 trace support.

## Phase 2 — Core Tool-Calling Agent Loop With Local Test Tools

**Status:** Complete.

Delivered:

- provider-neutral tool definitions, tool calls, and ordered tool-result messages
- duplicate-safe in-process tool registry
- deterministic `echo` and `get_current_test_value` local tools
- Ollama tool-definition request formatting and native tool-call normalization
- sequential model → tool → model loop with configurable `maxSteps` (default: 10)
- safe normalized tool errors returned to the model for recovery
- complete assistant-turn preservation across tool turns, including content, calls, and opaque reasoning/state
- injectable structured trace events for model and tool sequence testing; Phase 5 CLI trace modes remain unimplemented

Deterministic verification completed:

```text
npm test          # 17 tests
npm run typecheck
npm run build
npm run dev -- --help
```

The deterministic fake-model tests prove the required sequence: a model requests `get_current_test_value`, the local tool executes, its ordered result message is replayed with the complete preceding assistant message (including opaque reasoning metadata), and a second model turn produces the final answer. They also cover tool definition/call normalization, safe unknown-tool recovery, duplicate registration rejection, and enforced step limits. Normal tests do not use Ollama or the network.

The CLI help demonstration shows the Phase 2 `--max-steps` control. No live Ollama tool-calling run was performed in this phase; that remains a manual optional verification separate from the deterministic acceptance coverage.

## Next Phase

Phase 3 — MCP tool integration.
