# Zen Phase Z0 Baseline

This records the pre-provider-refactor CLI and normalized runtime behavior.

## Current CLI behavior

`agent-tool <prompt>` loads the Ollama configuration, system prompt, skills, local tools, and configured MCP tools, then runs the agent loop. The model can be overridden with `--model`; the Ollama endpoint can be overridden with `AGENT_OLLAMA_URL`. The CLI exposes `--reasoning`, `--max-steps`, skill controls, and human or JSON trace controls.

`agent-eval <dataset.json>` uses the same Ollama-backed runtime and evaluates objective assertions over completion, tool calls, tool errors, and answer text. `test/fixtures/ollama-tool-smoke-eval.json` is the baseline one-tool eval fixture. It requires `get_current_test_value`, permits one tool call, and expects the default local test value, `phase-2-current-test-value`, in the answer.

## Confirmed normalized shapes

The existing provider boundary is `ModelProvider.chat(request)`. `Agent` sends a `ModelRequest` containing normalized conversation messages, normalized tool definitions, reasoning configuration, and model options. The provider returns an assistant message with optional normalized tool calls, finish reason, and usage.

An assistant tool call has an `id`, `name`, and object `arguments`. The agent appends the complete assistant message before ordered tool-result messages. Each tool result uses `role: "tool"`, `toolCallId`, `name`, and JSON `content`. Opaque provider reasoning is retained on assistant messages and replayed by the Ollama adapter, but is not used for agent decisions or shown by default.

## Baseline limits

The runtime is Ollama-only in this phase. Configuration, CLI construction, and eval construction instantiate `OllamaProvider` directly. Phase Z1 will migrate that construction behind the planned `ModelProvider` boundary without changing this behavior.
