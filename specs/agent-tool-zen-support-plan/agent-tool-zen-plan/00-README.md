# agent-tool: OpenCode Zen Provider Expansion

## Purpose

This plan extends the existing `agent-tool` project from an Ollama-only model runtime into a small, explicit multi-provider runtime that can run the **same agent loop, prompts, skills, MCP tools, tracing, and evals** against both local Ollama models and hosted models available through OpenCode Zen.

The purpose is not to build a universal AI SDK wrapper. The purpose is to make model/provider differences measurable while preserving a transparent agent implementation.

The key experiment becomes:

```text
same user question
same system prompt
same skills
same MCP tools
same tool results
same agent loop
same context policy
        |
        +--> Ollama / local model
        +--> Zen / GPT model
        +--> Zen / Claude model
        +--> Zen / DeepSeek model
        +--> Zen / Gemini model
```

That lets us separate **model quality** from **agent quality**.

## Current Zen facts that drive this design

OpenCode Zen exposes multiple model protocols rather than one universal inference endpoint:

- OpenAI Responses-style models: `/zen/v1/responses`
- Anthropic Messages-style models: `/zen/v1/messages`
- OpenAI-compatible Chat Completions models: `/zen/v1/chat/completions`
- Gemini models: `/zen/v1/models/<model-id>`

Zen also exposes a model listing endpoint:

```text
https://opencode.ai/zen/v1/models
```

The model listing currently returns model IDs but does not identify which protocol each ID requires. Therefore this project must treat **model discovery** and **model protocol routing** as separate concerns.

## Design goals

1. Keep the agent loop provider-independent.
2. Preserve the current Ollama implementation.
3. Add Zen without rewriting skills, MCP integration, prompts, or tracing.
4. Normalize provider-specific tool calls and reasoning metadata.
5. Make provider/model selection a CLI/config concern.
6. Make model comparison easy in evals.
7. Keep API keys out of config files and traces.
8. Avoid LangChain/LangGraph/agent frameworks.
9. AI SDK packages may be used only as model-protocol clients.
10. Keep the implementation understandable by reading a small number of files.

## Recommended implementation order

Do not implement all Zen protocols at once.

1. Provider abstraction and Ollama migration
2. Zen authentication + model discovery
3. Zen OpenAI-compatible Chat Completions adapter
4. Zen OpenAI Responses adapter
5. Zen Anthropic Messages adapter
6. Zen Google/Gemini adapter
7. Reasoning/capability normalization
8. CLI/config/model listing
9. Cross-provider eval support
10. Documentation, hardening, and regression tests

Each phase should be tested and committed before the next phase.

## Files in this plan

- `01-ARCHITECTURE.md` — target architecture and boundaries
- `02-MODEL-PROVIDER-CONTRACT.md` — normalized provider/model interfaces
- `03-ZEN-PROVIDER.md` — Zen provider responsibilities
- `04-ZEN-PROTOCOL-ROUTING.md` — mapping Zen models to protocol adapters
- `05-PROTOCOL-ADAPTERS.md` — Responses, Messages, Chat Completions, Gemini
- `06-REASONING-CAPABILITIES.md` — reasoning and capability normalization
- `07-CLI-CONFIG-SECRETS.md` — CLI, configuration, credentials, model listing
- `08-IMPLEMENTATION-PHASES.md` — concrete staged coding plan
- `09-TESTING-EVALS.md` — unit/integration/eval strategy
- `10-SECURITY-PRIVACY.md` — hosted-model safeguards for work usage
- `11-ACCEPTANCE-CRITERIA.md` — definition of done
- `AGENTS.md` — coding-assistant constraints for this expansion

## Source references used for this plan

Current OpenCode Zen documentation:

- https://dev.opencode.ai/docs/zen/
- https://opencode.ai/zen/v1/models

Because Zen's model catalog changes, source-code implementations must not assume this plan's example model IDs remain exhaustive.
