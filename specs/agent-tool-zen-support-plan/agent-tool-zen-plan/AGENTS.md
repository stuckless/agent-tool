# AGENTS.md — Zen Provider Expansion

## Objective

Extend `agent-tool` to support OpenCode Zen while preserving the project's core purpose: a small, understandable agent runtime used to study prompts, skills, MCP tools, reasoning, and model behavior.

## Primary rule

Do not turn this into a generic AI framework.

The agent loop must remain visibly ours.

## Implementation discipline

Implement only the requested phase from `08-IMPLEMENTATION-PHASES.md`.

At the end of each phase:

1. run relevant tests
2. run the phase's smoke test if applicable
3. summarize changed files
4. identify any deviations from the plan
5. stop

Do not continue into the next phase unless explicitly requested.

## Technology

- Node.js
- TypeScript
- npm
- existing project test framework
- direct Ollama integration remains supported
- Zen protocol clients may use official/documented AI SDK packages

Do not introduce:

- LangChain
- LangGraph
- Semantic Kernel
- AutoGen
- an AI SDK agent runtime
- a generic dependency injection framework

## Architecture rules

### Agent

`Agent` may depend on:

```text
ModelProvider
normalized tools
skills
prompt/context system
tracing
```

It may not depend directly on:

```text
Ollama
Zen
OpenAI Responses
Anthropic Messages
Google Gemini
AI SDK provider types
```

### Provider adapters

Provider adapters translate wire/protocol semantics only.

They must not:

- choose skills
- decide whether more tools are needed
- perform semantic retries
- rewrite user intent
- add secret provider-specific system prompts

### Tools

Keep normalized MCP/tool definitions provider-independent.

Do not duplicate MCP integration for each provider.

### Reasoning

Provider reasoning/thinking may be preserved as opaque continuation state.

Never parse chain-of-thought text to control the agent.

Do not display thinking by default.

## Zen routing

Do not infer protocol by sending trial requests to multiple endpoints.

Routing precedence:

```text
config override
exact route
family route
unknown/error
```

Keep model routing in one module.

## Model catalog

Do not hardcode the current Zen model list as if it were permanent.

Use Zen's model endpoint for discovery.

A model may be discovered but unsupported until its protocol mapping is known.

## Credentials

Use:

```text
OPENCODE_ZEN_API_KEY
```

Never:

- commit an API key
- print an API key
- include it in fixtures
- include Authorization headers in traces

## Testing

Default tests must not spend money or require Zen connectivity.

Live Zen tests must be opt-in.

Use fixtures/fake servers for normal adapter tests.

## Evals

The purpose of Zen support is controlled comparison.

Do not alter prompts, skills, tool descriptions, or context policy based on provider unless an experiment explicitly asks for it.

Do not automatically fall back from one model to another during evals.

## Scope restraint

Do not add during this expansion unless explicitly requested:

- streaming, if not already present
- provider plugins
- model auto-selection
- cost-based routing
- fallback models
- load balancing
- persistent model catalogs
- proxy server
- web UI
- OAuth
- secret manager integrations

## Code quality

Prefer explicit readable TypeScript over clever abstractions.

A developer should be able to understand:

```text
Agent -> ModelProvider -> ZenProvider -> ProtocolAdapter
```

without needing framework documentation.
