# agent-tool

A small, transparent agent runtime for Node.js. Phase 8 adds opt-in dynamic tool discovery to the compact tool-calling loop.

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
    "deny": ["example.delete"],
    "discovery": {
      "mode": "search",
      "initialAllow": ["example.read_status"]
    }
  }
}
```

`AGENT_OLLAMA_URL` overrides the configured Ollama base URL, and `AGENT_MODEL` or `--model` override the configured model. Use `--config <path>` to load a different JSON config file or `--prompt <path>` to override the system prompt for one run.

### Environment files

`agent-tool` automatically reads `.env` from the working directory. This is useful for local-only values such as Zen credentials, without repeating them on the command line:

```dotenv
OPENCODE_ZEN_API_KEY="..."
AGENT_PROVIDER=zen
```

Existing shell environment variables take precedence over `.env`. The repository already ignores `.env`; never commit it or put a real key in a config file, fixture, trace, or command output.

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

By default, `skills.mode` is `all`, which eagerly places every selected skill body in the system context; use `none` to load no skills. Select specific skills with repeatable `--skill` options:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --skills none "Explain a work order"
AGENT_MODEL="your-local-model" npm run dev -- --skill work-orders "Explain a work order"
```

An explicit `--skill` selection overrides the configured mode. `--skills all` is mutually exclusive with `--skill`; `--skills none --skill work-orders` is allowed and loads only `work-orders`.

Set `skills.mode` to `progressive` (or use `--skills progressive`) to send a compact catalog of the selected skills—name and description only—rather than their Markdown bodies. In this mode the registry also contains the runtime-owned `runtime.load_skill` tool. It accepts an exact catalog name and returns that selected skill's full Markdown instructions. The returned tool result stays in the ordered conversation for the rest of the run. Repeated loads return an `alreadyLoaded` result without repeating the Markdown; unknown and unselected names return safe normalized errors the model can recover from. Skills remain instruction content, not executable capabilities.

```bash
AGENT_MODEL="your-local-model" npm run dev -- --skills progressive --skill work-orders "Explain a work order"
```

Reasoning is configured separately from generic model options. Use `--reasoning default|off|on|low|medium|high|max` for a one-run override. The Ollama adapter maps these values to its `think` request field. Provider-exposed thinking is preserved as opaque model state but is not shown in normal output and never controls runtime behavior.

### Trace modes

Use `--log` for a live, color-coded activity stream on stderr. It shows the conversation sent to the assistant, its response, tool calls, and normalized tool results as each step occurs; the final answer still remains clean on stdout:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --log "Explain a work order"
```

`--log` can be combined with either trace mode. Sensitive-looking fields and configured MCP environment values are redacted. Provider-exposed thinking stays hidden unless `--show-thinking` is supplied.

Use `--trace` to write a concise, human-readable run trace to stderr. The final answer remains the only normal stdout output, so command substitution and piping stay clean:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --trace "Explain a work order"
```

The trace records the configured model and reasoning configuration, system-prompt path and content hash, selected skills, available local/MCP/runtime tools, ordered model and tool events, result payloads, and completion. Progressive runs additionally record the compact skill catalog and each skill-load outcome. Reasoning configuration is trace metadata; it is not added to the system prompt.

Use `--trace-json` instead for one structured JSON document on stderr, suitable for later analysis:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --trace-json "Explain a work order"
```

The two trace formats are mutually exclusive. Provider-exposed thinking is hidden by default; traces record only whether it was exposed and its character count. To inspect text that the provider actually returned, use `--show-thinking` together with either trace mode:

```bash
AGENT_MODEL="your-local-model" npm run dev -- --trace --show-thinking "Explain a work order"
```

`--show-thinking` has no effect without `--log`, `--trace`, or `--trace-json`, and never affects model requests or agent control flow. Log and trace values with common secret-like field names (`token`, `password`, `apiKey`, and similar), plus configured MCP environment values, are redacted, but they can still contain user prompts and tool data—handle them accordingly.

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

Use [demo-tool-discovery.config.json](examples/demo-tool-discovery.config.json) to test Phase 8 with the same demo MCP server. It starts with only `runtime.search_tools` visible; search for `demo status` or `demo record` before calling a returned `demo.*` tool.

`tools.allow` and `tools.deny` accept `*` wildcard patterns for MCP names. The default allows every discovered MCP tool; matching `deny` entries always win. Use this policy to keep unwanted or mutating MCP tools out of the model's available-tool list.

### Dynamic tool discovery

Tool filtering is disabled by default, so existing runs continue to send every registered local, MCP, and runtime tool to the model. To reduce initial context for a large catalog, set `tools.discovery.mode` to `search`. The initial context then contains only tools matched by `initialAllow`, plus runtime-owned tools such as `runtime.search_tools` and, for progressive skills, `runtime.load_skill`.

`runtime.search_tools` takes a short capability query and returns up to eight matching registered tool names and descriptions. Returned tools become available on the next turn and are the only non-runtime tools it may call for the rest of that run. Names not initially allowed or returned from search receive a safe `ToolUnavailable` result; unknown names retain `UnknownTool`. Matching is deterministic keyword matching over tool names and descriptions, not RAG or embeddings.

```json
{
  "tools": {
    "discovery": {
      "mode": "search",
      "initialAllow": ["demo.get_demo_status"]
    }
  }
}
```

Human and JSON traces record the complete registered catalog, the filtered initial context, and each search query with the tools it made available. Eval traces include those same observable events.

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

### Evaluations

`agent-eval` runs a JSON dataset through the same agent runtime, skills, local tools, MCP integration, configuration, and reasoning setting as a normal run. It emits a structured JSON report to stdout; use `--output` to save the same report for later comparison:

```bash
AGENT_MODEL="your-local-model" npm run dev:eval -- examples/demo-evals.json --output eval-results.json
```

Each case requires `id`, `prompt`, and an `expect` object with `requiredTools`, `forbiddenTools`, `maxToolCalls`, and `outputIncludes`. A run passes only when it completes, matches every tool/output assertion, stays under the call limit, and has no tool errors. The report records a SHA-256 prompt identity, selected skills, available tools, model turns and tool-call events, final completion/error status, and the configured model/reasoning metadata. It never uses provider-exposed thinking text to make eval decisions.

The included [demo-evals.json](examples/demo-evals.json) is a format example; it needs a model that reliably includes `work order` and is not a deterministic model acceptance test. Deterministic normal tests use only fake models and local tools, including Phase 7 skill loading and Phase 8 search-then-tool evals. No live Ollama eval, real MCP eval, or manual check that a skill or tool-discovery setting changes live model behavior has been performed; those remain optional follow-up checks after Phase 8.
