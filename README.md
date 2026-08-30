# agent-tool

A small, transparent agent runtime for Node.js. Phase 1 supports one Ollama chat request with a configurable system prompt; tools and the agent loop arrive in later phases.

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

Later phases will add tool calling, skills, MCP tools, traces, and evaluations.
