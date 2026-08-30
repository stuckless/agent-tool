# Runtime Architecture

## Core Components

```text
                         ┌───────────────────┐
                         │       CLI         │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │      Config       │
                         └─────────┬─────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
      ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
      │   Prompts   │       │   Skills    │       │ MCP Clients │
      └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
             │                     │                     │
             │                     │              ┌──────▼──────┐
             │                     │              │ MCP Adapter │
             │                     │              └──────┬──────┘
             │                     │                     │
             └─────────────────────┼──────────────┬──────┘
                                   │              │
                              ┌────▼──────────────▼───┐
                              │     Agent Runtime     │
                              │                       │
                              │  messages + tool loop │
                              └───────┬─────────┬─────┘
                                      │         │
                              ┌───────▼───┐ ┌───▼──────────┐
                              │  Ollama   │ │ Tool Registry│
                              └───────────┘ └──────────────┘
```

## `Agent`

Responsibilities:

- receive the user's prompt
- construct initial messages
- invoke the model
- inspect model output
- execute requested tools
- append tool results
- repeat
- stop on final answer or configured limit
- emit trace events

The `Agent` should not know how MCP works and should not read files directly.

Suggested public API:

```ts
const agent = new Agent({
  model,
  tools,
  systemPrompt,
  skills,
  tracer,
  maxSteps,
});

const result = await agent.run("how many open work orders are in bedford");
```

## `ModelProvider`

Keep the provider contract small.

Conceptual shape:

```ts
interface ModelProvider {
  chat(request: ModelRequest): Promise<ModelResponse>;
}
```

`ModelRequest` should contain only model-level concepts:

- messages
- tool definitions
- reasoning configuration
- generic model options

`ModelResponse` should normalize:

- complete normalized assistant message
- assistant text
- provider-exposed reasoning metadata/text when available
- tool calls
- finish reason if available
- usage metadata if available
- provider metadata only when useful for diagnostics

Do not let Ollama response objects become the runtime's domain model.

Reasoning must be a first-class but provider-neutral concept. The provider adapter maps the generic reasoning configuration to Ollama's `think` field and maps `message.thinking` back into an optional normalized reasoning payload.

When the model requests tools, preserve the complete normalized assistant message, including any provider-exposed reasoning/state, before appending tool results. The `Agent` treats reasoning as opaque and never parses it for control flow. See `12-REASONING-THINKING.md`.

## `ToolRegistry`

Responsibilities:

- hold normalized tools
- reject duplicate names
- expose definitions to the model
- execute a named tool
- trace execution
- implement allow/deny policy

Tool name collisions across MCP servers should be avoided by namespacing when necessary, for example:

```text
maximo.workorders_count
knowledge.search
```

Prefer readable names over blindly preserving transport-specific identifiers.

## `SkillRegistry`

Responsibilities:

- discover `SKILL.md` files
- parse metadata
- validate them
- expose skill catalog
- return full skill content on request

V1 may inject all loaded skills into the system context when the number is small.

A later version should support progressive loading.

## `McpManager`

Responsibilities:

- start/connect to configured MCP servers
- request available tools
- convert them into `AgentTool` instances
- route tool execution back to the correct MCP client
- close clients/processes on shutdown

V1 priority:

1. stdio MCP servers
2. Streamable HTTP MCP servers

Support SSE only if needed by an actual server under test.

## `PromptLoader`

Loads Markdown prompt files and performs only minimal substitutions.

Avoid building a general templating system.

Possible substitutions:

```text
{{skill_catalog}}
{{loaded_skills}}
{{runtime_date}}
```

Only add substitutions when there is a concrete need.

## `Tracer`

The agent publishes structured trace events rather than writing arbitrary debug strings throughout the code.

Conceptual events:

```ts
type TraceEvent =
  | { type: "run.start"; ... }
  | { type: "model.request"; ... }
  | { type: "model.response"; reasoningPresent?: boolean; reasoningChars?: number; ... }
  | { type: "tool.call"; ... }
  | { type: "tool.result"; ... }
  | { type: "run.complete"; ... }
  | { type: "run.error"; ... };
```

Implement at least:

- `NoopTracer`
- `ConsoleTracer`
- `JsonTracer`

## Dependency Direction

Prefer dependency direction toward small domain contracts:

```text
CLI → Agent → ModelProvider
           → ToolRegistry → MCP Adapter
           → SkillRegistry
           → Tracer
```

Avoid circular dependencies.
