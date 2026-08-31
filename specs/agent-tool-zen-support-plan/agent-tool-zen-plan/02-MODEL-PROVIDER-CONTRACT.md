# Model Provider Contract

## Goal

Create the smallest normalized contract that supports:

- normal text generation
- system/user/assistant/tool messages
- tool definitions
- tool calls
- reasoning configuration
- provider reasoning metadata
- token/usage metadata
- stop/finish reason
- model capabilities

Do not normalize every provider feature. Normalize only features the agent needs.

## Suggested types

Names may be adapted to the existing project.

```ts
export type ModelProviderId = 'ollama' | 'zen';

export interface ModelRef {
  provider: ModelProviderId;
  model: string;
}
```

### Normalized request

```ts
export interface ModelRequest {
  model: string;
  messages: AgentMessage[];
  tools?: NormalizedToolDefinition[];
  reasoning?: ReasoningRequest;
  temperature?: number;
  maxOutputTokens?: number;
}
```

Do not expose provider-specific request objects to the agent.

### Normalized result

```ts
export interface ModelResponse {
  message: AssistantMessage;
  finishReason?: ModelFinishReason;
  usage?: ModelUsage;
  reasoning?: ReasoningMetadata;
  providerMetadata?: Record<string, unknown>;
}
```

Provider metadata is diagnostic only. Agent logic must not depend on it.

### Assistant message

Use the project's existing normalized message shape if one already exists. It should be able to preserve:

```ts
export interface AssistantMessage {
  role: 'assistant';
  content?: string;
  toolCalls?: ToolCall[];
  reasoningState?: unknown;
}
```

`reasoningState` requires careful treatment:

- It exists only when needed to preserve provider continuation state.
- It is opaque to the agent.
- It must not be inspected to make decisions.
- It must not be printed by default.

If existing Ollama behavior stores `thinking`, preserve it through an equivalent provider-neutral representation.

## Provider interface

```ts
export interface ModelProvider {
  readonly id: ModelProviderId;

  generate(request: ModelRequest): Promise<ModelResponse>;

  listModels?(): Promise<ModelDescriptor[]>;

  getModelCapabilities?(model: string): Promise<ModelCapabilities>;
}
```

Do not add streaming to the first Zen expansion unless streaming already exists in the base project.

If streaming already exists, define a separate `stream()` operation rather than making `generate()` return a union of many result types.

## Model descriptor

```ts
export interface ModelDescriptor {
  id: string;
  provider: ModelProviderId;
  displayName?: string;
  capabilities?: ModelCapabilities;
  metadata?: Record<string, unknown>;
}
```

Zen's `/v1/models` endpoint currently provides IDs and basic ownership metadata. It should not be treated as an authoritative capability registry.

## Capabilities

```ts
export interface ModelCapabilities {
  tools?: boolean;
  reasoning?: boolean;
  reasoningLevels?: string[];
  protocol?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}
```

Unknown values should remain unknown rather than guessed.

## Reasoning request

Use a generic shape that can represent both Ollama and hosted providers:

```ts
export interface ReasoningRequest {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high';
}
```

Providers map this into their native option if supported.

Unsupported values should produce either:

1. a clear configuration error, or
2. an explicit trace warning when policy says unsupported options may be ignored.

Choose one behavior globally. Recommended: fail fast for explicit CLI/config requests.

## Tool definition

The normalized tool definition belongs outside model providers:

```ts
export interface NormalizedToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}
```

Each protocol adapter converts this into its wire-format tool schema.

## Tool call

```ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
```

Provider-generated IDs must be preserved when required for tool-result correlation.

## Tool result messages

The agent should preserve a normalized `toolCallId`:

```ts
export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  name?: string;
  content: string;
  isError?: boolean;
}
```

Each provider adapter serializes this into the format expected by that model protocol.

## Error normalization

Provider implementations should map failures to a small set of errors:

```text
AuthenticationError
ModelNotFoundError
UnsupportedCapabilityError
RateLimitError
ProviderUnavailableError
InvalidProviderResponseError
ModelInvocationError
```

Do not leak API-key-bearing request headers into errors or traces.

## Retry boundary

Transport retries belong in provider implementations.

Semantic retries belong in agent logic.

Examples:

Provider retry:

```text
HTTP 503 / connection reset / retryable 429
```

Agent retry:

```text
model called a tool with invalid arguments
retrieved evidence was incomplete
```

Do not mix these responsibilities.
