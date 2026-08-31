# Acceptance Criteria

Zen support is complete when all of the following are true.

## Architecture

- [ ] `Agent` depends only on the normalized `ModelProvider` contract.
- [ ] No Zen/OpenAI/Anthropic/Google protocol code exists in `agent.ts`.
- [ ] Ollama is implemented through the same provider boundary.
- [ ] Existing Ollama behavior remains functional.

## Zen basics

- [ ] `OPENCODE_ZEN_API_KEY` is supported.
- [ ] Missing credentials fail clearly.
- [ ] Credentials are redacted from traces/errors.
- [ ] `agent-tool models --provider zen` retrieves the current Zen model list.
- [ ] Discovered models show protocol support/routing status.

## Protocols

- [ ] OpenAI-compatible Chat Completions models work.
- [ ] OpenAI Responses models work.
- [ ] Anthropic Messages models work.
- [ ] Gemini models work, unless explicitly deferred as an accepted scope decision.

## Agent behavior

For each supported protocol family:

- [ ] plain text response works
- [ ] single tool call works
- [ ] tool result round trip works
- [ ] multiple agent turns work
- [ ] MCP tools work through the unchanged agent loop
- [ ] final response correctly uses retrieved tool data

## Reasoning

- [ ] normalized reasoning configuration remains provider-independent
- [ ] unsupported explicit reasoning settings fail clearly
- [ ] opaque provider reasoning/continuation state is preserved where required
- [ ] agent logic never parses reasoning text
- [ ] thinking text is not logged by default

## CLI

- [ ] provider selectable by CLI/config
- [ ] model selectable by CLI/config
- [ ] default Ollama invocation remains convenient
- [ ] model list command works for Ollama and Zen

## Tests

- [ ] routing table unit tests
- [ ] per-protocol mapping tests
- [ ] error normalization tests
- [ ] redaction tests
- [ ] fake-provider agent tests
- [ ] optional live Zen smoke test
- [ ] cross-provider eval runner

## Experiment quality

- [ ] same eval case can run against Ollama and Zen without editing the case
- [ ] traces identify provider/model/protocol
- [ ] comparison includes tool accuracy and answer quality, not only latency
- [ ] no automatic model fallback contaminates comparisons

## Documentation

- [ ] README explains Zen setup
- [ ] README explains external-hosted data boundary
- [ ] architecture doc explains provider abstraction
- [ ] protocol routing maintenance is documented
- [ ] implementation does not depend on this planning ZIP to be understandable
