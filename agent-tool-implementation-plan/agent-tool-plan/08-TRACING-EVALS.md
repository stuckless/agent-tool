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

Do not print private model reasoning or require reasoning traces.

## JSON Trace

`--trace-json` should emit structured JSON suitable for later analysis.

Suggested run data:

```text
runId
startedAt
completedAt
durationMs
model
modelOptions
systemPromptName
systemPromptHash
skills[]
tools[]
steps[]
finalAnswer
usage
status
error
```

Each step should include observable events only.

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
frontier + same agent    93%        97%          1.5
```

The exact reporting format can evolve after JSON result storage works.

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
