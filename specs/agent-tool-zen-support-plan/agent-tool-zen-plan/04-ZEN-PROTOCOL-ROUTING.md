# Zen Model Protocol Routing

## Why routing exists

Zen is a gateway, but its model catalog currently uses multiple API protocols.

The public model listing endpoint returns model IDs but does not currently identify the protocol to use for each ID.

Therefore:

```text
model discovery != protocol discovery
```

`agent-tool` must explicitly route Zen model IDs to adapters.

## Current documented families

At the time this plan was created, OpenCode's Zen documentation maps model families approximately as follows:

### OpenAI Responses

Examples:

```text
gpt-*
grok-*
muse-spark-*
```

Endpoint:

```text
/zen/v1/responses
```

AI SDK package:

```text
@ai-sdk/openai
```

### Anthropic Messages

Examples:

```text
claude-*
qwen3.* / qwen3-*
```

Endpoint:

```text
/zen/v1/messages
```

AI SDK package:

```text
@ai-sdk/anthropic
```

### OpenAI-compatible Chat Completions

Examples include:

```text
deepseek-*
minimax-*
glm-*
kimi-*
big-pickle
mimo-*
ling-*
nemotron-*
```

Endpoint:

```text
/zen/v1/chat/completions
```

AI SDK package:

```text
@ai-sdk/openai-compatible
```

### Google/Gemini

Examples:

```text
gemini-*
```

Endpoint family:

```text
/zen/v1/models/<model-id>
```

AI SDK package:

```text
@ai-sdk/google
```

## Do not blindly rely on prefix matching

Prefix rules are convenient but are not a durable API contract.

Implement routing with three layers, highest priority first:

```text
1. user/config override
2. exact known-model overrides
3. family/prefix rule
```

Example:

```ts
resolve(modelId, overrides) {
  return overrides[modelId]
      ?? exactRoutes[modelId]
      ?? familyRules.find(rule => rule.matches(modelId))?.protocol
      ?? undefined;
}
```

## Configuration override

Allow explicit model routing:

```json
{
  "providers": {
    "zen": {
      "modelRoutes": {
        "some-new-model": "openai-chat"
      }
    }
  }
}
```

This gives users an escape hatch when Zen adds a new model before `agent-tool` is updated.

## Why not infer by trying endpoints

Do not implement:

```text
try /responses
if 400 try /messages
if 400 try /chat/completions
```

Reasons:

- unnecessary billed/failed requests
- poor latency
- ambiguous error interpretation
- hard-to-debug evals
- unsafe behavior in a learning framework

## Model list display

When listing Zen models, display routing status:

```text
MODEL                    PROTOCOL             STATUS
claude-sonnet-5          anthropic-messages   supported
gpt-5.6-sol              openai-responses     supported
deepseek-v4-flash        openai-chat          supported
gemini-3.7-flash         google-generative    supported
new-model-x              unknown              discovered/unroutable
```

This makes catalog drift visible.

## Routing tests

Add table-driven unit tests covering:

- representative model from every family
- exact override precedence
- config override precedence
- unknown model behavior
- accidental family collisions

## Maintenance

The routing catalog should be a small isolated module with a comment linking to the Zen endpoint documentation.

Do not duplicate routing rules in config parsing, CLI commands, or adapters.
