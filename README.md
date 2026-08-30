# agent-tool

A small, transparent agent runtime for Node.js. This repository is being built in phases; Phase 0 provides the TypeScript and CLI foundation.

## Requirements

- Node.js 22 or later
- npm

## Setup

```bash
npm install
```

## CLI

During Phase 0, the CLI simply prints the prompt through a placeholder handler:

```bash
npm run dev -- "hello"
```

The package also exposes an `agent-tool` executable after building and linking it locally:

```bash
npm run build
npm link
agent-tool "hello"
```

## Development

```bash
npm test
npm run typecheck
npm run build
```

Later phases will add model configuration, Ollama calls, skills, MCP tools, traces, and evaluations.
