# Target Architecture

## Before

The initial project is conceptually:

```text
CLI
 |
 v
Agent
 |
 v
OllamaModel
 |
 v
Ollama HTTP API
```

This is fine for the learning-oriented first implementation, but adding Zen directly inside `agent.ts` would couple the agent loop to provider wire formats.

## After

Introduce a deliberately small model-provider boundary:

```text
                         +------------------+
                         |       CLI        |
                         +--------+---------+
                                  |
                                  v
                         +------------------+
                         |      Agent       |
                         |                  |
                         | prompt/context   |
                         | tool loop        |
                         | skill behavior   |
                         +--------+---------+
                                  |
                         Normalized model API
                                  |
                   +--------------+--------------+
                   |                             |
                   v                             v
          +----------------+             +----------------+
          | OllamaProvider |             |  ZenProvider   |
          +--------+-------+             +--------+-------+
                   |                             |
              Ollama API                  Protocol router
                                                 |
                        +------------------------+-----------------------+
                        |                        |                       |
                        v                        v                       v
                 OpenAI Responses       Anthropic Messages      OpenAI-compatible
                                                                  Chat Completions
                                                 |
                                                 +--> Gemini adapter
```

## Architectural rule

`Agent` must not know:

- Ollama endpoint syntax
- Zen endpoint syntax
- OpenAI response objects
- Anthropic content blocks
- Gemini response shapes
- provider API keys
- provider-specific tool-call serialization

The agent only knows normalized objects.

## Core module structure

Recommended target layout:

```text
src/
  agent/
    agent.ts
    agent-types.ts

  model/
    model-provider.ts
    model-types.ts
    provider-registry.ts

    ollama/
      ollama-provider.ts
      ollama-mapper.ts

    zen/
      zen-provider.ts
      zen-model-catalog.ts
      zen-protocol-router.ts
      zen-types.ts

      adapters/
        zen-openai-responses.ts
        zen-anthropic-messages.ts
        zen-openai-chat.ts
        zen-google.ts

  tools/
    ... existing normalized tool layer ...

  skills/
    ... existing skills ...

  trace/
    ... existing tracing ...

  eval/
    ... existing eval runtime ...
```

Do not create inheritance hierarchies unless required. Prefer interfaces + composition.

## Model vs provider

Keep these concepts separate.

A **provider** is the service/transport:

```text
ollama
zen
```

A **model** is selected within that provider:

```text
ollama/gpt-oss:120b
zen/deepseek-v4-flash
zen/gpt-5.6-sol
zen/claude-sonnet-5
```

A model can also expose provider/model-specific capabilities.

## Provider registry

A small provider registry should resolve configuration into a provider instance:

```ts
const provider = providerRegistry.create(config.model.provider, config);
```

Initial registry entries:

```text
ollama
zen
```

Do not implement plugin loading for providers in this expansion.

## Dependency direction

Dependencies should point inward:

```text
CLI/config ---> provider registry ---> provider implementation
       \               |
        \              v
         +----------> Agent <---------- tools/skills/tracing
```

`Agent` depends on `ModelProvider` interface, not concrete providers.

## Preserve learning value

The AI SDK may be used inside Zen protocol adapters because translating OpenAI/Anthropic/Google HTTP formats is not the experiment.

The following remain our code:

- agent loop
- tool execution loop
- tool normalization
- MCP integration
- skills
- prompt assembly
- context policy
- retries
- tracing
- evals

Do not use an AI SDK's agent abstraction or autonomous tool loop.

## No provider-specific branches in the agent

Forbidden pattern:

```ts
if (config.provider === 'zen') {
  // special Zen behavior inside agent loop
}
```

Preferred:

```ts
const response = await modelProvider.generate(request);
```

Any provider-specific translation occurs behind the provider boundary.

## Provider migration strategy

Before adding Zen, refactor the existing Ollama code to conform to the new `ModelProvider` contract.

This is essential because it proves the abstraction is shaped by existing behavior rather than only by hypothetical Zen requirements.

The Ollama behavior and tests must remain unchanged after this refactor.
