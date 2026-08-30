# agent-tool

A small, transparent agent runtime for Node.js. Phase 5 adds inspectable human and JSON trace modes to the compact tool-calling loop.

## Requirements

- Node.js 22 or later
- npm

## Setup

```bash
npm install
```

## CLI

Configure the model with an environment variable:

```bash
AGENT_MODEL="your-local-model" npm run dev -- "explain what a work order is"
```

Or create `agent.config.json` in the project directory:

```json
{
  "model": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434",
    "name": "your-local-model",
    "reasoning": {
      "mode": "provider-default"
    },
    "options": {
      "temperature": 0
    }
  },
  "agent": {
    "systemPrompt": "./prompts/minimal.md"
  },
  "skills": {
    "directories": ["./skills"],
    "mode": "all"
  },
  "mcpServers": {
    "example": {
      "transport": "stdio",
      "command": "node",
      "args": ["./example-mcp-server.js"],
      "env": {
        "EXAMPLE_SETTING": "value"
      }
    }
  },
  "tools": {
    "allow": ["example.*"],
    "deny": ["example.delete"]
  }
}
```

`AGENT_OLLAMA_URL` overrides the configured Ollama base URL, and `AGENT_MODEL` or `--model` override the configured model. Use `--config <path>` to load a different JSON config file or `--prompt <path>` to override the system prompt for one run.

### Skills

Skills are Markdown instruction files, not executable tools. The runtime recursively discovers `SKILL.md` files below each configured `skills.directories` path. Each file needs YAML frontmatter with `name` and `description`; `tags` is optional. Its Markdown body is placed into the system context inside visible `<skill name="...">` boundaries. The user prompt is sent unchanged.

The included [work-orders skill](skills/work-orders/SKILL.md) is a small example:

```markdown
---
name: work-orders
description: Guidance for answering work-order questions.
tags:
  - maintenance
---

# Work Orders

Use authoritative tools for current work-order data.
```

By default, `skills.mode` is `all`; use `none` to load no skills. Select specific skills with repeatable `--skill` options:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --skills none "Explain a work order"
AGENT_MODEL="your-local-model" npm run dev -- --skill work-orders "Explain a work order"
```

An explicit `--skill` selection overrides the configured mode. `--skills all` is mutually exclusive with `--skill`; `--skills none --skill work-orders` is allowed and loads only `work-orders`.

Reasoning is configured separately from generic model options. Use `--reasoning default|off|on|low|medium|high|max` for a one-run override. The Ollama adapter maps these values to its `think` request field. Provider-exposed thinking is preserved as opaque model state but is not shown in normal output and never controls runtime behavior.

### Trace modes

Use `--trace` to write a concise, human-readable run trace to stderr. The final answer remains the only normal stdout output, so command substitution and piping stay clean:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --trace "Explain a work order"
```

The trace records the configured model and reasoning configuration, system-prompt path and content hash, selected skills, available local/MCP tools, ordered model and tool events, result payloads, and completion. Reasoning configuration is trace metadata; it is not added to the system prompt.

Use `--trace-json` instead for one structured JSON document on stderr, suitable for later analysis:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --trace-json "Explain a work order"
```

The two trace formats are mutually exclusive. Provider-exposed thinking is hidden by default; traces record only whether it was exposed and its character count. To inspect text that the provider actually returned, use `--show-thinking` together with either trace mode:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --trace --show-thinking "Explain a work order"
```

`--show-thinking` has no effect without tracing and never affects model requests or agent control flow. Trace values with common secret-like field names (`token`, `password`, `apiKey`, and similar), plus configured MCP environment values, are redacted, but traces can still contain user prompts and tool data—handle them accordingly.

The agent advertises two deterministic local tools in Phase 2: `echo` and `get_current_test_value`. When the model requests a tool, the runtime appends the complete normalized assistant turn (including provider-exposed reasoning/state), executes calls in their returned order, appends structured tool-result messages, and then asks the model to continue. `--max-steps <n>` limits model turns (default: 10); reaching the limit is an error, never a partial success.

Configured MCP stdio servers are started once per CLI invocation. Their tools are discovered with the official MCP SDK and registered as `serverName.toolName`, which prevents collisions between servers. MCP tool content and structured content are forwarded as normalized tool results, and clients are closed when the run finishes or fails. Do not put secrets in trace output; resolved MCP environment values are never logged.

### Local demo MCP server

The repository includes a safe, deterministic stdio MCP server for manual testing. Build first, then point the CLI at [demo-mcp.config.json](examples/demo-mcp.config.json):

```bash
npm run build
AGENT_OLLAMA_URL=http://192.168.11.10:11434 \
AGENT_MODEL=granite4.2:8b \
npm run dev -- --config examples/demo-mcp.config.json \
  "Use demo.lookup_demo_record to explain how MCP tools are integrated."
```

It exposes only `demo.get_demo_status` and `demo.lookup_demo_record`; both are read-only and return fixed data. The real local stdio protocol check is opt-in because some restricted sandboxes do not permit child-process pipes:

```bash
AGENT_TEST_STDIO=1 npm run test:mcp-stdio
```

`tools.allow` and `tools.deny` accept `*` wildcard patterns for MCP names. The default allows every discovered MCP tool; matching `deny` entries always win. Use this policy to keep unwanted or mutating MCP tools out of the model's available-tool list.

The package exposes an `agent-tool` executable after building and linking it locally:

```bash
npm run build
npm link
agent-tool "explain what a work order is"
```

## Development

```bash
npm test
npm run typecheck
npm run build
```

Phase 6 evaluations are not implemented. A live-model check that enabling a skill changes tool selection or answer behavior has not been performed; normal tests use only deterministic fake components.
