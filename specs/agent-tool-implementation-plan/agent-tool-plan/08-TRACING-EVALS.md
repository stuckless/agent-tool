# Tracing and Evaluations

## Why This Matters

The project exists partly to determine whether poor assistant behavior comes from:

- model capability
- system prompt
- tool descriptions
- skill guidance
- context construction
- tool selection
- stopping too early
- result interpretation

Without traces and repeatable evals, those become subjective debates.

## Human Trace

`--trace` should show concise events.

Example:

```text
Run
  model: gpt-oss:120b
  prompt: investigative
  skills: work-orders
  tools: 8
  reasoning: high
  thinking exposed: yes (text hidden)

Step 1
  model → tool call
  tool: maximo.workorders_count
  args: { location: "BEDFORD", status: [...] }

  tool → success
  duration: 122 ms
  result: { count: 47 }

Step 2
  model → final answer

There are 47 open work orders in Bedford.
```

Do not require reasoning traces for correctness. Provider-exposed thinking text is hidden by default. An explicit `--show-thinking` debug flag may display reasoning text returned by the provider, but it must not alter agent behavior.

Normal traces should record the configured reasoning mode and, when available, whether thinking was exposed plus its size/token metadata.

## JSON Trace

`--trace-json` should emit structured JSON suitable for later analysis.

Suggested run data:

```text
runId
startedAt
completedAt
durationMs
model
reasoningConfig
modelOptions
systemPromptName
systemPromptHash
skills[]
tools[]
steps[]
finalAnswer
usage
reasoningMetadata
status
error
```

Each step should include observable events. Reasoning text is omitted by default; metadata such as `exposed`, character count, or provider-supplied reasoning token counts may be retained.

## Tool Trace

For each call record:

- normalized tool name
- source MCP server
- arguments, with redaction support
- started/completed timestamps
- duration
- success/failure
- result size
- optionally a bounded result preview

## Explicit Thinking Trace

Support an opt-in debug mode such as:

```bash
agent-tool --trace --show-thinking "..."
```

Only print text the provider actually exposes. Never fabricate or infer hidden reasoning. Apply the same redaction controls used for other trace content. JSON traces should omit reasoning text unless explicitly enabled.

## Redaction

Add a central redaction utility before the framework is used with real credentials/data.

At minimum redact configured secret field names and environment values.

Do not scatter ad-hoc redaction through log statements.

## Eval Dataset

Start with JSON:

```json
[
  {
    "id": "count-open-workorders-bedford",
    "prompt": "how many open work orders are in bedford",
    "expect": {
      "requiredTools": ["maximo.workorders_count"],
      "forbiddenTools": [],
      "maxToolCalls": 3,
      "outputIncludes": ["Bedford"]
    }
  }
]
```

Keep assertions objective where possible.

## Eval Assertions

V1 assertions:

- completed successfully
- required tool called
- forbidden tool not called
- tool call count <= threshold
- final output contains expected stable value/text
- no tool error

Later:

- exact argument assertions
- JSONPath-like result assertions
- latency thresholds
- token thresholds
- reasoning configuration assertions/filters
- provider-supplied reasoning token/count metrics when available
- custom JS validators
- human scoring
- optional LLM-as-judge

## Comparison Matrix

The eval runner should make it possible to build comparisons like:

```text
                       Success  Correct Tool  Avg Calls
oss + minimal            62%        71%          2.7
oss + investigative      79%        88%          2.2
oss + skill              86%        94%          1.8
oss/high + skill          90%        96%          1.7
frontier + same agent    93%        97%          1.5
```

The exact reporting format can evolve after JSON result storage works.

Reasoning configuration must be treated as a controlled comparison dimension. For example, run the same GPT-OSS eval set at low, medium, and high effort, then compare quality, tool-call count, latency, and token usage.

## Repetition

Model outputs are not perfectly deterministic.

Later support:

```bash
agent-tool eval --runs 5 evals/work-orders.json
```

Report:

- pass rate
- median latency
- average tool calls
- variance where useful

Do not hide flaky behavior by reporting only the best run.

## Failure Classification

Consider adding manual or rule-based labels:

- wrong tool
- bad tool arguments
- stopped too early
- unnecessary tool calls
- ignored skill
- tool error recovery failure
- correct evidence / bad synthesis
- hallucinated without tool
- context overflow/truncation

This is likely to be more useful than a single overall score.
