# Experiments and Deferred Roadmap

This file lists useful directions after the transparent core runtime works. None are required for the first implementation.

## 1. Dynamic Skill Loading

Compare:

- all skills injected
- explicit skill selection
- model-selected `load_skill`

Measure quality and context size.

## 2. Dynamic Tool Discovery

When MCP servers expose many tools, compare:

- all tools
- static groups
- server-based filtering
- searchable tool catalog
- model-selected subset

Measure wrong-tool rate and input token usage.

## 3. Tool Description Overrides

Allow local metadata to improve a poorly described MCP tool without changing the MCP server.

Example use:

```text
original: "Search work orders"

override: detailed guidance describing when to use search versus count,
filters, pagination, and result semantics.
```

This directly tests how much tool guidance affects model performance.

## 4. Verification Pass

Experiment with an optional post-answer verification step, but do not make it default until evals show benefit.

Possible behavior:

- inspect gathered evidence
- check whether the answer actually addresses the question
- request another tool call if evidence is insufficient

Avoid generic "reflect until satisfied" loops.

## 5. Retry Policy

Distinguish:

- transport retry
- MCP/tool retry
- reasoning retry

Never blindly retry every failure.

## 6. Result Pagination and Large Data

Add runtime patterns for:

- paginated tools
- count-before-fetch
- bounded result sets
- explicit truncation
- follow-up retrieval

Skills may contain domain-specific pagination rules.

## 7. Read/Write Safety

Before production use with mutating tools, add:

- read-only default mode
- explicit write enablement
- destructive tool confirmation policy where appropriate
- MCP annotation support
- tool allow/deny profiles

## 8. Persistent Sessions

Possible later CLI:

```bash
agent-tool chat
```

Do not add until single-run behavior is well understood.

## 9. Frontend/API Embedding

Because the core API is reusable, later expose it through:

- Express/Fastify server
- web UI
- VSCode extension
- existing enterprise assistant

Keep those as hosts around the same runtime rather than forks of the agent logic.

## 10. Model Routing

Once multiple providers exist, test routing such as:

```text
local model first
      ↓
confidence/failure criteria
      ↓
frontier model fallback
```

Do not implement routing based on vibes. Define measurable escalation conditions.

## 11. Benchmarking Questions

Build a real internal eval corpus from user questions, especially failures from the existing assistant.

For every case, capture what correct behavior means:

- expected tool family
- necessary filters
- expected result facts
- unacceptable behavior

This will be the strongest artifact for deciding whether model or harness changes matter more.
