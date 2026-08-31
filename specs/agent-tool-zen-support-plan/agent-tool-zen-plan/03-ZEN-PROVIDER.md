# Zen Provider

## Responsibility

`ZenProvider` is the provider-level facade for all OpenCode Zen models.

It owns:

- Zen API authentication
- model discovery
- protocol routing
- protocol adapter construction
- common Zen error handling
- provider metadata

It does **not** own:

- the agent loop
- skill selection
- MCP tools
- tool execution
- prompt strategy
- eval scoring

## Configuration

Recommended configuration shape:

```json
{
  "model": {
    "provider": "zen",
    "name": "deepseek-v4-flash",
    "reasoning": {
      "effort": "high"
    }
  },
  "providers": {
    "zen": {
      "baseUrl": "https://opencode.ai/zen/v1",
      "apiKeyEnv": "OPENCODE_ZEN_API_KEY"
    }
  }
}
```

Do not store the API key itself in `agent.config.json`.

## Environment

Primary credential:

```text
OPENCODE_ZEN_API_KEY
```

Support an alternate variable only if there is a compelling existing project convention.

Do not automatically read OpenCode's own private credential file. `agent-tool` should remain independently configurable.

## Model discovery

Implement:

```ts
await zenProvider.listModels()
```

using:

```text
GET https://opencode.ai/zen/v1/models
```

Normalize results into `ModelDescriptor[]`.

Important: the endpoint currently lists IDs but does not expose the required protocol for each model. Discovery therefore cannot replace the protocol routing catalog.

## Protocol resolution

Conceptually:

```ts
const protocol = zenProtocolRouter.resolve(modelId, configOverride);
const adapter = adapterRegistry.for(protocol);
return adapter.generate(request);
```

If a discovered model has no known protocol mapping, return a useful error:

```text
Zen model "new-model-x" is available but agent-tool does not yet know which
Zen protocol it uses. Configure providers.zen.modelRoutes or update the Zen
model routing catalog.
```

Do not silently guess and send requests to random endpoints.

## Supported protocol IDs

Use a small enum/string union:

```ts
type ZenProtocol =
  | 'openai-responses'
  | 'anthropic-messages'
  | 'openai-chat'
  | 'google-generative';
```

## Adapter construction

The provider may use AI SDK client packages underneath the adapters:

```text
@ai-sdk/openai
@ai-sdk/anthropic
@ai-sdk/openai-compatible
@ai-sdk/google
```

The adapter should expose our normalized `ModelProvider.generate()` semantics, not AI SDK agent semantics.

## Base URLs

Centralize Zen base URLs. Do not scatter literal endpoint URLs across protocol adapters.

Example:

```ts
const base = 'https://opencode.ai/zen/v1';
```

Derived endpoints:

```text
/responses
/messages
/chat/completions
/models
/models/<gemini-model-id>
```

AI SDK packages may expect different base-URL forms. Keep package-specific URL setup inside the corresponding adapter.

## HTTP headers

Credential/header construction must be centralized and tested.

Never trace Authorization header values.

## Model metadata cache

Optional small in-memory cache:

```text
model list TTL: 5-15 minutes
```

Avoid disk persistence in the first implementation.

`agent-tool models --provider zen` may support `--refresh` later if useful.

## Failure behavior

Examples:

- 401/403 -> authentication error
- disabled model -> model-unavailable/model-not-allowed error with provider message
- unknown model -> model-not-found error
- unknown protocol mapping -> unsupported-model-routing error

No automatic fallback to another Zen model in V1. Model fallback would contaminate eval comparisons.

## Observability

Trace safe fields:

```text
provider=zen
model=deepseek-v4-flash
protocol=openai-chat
request duration
usage
finish reason
number of tool calls
```

Do not trace:

```text
API key
Authorization headers
raw credential-bearing errors
provider-exposed reasoning text unless explicit show-thinking behavior already allows it
```
