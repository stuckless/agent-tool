# Implementation Phases

Each phase should end in runnable software. Do not implement later phases until the current phase has tests and can be demonstrated from the CLI.

## Phase 0 — Repository Bootstrap

Create:

- `package.json`
- TypeScript configuration
- source/test directories
- lint/format configuration only if the project already has a preferred standard
- basic README
- executable CLI wiring

Recommended scripts:

```json
{
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Set the package `bin` entry so `npm link` produces `agent-tool`.

Acceptance:

```bash
npm run dev -- "hello"
```

prints the provided prompt from a placeholder handler.

---

## Phase 1 — Ollama Chat Without Agent Behavior

Implement:

- configuration loader
- Ollama provider
- basic system prompt loader
- one user message → one assistant response

Do not implement tools yet.

Support configurable:

- base URL
- model
- temperature/options supported by the chosen Ollama endpoint
- explicit reasoning configuration (`provider-default`, enabled/disabled, or effort level)
- normalization of provider-exposed `message.thinking` when present

Acceptance:

```bash
agent-tool "explain what a work order is"
```

returns an Ollama-generated response.

Tests:

- provider request normalization
- malformed configuration
- provider HTTP error handling
- reasoning configuration → Ollama `think` request mapping
- normalization of `message.thinking`

---

## Phase 2 — Core Tool-Calling Agent Loop With Local Test Tools

Before MCP, prove the agent loop using one or two in-process tools.

Example tools:

- `echo`
- `get_current_test_value`

Implement:

- normalized tool contract
- tool registry
- tool definitions in model request
- tool call parsing
- tool execution
- tool result messages
- loop continuation
- max step protection
- preservation of the complete assistant message across tool turns, including provider-exposed reasoning/state

Acceptance:

A prompt that requires a test tool causes:

1. model call
2. tool invocation
3. tool result returned to model
4. final answer

The trace must make that sequence visible. Agent control flow must not inspect reasoning text.

---

## Phase 3 — MCP Tool Integration

Implement the official MCP SDK integration.

Start with stdio transports.

Configuration should allow:

```json
{
  "mcpServers": {
    "example": {
      "transport": "stdio",
      "command": "node",
      "args": ["./example-mcp-server.js"]
    }
  }
}
```

For each server:

1. connect
2. list tools
3. normalize descriptions and JSON schemas
4. register tools
5. route execution to the originating server

Acceptance:

The agent can answer a question that requires an MCP tool and trace the MCP tool call.

---

## Phase 4 — Skills, Simple Loading

Introduce Markdown skills.

V1 approach:

- discover `skills/*/SKILL.md`
- parse name, description, optional tags, and body
- inject selected/all skill content into system context

Example CLI options:

```bash
agent-tool --skill work-orders "..."
agent-tool --skills all "..."
```

Default behavior for the first implementation may be `all` when only a few skills exist.

Acceptance:

The same question produces observably different tool usage or answer behavior when a relevant skill is enabled versus disabled.

---

## Phase 5 — Trace Modes

Implement:

```bash
agent-tool --trace "..."
agent-tool --trace-json "..."
```

Human trace should show:

```text
Model: gpt-oss:120b
System prompt: prompts/investigative.md
Skills: work-orders
Tools: maximo.workorders_count, maximo.workorders_search

[1] model
    tool → maximo.workorders_count
    args → { ... }

[1] tool
    result → count=47

[2] model
    final → There are 47 ...
```

Normal trace output must never depend on chain-of-thought. It should show configured reasoning mode plus whether provider-exposed thinking was present, without dumping its text by default.

Add an explicit debugging option such as:

```bash
agent-tool --trace --show-thinking "..."
```

It may display only reasoning text actually exposed by the provider. Enabling it must not change model/agent behavior.

---

## Phase 6 — Eval Runner

Implement a separate CLI entry point or subcommand:

```bash
agent-eval evals/work-orders.json
```

or:

```bash
agent-tool eval evals/work-orders.json
```

Start with deterministic assertions:

- run completed
- expected tool called
- forbidden tool not called
- maximum tool call count
- output contains expected facts/phrases where appropriate
- reasoning configuration used is recorded with the run

Do not begin with LLM-as-a-judge scoring.

Store results as JSON for comparison. The same eval corpus must be runnable against different reasoning modes/effort levels without changing prompts/tools/skills.

---

## Phase 7 — Progressive Skill Disclosure

Once all-skills injection is understood, implement a more realistic approach.

System context receives only a compact skill catalog:

```text
work-orders — Analyze and query Maximo work orders.
assets — Analyze assets and asset status.
```

Expose a runtime-owned internal tool such as:

```text
runtime.load_skill(name)
```

The model calls it when a skill is relevant. The full skill content is then added to the conversation/context.

Important conceptual rule:

The **skill remains instruction content**. `load_skill` is merely the mechanism used to retrieve it.

Evaluate whether this improves context efficiency and tool choice.

---

## Phase 8 — Dynamic Tool Discovery/Filtering

Do not send every tool to the model when the tool catalog becomes large.

Possible approaches, in increasing sophistication:

1. static allowlist per profile
2. tags/categories
3. tool catalog plus runtime `search_tools`
4. model-based tool selection pass

Implement only after evals demonstrate degradation from large tool catalogs.

---

## Phase 9 — Provider Comparison

Add a second provider only after the runtime is stable.

The purpose is controlled comparison:

```text
same prompt
same system prompt
same skills
same tool descriptions
same MCP servers
same eval assertions
same reasoning setting where comparable
DIFFERENT model/provider
```

This is the experiment that helps distinguish model capability from agent architecture.

Potential providers later:

- OpenAI
- Anthropic
- generic OpenAI-compatible API

Do not change agent behavior inside provider adapters.


## Cross-Cutting Requirement — Reasoning/Thinking

Reasoning support begins in Phase 1 and remains a cross-cutting concern through the agent loop, traces, and evals. Read `12-REASONING-THINKING.md` before implementing Phases 1, 2, 5, or 6. Do not defer reasoning to a late add-on because preserving assistant reasoning/state across tool turns affects the provider/message contracts.
