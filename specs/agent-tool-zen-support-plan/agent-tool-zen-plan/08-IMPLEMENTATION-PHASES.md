# Implementation Phases

## Working rule

Implement one phase at a time.

For each phase:

```text
read phase
implement only phase
run tests
manual smoke test
update documentation if behavior changed
commit
start next phase
```

Do not allow the coding assistant to implement later phases speculatively.

---

# Phase Z0 — Baseline and branch

## Goal

Establish a stable pre-Zen baseline.

## Tasks

- Ensure existing Ollama tests pass.
- Add one smoke/eval fixture that exercises at least one tool call.
- Record current CLI behavior.
- Create a feature branch if desired.
- Confirm the current normalized tool/message shapes.

## Exit criteria

- Ollama agent works before provider refactor.
- Existing test suite is green.

---

# Phase Z1 — Introduce ModelProvider boundary

## Goal

Make Ollama use a provider-neutral model interface without changing behavior.

## Tasks

- Add `model-provider.ts` and normalized model request/response types.
- Move concrete Ollama behavior behind `OllamaProvider`.
- Add provider registry with `ollama` only.
- Change `Agent` constructor/dependency to use `ModelProvider`.
- Preserve tool calls, tool result messages, reasoning state, usage, trace output.

## Tests

- Existing Ollama tests unchanged where possible.
- Provider registry test.
- Agent test using fake ModelProvider.
- No provider-specific imports in `agent.ts`.

## Exit criteria

This command behaves as before:

```bash
agent-tool "simple test"
```

---

# Phase Z2 — Zen provider shell + authentication + discovery

## Goal

Connect to Zen and list models without performing inference.

## Tasks

- Add Zen provider config.
- Add `OPENCODE_ZEN_API_KEY` validation.
- Add Zen client/fetch for `/v1/models`.
- Normalize model descriptors.
- Add `agent-tool models --provider zen`.
- Add safe error normalization/redaction.

## Tests

- model list JSON mapping with fixture
- 401 mapping
- API key redaction
- no API key error

## Manual test

```bash
OPENCODE_ZEN_API_KEY=... agent-tool models --provider zen
```

## Exit criteria

Current Zen models can be listed without exposing credentials.

---

# Phase Z3 — Zen protocol router

## Goal

Resolve model IDs to protocol adapters without invoking them yet.

## Tasks

- Add `ZenProtocol` union.
- Add known exact routes if needed.
- Add family rules.
- Add config overrides.
- Add routing status to model list.

## Tests

Representatives:

```text
gpt-* -> openai-responses
claude-* -> anthropic-messages
deepseek-* -> openai-chat
gemini-* -> google-generative
```

Also test unknown model and override precedence.

## Exit criteria

Every currently targeted test model resolves deterministically.

---

# Phase Z4 — OpenAI-compatible Chat Completions adapter

## Goal

Run the full agent loop against at least one Zen hosted open model.

## Tasks

- Add AI SDK dependency required for OpenAI-compatible protocol.
- Implement request/message/tool mapping.
- Implement response/tool-call normalization.
- Implement tool-result continuation.
- Normalize usage/finish reason.
- Add safe provider trace metadata.

## Manual tests

No tool:

```bash
agent-tool --provider zen --model <chat-model> "What is 2+2?"
```

Tool:

```bash
agent-tool --provider zen --model <chat-model> "Use the test tool ..."
```

MCP:

Run a known existing MCP-based question.

## Exit criteria

A Zen chat-completions model successfully completes a multi-turn tool interaction using the unchanged agent loop.

---

# Phase Z5 — OpenAI Responses adapter

## Goal

Support Zen GPT/Grok/Muse Responses endpoint models.

## Tasks

- Add/use `@ai-sdk/openai`.
- Implement response item/tool mapping.
- Preserve required continuation state.
- Add normalized reasoning support where documented/supported.
- Add tests for tool-result round trip.

## Exit criteria

A Zen Responses model completes the same MCP test used in Phase Z4.

---

# Phase Z6 — Anthropic Messages adapter

## Goal

Support Zen Claude/Qwen Messages endpoint models.

## Tasks

- Add/use `@ai-sdk/anthropic`.
- Map messages/content blocks.
- Map tool-use blocks.
- Map tool results.
- Preserve required provider continuation state.
- Normalize usage and reasoning metadata.

## Exit criteria

A Zen Claude/Qwen model completes the same MCP test without agent-loop changes.

---

# Phase Z7 — Google/Gemini adapter

## Goal

Support Zen Gemini models.

## Tasks

- Add/use `@ai-sdk/google`.
- Configure model-specific Zen endpoint.
- Map tools/function calls/results.
- Normalize usage/finish reason.

## Exit criteria

A Gemini model completes the standard cross-provider MCP smoke test.

---

# Phase Z8 — Capability + reasoning validation

## Goal

Make differences between model capabilities explicit.

## Tasks

- Add capability representation.
- Add reasoning option validation.
- Preserve unknown vs false.
- Trace requested/supported reasoning state.
- Confirm provider-specific thinking is not required by agent logic.

## Exit criteria

Unsupported explicit reasoning requests fail clearly rather than being silently ignored.

---

# Phase Z9 — Cross-provider evals

## Goal

Run the same eval suite across Ollama and Zen models.

## Tasks

- Add provider/model to eval run metadata.
- Add optional reasoning variant.
- Capture latency/usage/request counts.
- Ensure eval case files remain provider-independent.
- Provide comparison output.

## Example

```bash
agent-eval evals/work-orders.json --provider ollama --model gpt-oss:120b
agent-eval evals/work-orders.json --provider zen --model deepseek-v4-flash
agent-eval evals/work-orders.json --provider zen --model claude-sonnet-5
agent-eval evals/work-orders.json --provider zen --model gpt-5.6-sol
```

## Exit criteria

Results can be compared without changing prompts, tools, skills, or eval cases.

---

# Phase Z10 — Hardening and docs

## Tasks

- README Zen setup instructions.
- API key setup.
- model listing behavior.
- protocol routing explanation.
- hosted-data warning.
- error handling.
- retry behavior tests.
- catalog drift tests/warnings.
- final code cleanup.

## Exit criteria

Zen support is understandable without reading the implementation plan.
