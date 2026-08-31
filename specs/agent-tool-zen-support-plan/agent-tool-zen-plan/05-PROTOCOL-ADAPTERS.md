# Zen Protocol Adapters

## Goal

Each adapter translates between the `agent-tool` normalized model contract and one Zen protocol.

Adapters should be boring transport/mapping code.

## Common flow

Every adapter performs the same conceptual operations:

```text
ModelRequest
   |
   v
map normalized messages
map normalized tools
map reasoning options
   |
   v
provider/AI SDK request
   |
   v
provider response
   |
   v
normalize content
normalize tool calls
normalize usage
preserve required continuation/reasoning state
   |
   v
ModelResponse
```

## A. OpenAI-compatible Chat Completions

### Initial target

Implement this adapter first because it gives access to hosted open models such as DeepSeek and MiniMax while providing a useful comparison against local Ollama.

Zen endpoint:

```text
https://opencode.ai/zen/v1/chat/completions
```

Use:

```text
@ai-sdk/openai-compatible
```

### Requirements

- system/user/assistant messages
- normalized tool definitions
- tool call decoding
- tool result correlation
- final text
- finish reason
- usage if exposed
- provider errors

### Test model

Use a cheap/available Zen model selected from `agent-tool models --provider zen`; do not hardwire a test to one model that may disappear.

## B. OpenAI Responses

Zen endpoint:

```text
https://opencode.ai/zen/v1/responses
```

Use:

```text
@ai-sdk/openai
```

### Requirements

In addition to normal tool calling, carefully preserve any response item IDs or continuation state the API/provider requires across tool turns.

The agent itself must not know about Responses API item shapes.

### Reasoning

Map normalized reasoning effort to supported provider/model options.

Do not assume every Responses model supports the same reasoning levels.

Capability validation should occur before invocation when possible.

## C. Anthropic Messages

Zen endpoint:

```text
https://opencode.ai/zen/v1/messages
```

Use:

```text
@ai-sdk/anthropic
```

### Requirements

Normalize Anthropic content/tool-use blocks into:

```text
assistant.content
assistant.toolCalls[]
```

Tool results must be serialized back using the adapter's expected protocol.

### Reasoning/thinking

If extended thinking is exposed through the library/protocol, preserve only the provider state necessary for valid continuation.

Do not make agent behavior depend on text from thinking blocks.

## D. Google/Gemini

Zen endpoint family:

```text
https://opencode.ai/zen/v1/models/<model-id>
```

Use:

```text
@ai-sdk/google
```

### Requirements

- messages/content normalization
- function/tool definitions
- function calls
- function responses
- usage if exposed
- provider-specific continuation metadata as needed

This adapter may be implemented last because it differs most from the other Zen endpoint families.

## Shared adapter helpers

Create shared helpers only when duplication actually appears.

Potential helpers:

```text
normalizeUsage()
normalizeFinishReason()
redactProviderError()
```

Do not create a generic "protocol engine".

## Tool-call argument behavior

Normalize arguments to JavaScript objects before the agent receives them.

If a provider returns malformed JSON arguments:

- capture the issue in trace
- return a normalized invalid-tool-call condition
- allow existing agent/tool validation policy to decide whether to retry

Do not silently repair arbitrary invalid JSON in the provider layer unless the base project already has a documented repair strategy.

## Multiple tool calls

All adapters must preserve multiple tool calls in a single assistant turn.

The agent decides whether to execute them serially or concurrently based on its existing policy.

Do not change agent execution semantics merely because one provider supports parallel tool calls.

## Streaming

Do not add streaming as part of Zen support unless it already exists.

If it exists, each adapter must be able to accumulate a provider stream into the same normalized assistant turn, including tool calls and any opaque continuation state.
