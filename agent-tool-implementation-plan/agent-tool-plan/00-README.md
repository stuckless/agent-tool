# Agent Tool — Implementation Plan

## Plan Revision

Revision 2 adds first-class reasoning/thinking support across the model contract, Ollama adapter, agent loop, tracing, configuration, tests, and eval strategy. See `12-REASONING-THINKING.md`.

This directory is a handoff package for implementing a small, transparent, reusable agent runtime for Node.js.

The project is intentionally **not** based on LangChain, LangGraph, or another agent framework. The goal is to expose the mechanics of an agent clearly enough that a developer can understand and modify every layer: system prompts, skills, tools, MCP, model calls, reasoning/thinking modes, the agent loop, tracing, and evaluations.

## Primary Goal

Build a CLI that can be invoked as:

```bash
agent-tool "how many open work orders are in bedford"
```

The runtime should:

1. Load configuration.
2. Load the system prompt.
3. Discover available skills.
4. Connect to configured MCP servers and discover tools.
5. Call an Ollama-hosted model.
6. Execute requested tools.
7. Return tool results to the model.
8. Continue until the model produces a final answer or the step limit is reached.
9. Optionally emit a human-readable or JSON trace.

## Technology Decision

Use **TypeScript**, compiled to JavaScript, with npm.

Reasons:

- MCP tool schemas and tool call payloads benefit from static typing.
- Provider adapters become easier to swap without accidental contract drift.
- Evaluation records and trace events benefit from explicit schemas.
- The TypeScript should remain simple and readable; avoid advanced type-level programming.
- Runtime behavior must remain understandable from a small set of source files.

See `01-DECISIONS.md` for details.

## Documents

- `01-DECISIONS.md` — architectural and technology decisions.
- `02-ARCHITECTURE.md` — runtime architecture and interfaces.
- `03-IMPLEMENTATION-PHASES.md` — ordered implementation plan.
- `04-AGENT-LOOP.md` — exact behavior of the core loop.
- `05-SKILLS.md` — skill format, loading, selection, and progressive disclosure.
- `06-MCP-TOOLS.md` — MCP integration and tool normalization.
- `07-PROMPTS-CONTEXT.md` — system prompts and context construction.
- `08-TRACING-EVALS.md` — observability, traces, regression tests, and model comparisons.
- `09-CLI-CONFIG.md` — CLI contract and configuration format.
- `10-TESTING.md` — unit/integration testing strategy.
- `11-ROADMAP.md` — deliberately deferred capabilities and experiments.
- `12-REASONING-THINKING.md` — reasoning configuration, provider-exposed thinking, tool-loop preservation, tracing, and eval guidance.
- `AGENTS.md` — implementation guardrails for the coding assistant.

## Target Repository Shape

```text
agent-tool/
├── package.json
├── tsconfig.json
├── agent.config.json
├── README.md
├── AGENTS.md
├── prompts/
│   ├── minimal.md
│   └── investigative.md
├── skills/
│   └── example-work-orders/
│       └── SKILL.md
├── evals/
│   └── smoke.json
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── agent/
│   │   ├── agent.ts
│   │   └── types.ts
│   ├── model/
│   │   ├── types.ts
│   │   └── ollama.ts
│   ├── tools/
│   │   ├── types.ts
│   │   └── registry.ts
│   ├── mcp/
│   │   ├── client.ts
│   │   ├── adapter.ts
│   │   └── types.ts
│   ├── skills/
│   │   ├── loader.ts
│   │   ├── registry.ts
│   │   └── types.ts
│   ├── prompts/
│   │   └── loader.ts
│   ├── trace/
│   │   ├── tracer.ts
│   │   └── types.ts
│   └── eval/
│       ├── runner.ts
│       └── types.ts
└── test/
    ├── agent.test.ts
    ├── skills.test.ts
    └── tools.test.ts
```

The initial implementation should stay small. Do not create files merely to match this tree if a simpler organization remains clear.

## Definition of Success for V1

V1 is successful when all of the following work:

```bash
npm install
npm run dev -- "hello"
npm run dev -- --trace "use a tool to answer this question"
npm test
npm run build
```

And the compiled CLI can be linked locally:

```bash
npm link
agent-tool "how many open work orders are in bedford"
```

The trace should make it obvious which tools were offered, which tool was called, its arguments, the summarized result, and when the model decided it had enough evidence to answer. Reasoning mode should be visible as run metadata; provider-exposed thinking text remains hidden unless explicitly requested.
