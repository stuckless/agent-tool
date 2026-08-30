# agent-tool

A small, transparent agent runtime for Node.js. Phase 2 adds a compact tool-calling loop backed by deterministic in-process test tools.

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
  }
}
```

`AGENT_OLLAMA_URL` overrides the configured Ollama base URL, and `AGENT_MODEL` or `--model` override the configured model. Use `--config <path>` to load a different JSON config file or `--prompt <path>` to override the system prompt for one run.

Reasoning is configured separately from generic model options. Use `--reasoning default|off|on|low|medium|high|max` for a one-run override. The Ollama adapter maps these values to its `think` request field. Provider-exposed thinking is preserved as opaque model state but is not shown in normal output and never controls runtime behavior.

The agent advertises two deterministic local tools in Phase 2: `echo` and `get_current_test_value`. When the model requests a tool, the runtime appends the complete normalized assistant turn (including provider-exposed reasoning/state), executes calls in their returned order, appends structured tool-result messages, and then asks the model to continue. `--max-steps <n>` limits model turns (default: 10); reaching the limit is an error, never a partial success.

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

Later phases will add MCP tools, skills, CLI trace modes, and evaluations.
