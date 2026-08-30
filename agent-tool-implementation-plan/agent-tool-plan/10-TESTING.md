# Testing Strategy

## Principles

- Test the agent loop without requiring a live model.
- Test adapters independently.
- Keep live Ollama/MCP tests opt-in.
- Prefer deterministic fake providers/tools for unit tests.
- Do not mock every internal function; test public behavior.

## Fake Model Provider

Create a scripted model provider for tests.

Example sequence:

```text
call 1 → request tool `test.lookup`
call 2 → final answer `The value is 42.`
```

This makes agent loop behavior fully deterministic.

Tests should cover:

- final answer without tools
- one tool call then answer
- multiple sequential calls
- multiple tool calls in one turn
- unknown tool
- tool throws
- model observes tool error and recovers
- max steps reached

## Tool Registry Tests

Cover:

- registration
- duplicate names
- allow/deny filters
- successful execution
- normalized errors
- schema metadata preservation

## Skill Loader Tests

Cover:

- valid `SKILL.md`
- missing metadata
- duplicate names
- multiple directories
- explicit skill selection
- all/none modes
- prompt injection delimiters/ordering

## Configuration Tests

Cover:

- defaults
- file loading
- CLI overrides
- malformed JSON
- schema validation
- unresolved environment references

## MCP Adapter Tests

Where practical, create a tiny test MCP server in the test suite.

Test:

- stdio connection
- list tools
- normalize tool
- invoke tool
- error handling
- shutdown

Do not rely only on mocked SDK calls; one real local protocol integration test is valuable.

## Ollama Integration Tests

Keep live tests excluded from normal `npm test`.

Example:

```bash
npm run test:ollama
```

Skip with a clear message if Ollama/model is not available.

Do not make CI require a large local model.

## End-to-End Smoke Test

Provide an optional smoke setup using:

- a small locally available Ollama tool-calling model
- the test MCP server
- a test skill

Prompt should require actual tool execution.

The goal is not model-quality scoring; it is verifying the whole wiring works.

## Eval Tests vs Unit Tests

Keep distinction clear:

**Unit/integration tests** verify framework correctness.

**Evals** measure agent/model behavior quality.

A model choosing the wrong valid tool is normally an eval failure, not a framework unit-test failure.
