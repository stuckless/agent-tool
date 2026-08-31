# Testing and Cross-Provider Evals

## Testing pyramid

### Unit tests

Test pure translation and routing heavily.

Key units:

```text
provider registry
Zen protocol router
model list mapper
message mapping
normalized tool -> provider tool mapping
provider tool call -> normalized tool call
tool result mapping
usage mapping
finish reason mapping
error normalization
credential redaction
reasoning capability validation
```

### Provider fixture tests

Do not require paid live Zen calls for the normal test suite.

Capture/synthesize representative provider response fixtures for:

```text
OpenAI-compatible chat
OpenAI Responses
Anthropic Messages
Google/Gemini
```

No real API keys in fixtures.

### Integration tests

Use fake/local HTTP servers when practical to verify:

```text
URL
headers
body shape
error responses
```

### Live smoke tests

Live Zen tests must be explicitly enabled, for example:

```bash
npm run test:zen:live
```

Requirements:

- `OPENCODE_ZEN_API_KEY`
- not part of default CI
- use a low-cost model/configurable model
- make minimal requests

## Golden cross-provider tool scenario

Create one simple deterministic test tool:

```text
get_weather(city) -> fixed fixture
```

or another domain-neutral tool.

Then use the same prompt against all providers:

```text
What is the weather in Bedford? Use the available tool.
```

Expected behavioral assertions:

```text
correct tool selected
arguments contain Bedford
result is incorporated
no hallucinated replacement for tool result
```

This verifies provider adapters before bringing MCP complexity into the test.

## MCP cross-provider scenario

Use one stable MCP scenario from the existing agent-tool project.

The same:

```text
MCP server
tool schema
system prompt
skill set
question
```

must run against every model.

## Eval result schema

Add run metadata:

```json
{
  "provider": "zen",
  "model": "deepseek-v4-flash",
  "reasoning": "default",
  "startedAt": "...",
  "durationMs": 1234,
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0
  }
}
```

Per case, retain existing outcome fields plus:

```text
tool call count
model turn count
latency
usage
provider errors/retries
```

## Comparison output

Useful aggregate table:

```text
PROVIDER MODEL                PASS TOOL PASS AVG CALLS LATENCY TOKENS
ollama   gpt-oss:120b         88%  94%       1.9       ...     ...
zen      deepseek-v4-flash    90%  95%       1.8       ...     ...
zen      claude-sonnet-5      96%  98%       1.5       ...     ...
zen      gpt-5.6-sol          95%  98%       1.6       ...     ...
```

Do not optimize for leaderboard-looking scores. Preserve traces for failure analysis.

## Controlled experiment rule

When comparing models, do not change:

- system prompt
- skills
- exposed tools
- tool descriptions
- tool results
- context policy
- retry policy

unless the experiment intentionally measures one of those variables.

## Provider-specific prompting

Do not add hidden provider-specific system prompts merely to improve a model's score.

If provider-specific prompting is later tested, make it an explicit experiment dimension.

## Cost controls

Live eval runner should support:

```text
--max-cases
--model
--provider
```

A future `--max-cost` may be added only if accurate cost data is available.

Never silently run a large eval matrix against paid models.
