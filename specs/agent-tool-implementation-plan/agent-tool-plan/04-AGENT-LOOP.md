# Core Agent Loop

This is the most important code in the project. Keep it compact, explicit, and heavily tested.

## Inputs

A run receives:

- user prompt
- system prompt
- loaded skill instructions
- normalized available tools
- model provider
- reasoning configuration
- model options
- maximum steps
- tracer

## Initial Message Construction

Conceptually:

```text
SYSTEM
  base system prompt
  + loaded skill instructions

USER
  user's prompt
```

Do not rewrite the user's request before sending it unless a later experiment specifically introduces such a stage.

## Loop

Pseudocode:

```ts
messages = buildInitialMessages(...)

for step in 1..maxSteps:
    trace(model request)

    response = await model.chat({
        messages,
        tools: toolRegistry.definitions()
    })

    trace(model response)

    append the complete normalized assistant message to messages
    (content + tool calls + provider-exposed reasoning/state when present)

    if response has no tool calls:
        return final response

    for each tool call:
        validate tool name exists
        execute tool
        append tool result message
        trace execution

throw StepLimitExceeded
```

## Multiple Tool Calls

If the model returns multiple tool calls in one assistant turn, execute all of them in the order returned for V1.

Do not parallelize initially. Sequential execution gives clearer traces and avoids hidden ordering problems.

Parallel execution can be a later experiment for explicitly independent read-only tools.

## Tool Errors

A tool failure normally becomes a tool result rather than immediately terminating the run.

The model should be able to observe errors and choose another action.

Normalize errors to a predictable structure, for example:

```json
{
  "ok": false,
  "error": {
    "type": "ToolExecutionError",
    "message": "..."
  }
}
```

Do not expose secrets, environment variables, stack traces, or credentials to the model.

## Tool Result Size

Initially return complete tool results up to a configurable size threshold.

Add explicit truncation metadata if a result is shortened:

```json
{
  "truncated": true,
  "originalBytes": 245000,
  "content": "..."
}
```

Do not silently truncate.

Later experiments may introduce summarization or pagination.

## Final Answer

A response with no tool calls is considered final.

The agent runtime should not automatically invoke another "review" model call in V1.

## Step Limit

Default: 10 model turns.

If reached:

- mark run as failed
- report the step count
- preserve trace
- do not silently return the last partial assistant message as a successful answer

## Cancellation and Shutdown

Handle SIGINT/SIGTERM so that:

- active MCP clients are closed
- child stdio MCP processes are terminated
- trace output is flushed

## Reasoning/Thinking Preservation Without Dependency

The implementation must not require reasoning text for runtime correctness.

However, if a provider exposes reasoning/state as part of an assistant turn, preserve the complete normalized assistant message before appending tool results. This is important for provider-correct multi-turn tool use.

The runtime must **not** do this:

```ts
if (response.reasoning?.text?.includes("call another tool")) {
  // ...
}
```

It must react only to structured outputs such as `toolCalls` or the absence of tool calls.

Agent behavior should primarily be understood through:

- messages sent
- configured reasoning mode/effort
- tools available
- tool calls selected
- arguments selected
- tool results
- final outputs

Provider-exposed thinking is optional diagnostic data. Normal traces should record presence/size but hide text unless an explicit debug option enables it.

See `12-REASONING-THINKING.md`.
