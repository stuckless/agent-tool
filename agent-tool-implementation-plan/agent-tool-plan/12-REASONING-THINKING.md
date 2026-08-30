# Reasoning and Thinking Models

## Why This Is a First-Class Concern

Reasoning is not just a model-quality characteristic. With some model providers it also changes the request shape, the response shape, the content that must be preserved between tool turns, trace behavior, latency, token usage, and how evals should be interpreted.

The framework must therefore model reasoning explicitly rather than burying it inside an untyped `options` object.

At the same time, **the agent runtime must never depend on reasoning text to decide what to do next**. Runtime control flow is based on structured outputs such as tool calls and final assistant content.

## Three Separate Concepts

Keep these concepts distinct.

### 1. Reasoning capability

A model may be capable of a dedicated reasoning/thinking mode.

Examples in Ollama include GPT-OSS, Qwen 3, DeepSeek R1, and other thinking-capable models.

This is a model/provider capability.

### 2. Reasoning configuration

A request may ask the provider/model to spend more or less effort reasoning.

Ollama currently supports a top-level `think` field on chat/generate requests. Depending on the model, it can accept a boolean or a level such as `low`, `medium`, `high`, or `max`.

GPT-OSS is a special case in Ollama: it expects `low`, `medium`, or `high`; boolean `true`/`false` is not the appropriate control for that model.

This is an inference configuration choice and should be included in controlled eval comparisons.

### 3. Reasoning trace

Some providers expose reasoning separately from the user-facing answer.

For Ollama chat responses:

```text
message.thinking  -> provider-exposed reasoning trace
message.content   -> final/user-facing assistant content
```

This exposed trace can be useful for local debugging and learning, but it is **diagnostic information**, not an agent control interface.

## Normalized Configuration

Do not force the rest of the runtime to know Ollama's `think` syntax.

Use a provider-neutral configuration shape similar to:

```ts
type ReasoningConfig =
  | { mode: "provider-default" }
  | { mode: "disabled" }
  | { mode: "enabled" }
  | {
      mode: "effort";
      effort: "low" | "medium" | "high" | "max";
    };
```

The Ollama adapter translates this to its request representation:

```text
provider-default -> omit `think`
disabled         -> think: false
enabled          -> think: true
effort           -> think: <configured level>
```

Do not maintain a large hard-coded catalog of model capabilities in V1. If a configured model does not support a chosen reasoning mode, surface a clear provider/configuration error where possible.

For GPT-OSS configurations, documentation/examples should use:

```json
{
  "reasoning": {
    "mode": "effort",
    "effort": "high"
  }
}
```

Do not use `enabled`/`disabled` examples for GPT-OSS.

## Model Request and Response Contracts

The provider-neutral model request should carry reasoning configuration separately from generic model options:

```ts
interface ModelRequest {
  messages: ModelMessage[];
  tools: ModelToolDefinition[];
  reasoning?: ReasoningConfig;
  options?: Record<string, unknown>;
}
```

The normalized assistant response/message should be able to preserve provider-exposed reasoning:

```ts
interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ModelToolCall[];
  reasoning?: {
    text?: string;
    metadata?: Record<string, unknown>;
  };
}
```

The exact type names may differ, but preserve these semantics.

The agent runtime may pass the reasoning payload back to the same provider on a later model turn, but it must treat the payload as opaque. Agent logic must not parse it for instructions.

## Critical Tool-Loop Requirement

When a model returns an assistant message containing both thinking and tool calls, append/preserve the **complete normalized assistant message** before appending tool results.

Conceptually:

```text
USER
  question

ASSISTANT
  reasoning (if provider exposed it)
  tool call(s)

TOOL
  result

ASSISTANT
  reasoning (if exposed)
  final content or another tool call
```

Do not reduce the assistant turn to only its tool calls if doing so would discard provider state needed for the next turn.

The provider adapter is responsible for serializing the normalized message back into the provider-specific request format.

This requirement matters even though runtime decisions do not inspect the reasoning text.

## Streaming

Streaming is deferred unless needed during implementation, but the design must not preclude it.

For Ollama thinking models, streamed chunks can contain reasoning before final content. A future streaming adapter must accumulate:

- thinking chunks
- content chunks
- tool calls

into one normalized assistant message before that message is persisted into conversation state.

Do not implement streaming merely to display thinking in V1.

## Trace Policy

Reasoning text should be **off by default** in traces.

Normal human trace may show metadata such as:

```text
reasoning: high
thinking exposed: yes
thinking chars: 1842
```

without printing the text.

Provide an explicit debugging option such as:

```bash
agent-tool --trace --show-thinking "..."
```

When enabled, print provider-exposed reasoning only if the provider actually returned it.

Rules:

- never claim hidden reasoning can be displayed
- never synthesize fake reasoning for providers that do not expose it
- do not make `--show-thinking` change agent behavior
- do not log thinking text by default in JSON traces
- apply normal trace redaction policies
- document that reasoning text may contain user/tool data and should not be persisted casually

A useful JSON trace default is:

```json
{
  "reasoning": {
    "configured": "high",
    "exposed": true,
    "characters": 1842
  }
}
```

Only include `text` when an explicit trace option enables it.

## CLI Configuration

Support a compact override such as:

```bash
agent-tool --reasoning default "..."
agent-tool --reasoning off "..."
agent-tool --reasoning on "..."
agent-tool --reasoning low "..."
agent-tool --reasoning medium "..."
agent-tool --reasoning high "..."
agent-tool --reasoning max "..."
```

Mapping:

```text
default -> provider-default
off     -> disabled
on      -> enabled
low..max -> effort
```

The CLI should explain provider/model incompatibility rather than silently changing a requested setting.

## Evaluation Requirements

Reasoning configuration is an eval dimension, just like model, prompt, skills, and tools.

A useful comparison might be:

```text
gpt-oss:120b / low
gpt-oss:120b / medium
gpt-oss:120b / high
qwen3 / reasoning enabled
qwen3 / reasoning disabled
```

Measure at least:

- successful completion rate
- expected/correct tool selection
- argument correctness where asserted
- average tool calls
- model turns
- latency
- input/output token usage when available
- reasoning token/count metadata when the provider exposes it

The goal is to answer questions such as:

- Does high reasoning materially improve tool choice?
- Does it reduce unnecessary tool calls?
- Does it improve recovery from incomplete tool results?
- Is the quality gain worth the latency/token cost?
- Is an apparent "model problem" actually an inference-configuration problem?

Do not score the quality of the reasoning text itself in V1. Score observable behavior and final outcomes.

## Prompting Guidance

Do not put instructions such as these in system prompts:

```text
Show your chain of thought.
Write out every reasoning step.
Think aloud before calling tools.
```

Reasoning mode is a model/provider setting, not a substitute for good agent guidance.

System prompts should continue to specify observable behavior:

- use authoritative tools
- inspect results
- continue when evidence is incomplete
- follow loaded skills
- do not fabricate retrievable facts

This keeps prompt experiments comparable across models that expose reasoning and models that do not.

## Separation of Responsibilities

Keep this mental model:

```text
                    reasoning inside inference
                              |
User -> Agent -> Model decides what it wants to do
                    |
                    +--> structured tool call
                              |
                    Agent executes allowed tool
                              |
                              v
                          tool result
                              |
                              v
                    Model reasons again
                              |
                              v
                         final answer
```

The model's reasoning influences its choice.

The agent runtime controls:

- what context the model receives
- which tools are available
- which tool calls are allowed
- tool execution
- how results are returned
- loop limits
- trace/eval capture

Thinking does not replace agent orchestration.

## V1 Acceptance Criteria

Reasoning support is complete for V1 when:

1. reasoning is represented explicitly in config/types
2. Ollama maps the generic setting to `think`
3. Ollama `message.thinking` is normalized when present
4. assistant reasoning/state survives a tool-call round trip
5. agent behavior does not inspect reasoning text
6. normal trace hides reasoning text
7. explicit `--show-thinking` displays provider-exposed text for debugging
8. eval results record the reasoning configuration used
9. the same eval can be run under multiple reasoning settings
10. tests cover enabled/disabled/effort configuration and tool-loop preservation

## References

Verified against Ollama documentation on 2026-08-30:

- https://docs.ollama.com/capabilities/thinking
- https://docs.ollama.com/capabilities/tool-calling
