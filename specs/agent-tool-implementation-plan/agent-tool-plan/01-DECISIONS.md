# Architecture Decisions

## D1 — TypeScript over JavaScript

Use TypeScript for source code and compile to JavaScript for execution.

The project is an educational agent runtime, so TypeScript must not obscure control flow. Prefer explicit interfaces and simple discriminated unions. Avoid decorators, dependency injection frameworks, complex generics, code generation, or abstract base-class hierarchies.

Recommended baseline:

- Node.js 22+
- TypeScript
- npm
- ESM modules
- `tsx` for development execution
- `tsc` for production build
- `yargs` for CLI argument parsing
- `@modelcontextprotocol/sdk` for MCP
- `zod` for configuration/runtime validation where useful
- `vitest` for tests

## D2 — No agent framework dependency

Do not use LangChain, LangGraph, Semantic Kernel, or similar abstractions in the initial implementation.

The purpose is to understand:

- message construction
- tool definition conversion
- tool call execution
- loop termination
- skill injection
- system prompting
- context growth
- tracing
- evaluation

Those mechanics should remain visible in project-owned code.

## D3 — Provider abstraction, Ollama implementation first

The agent runtime depends on a small `ModelProvider` contract rather than directly depending on Ollama throughout the codebase.

V1 implements only Ollama.

Future providers such as OpenAI, Anthropic, or an OpenAI-compatible endpoint should be addable without changing the agent loop.

Do not prematurely implement multiple providers.

## D4 — Native Ollama API first

Prefer Ollama's native chat API for V1 rather than using a third-party AI SDK.

Reasons:

- fewer dependencies
- easier visibility into actual request/response payloads
- direct access to Ollama-specific fields
- better educational value

Wrap Ollama behind `ModelProvider` so the decision can be revisited later.

## D5 — Tools use one normalized internal contract

MCP is a transport/protocol for obtaining tools. It should not leak through the entire runtime.

All tools are normalized to an internal shape similar to:

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute(input: unknown): Promise<ToolExecutionResult>;
  source: ToolSource;
}
```

The model sees normalized tools. The agent calls normalized tools. MCP-specific behavior remains in the MCP adapter.

## D6 — Skills are instructions, not capabilities

A skill contains guidance for approaching a class of tasks. A skill is not itself an action.

Example:

- Tool: `workorders_count`
- Skill: instructions defining what "open" means, when to count versus list, and how to interpret locations

V1 may inject skill content directly. Later versions may expose an internal `load_skill` mechanism for progressive disclosure.

## D7 — Keep the first agent loop deliberately simple

The initial loop is:

```text
messages + tools
      ↓
    model
      ↓
tool call? ── no ──> final answer
   │
  yes
   ↓
execute tool
   ↓
append result
   ↓
repeat
```

Do not add planners, subagents, reflection passes, or automatic retries until traces demonstrate a need.

## D8 — Observability is part of V1

Tracing is not a later production feature. It is necessary to learn how the agent behaves.

Trace observable events such as:

- system prompt selected
- skills loaded
- tools offered
- model request start/end
- tool calls
- tool inputs
- tool completion/error
- loop steps
- final response
- token/context metadata when available

Do not require chain-of-thought for runtime correctness. Provider-exposed thinking may be captured for explicit local debugging, but must be hidden from normal traces by default. The framework should work from structured model outputs and tool calls.

## D9 — Evals are first-class

The project should support repeatable evaluation of the same questions against different:

- models
- system prompts
- skill configurations
- tool configurations
- reasoning/settings

This is essential to distinguish "model problem" from "agent problem."

## D10 — Reasoning is an explicit model concern

Represent reasoning configuration separately from generic model options. The provider adapter translates generic settings into provider-specific request fields.

For Ollama, support provider-default, boolean enable/disable where appropriate, and effort levels. GPT-OSS examples should use `low`, `medium`, or `high` effort rather than booleans.

If Ollama returns `message.thinking`, preserve it in the normalized assistant message so the provider can replay the complete assistant turn during tool loops. Agent logic must never inspect the reasoning text to decide whether to continue or which tool to execute.

See `12-REASONING-THINKING.md`.

## D11 — Fail closed on uncontrolled loops

Every run must have a configurable maximum number of model steps/tool turns.

Default recommendation: 10 steps.

On exhaustion, return a clear error explaining that the step limit was reached and include trace information if enabled.

## D12 — Configuration before hard-coding

The following should be configurable without editing TypeScript:

- Ollama base URL
- model
- system prompt
- explicit reasoning mode/effort
- generic model options
- max steps
- skill directories
- MCP servers
- tracing
- tool allow/deny policy

Keep configuration straightforward and JSON-based for V1.
