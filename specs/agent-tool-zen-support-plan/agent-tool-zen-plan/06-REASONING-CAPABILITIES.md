# Reasoning and Capability Normalization

## Goal

Preserve the distinction established in the base `agent-tool` plan:

1. model reasoning capability
2. requested reasoning effort
3. provider-exposed reasoning/thinking text or state

Zen support must not collapse these into one provider-specific option.

## User-facing configuration

Continue to support normalized reasoning configuration:

```json
{
  "reasoning": {
    "effort": "high"
  }
}
```

or CLI:

```text
--reasoning high
```

## Provider mapping

Each adapter maps normalized reasoning to its protocol/model options.

Examples conceptually:

```text
Ollama gpt-oss       high -> Ollama think="high"
Zen GPT model        high -> OpenAI-compatible reasoning option
Zen Claude model     high -> adapter-specific thinking/reasoning configuration if supported
Zen DeepSeek model   high -> supported option if Zen/model supports it; otherwise fail clearly
```

Do not invent provider parameters from model names.

## Capabilities are not universal

A model descriptor may say:

```ts
{
  reasoning: true,
  reasoningLevels: ['low', 'medium', 'high']
}
```

or:

```ts
{
  reasoning: false
}
```

or capability may be unknown.

Unknown is different from false.

## Explicit request behavior

If the user runs:

```text
agent-tool --provider zen --model X --reasoning high "..."
```

and model X is known not to support that option, fail with a clear message rather than silently dropping it.

If capability is unknown, adapter behavior may attempt the documented provider mechanism but must surface a useful provider error.

## Continuation state

Some protocols may require reasoning/response state to be replayed across tool calls.

Treat this as opaque state on the normalized assistant message:

```text
agent does not inspect it
trace does not dump it by default
adapter can consume it on the next invocation
```

This is analogous to preserving Ollama thinking state without using it as control logic.

## Trace policy

Default trace:

```text
reasoning requested: high
reasoning supported: true/false/unknown
reasoning metadata present: true/false
```

Provider reasoning text is displayed only when the existing explicit opt-in (`--show-thinking` or equivalent) permits it and the provider exposes it.

Do not assume hosted providers expose private chain-of-thought.

## Eval dimensions

Extend eval matrices to include:

```text
provider
model
reasoning mode/effort
```

Example matrix:

```text
ollama / gpt-oss:120b / low
ollama / gpt-oss:120b / high
zen / deepseek-v4-flash / default
zen / claude-sonnet-5 / default
zen / gpt-5.6-sol / low
zen / gpt-5.6-sol / high
```

Only compare reasoning settings supported by the selected model.

## Record costs/usage separately from quality

Hosted models introduce cost.

Eval output should track:

```text
input tokens
output tokens
cached tokens if reported
request count
latency
estimated cost (optional, only if reliable pricing metadata exists)
```

Do not hardcode pricing into core agent logic.
