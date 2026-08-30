# Coding Assistant Instructions

Implement this project as a small educational agent runtime. The goal is clarity and observability, not framework sophistication.

## Core Rules

1. Use TypeScript, Node.js 22+, ESM, and npm.
2. Use `yargs` for CLI argument parsing.
3. Use built-in `fetch` for HTTP requests; do not add Axios.
4. Use the official `@modelcontextprotocol/sdk` package for MCP.
5. Do not use LangChain, LangGraph, Semantic Kernel, or an AI SDK unless explicitly requested later.
6. Keep the core agent loop project-owned, short, and easy to read.
7. Do not implement features from later phases early unless required by a completed phase.
8. Add tests with each phase.
9. Prefer small interfaces and composition over deep class hierarchies.
10. Do not use advanced TypeScript merely to be clever.

## Implementation Order

Follow `03-IMPLEMENTATION-PHASES.md` in order.

At the end of each phase:

- run tests
- run typecheck
- run build
- demonstrate the relevant CLI behavior
- summarize files changed and key design choices

Do not move to the next phase with failing tests.

## Agent Runtime Guardrails

- Always enforce `maxSteps`.
- Preserve tool call/result ordering correctly.
- Normalize provider responses before the agent consumes them.
- Normalize MCP tools before registering them.
- Treat skills as instruction content, not executable capabilities.
- Do not make runtime correctness depend on model chain-of-thought/reasoning text.
- Tool errors should be visible to the model in a safe normalized form where recovery is possible.
- Never expose secrets in traces or model-visible error messages.

## Dependency Discipline

Before adding a dependency, determine whether the standard library or an existing dependency is sufficient.

Expected dependencies are roughly:

Runtime:

- `@modelcontextprotocol/sdk`
- `yargs`
- `zod`
- a lightweight frontmatter parser if needed

Development:

- `typescript`
- `tsx`
- `vitest`
- `@types/node`

Do not add a general-purpose logging framework initially.

## Code Style

- Prefer named functions where they improve traces/stack readability.
- Prefer `async`/`await`.
- Use explicit domain names: `toolCall`, `toolResult`, `modelResponse`, `skill`, `traceEvent`.
- Keep transport-specific objects inside adapters.
- Avoid giant files, but do not split trivial code into excessive modules.

## Testing

Use fake model providers to test the loop deterministically.

Normal tests must not require:

- Ollama
- network access
- production MCP servers
- company credentials

Live integration tests must be opt-in.

## Scope Control

Do not add:

- RAG/vector databases
- embeddings
- persistent memory
- subagents
- planners
- web UI
- database storage
- authentication
- Docker
- multi-user support
- telemetry services

unless explicitly requested after the planned core is working.

## Documentation

Keep the project README focused on:

- setup
- configuration
- CLI use
- writing a skill
- configuring an MCP server
- trace mode
- eval mode
- architecture overview

Do not duplicate the entire implementation plan into the README.
