# CLI, Configuration, and Secrets

## CLI model selection

Support explicit provider + model:

```bash
agent-tool --provider ollama --model gpt-oss:120b "question"
```

```bash
agent-tool --provider zen --model deepseek-v4-flash "question"
```

Keep current short/default invocation working:

```bash
agent-tool "question"
```

with provider/model defaults from config.

## Optional combined model reference

A future convenience form may be:

```text
--model zen/deepseek-v4-flash
```

Do not add both syntaxes in the same phase unless it remains simple.

Recommended V1: explicit `--provider` and `--model` because it is easiest to understand.

## Models command

Add:

```bash
agent-tool models
```

Default: show configured/default provider.

```bash
agent-tool models --provider zen
agent-tool models --provider ollama
```

Zen should fetch the current model list remotely.

Display protocol support status for Zen models.

## Provider info

Optional useful command:

```bash
agent-tool model-info --provider zen --model gpt-5.6-sol
```

Output may include:

```text
Provider: zen
Model: gpt-5.6-sol
Protocol: openai-responses
Tools: supported/unknown
Reasoning: supported/unknown
```

Do not block Zen V1 on this command.

## Configuration

Example:

```json
{
  "model": {
    "provider": "ollama",
    "name": "gpt-oss:120b",
    "reasoning": {
      "effort": "high"
    }
  },
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    },
    "zen": {
      "baseUrl": "https://opencode.ai/zen/v1",
      "apiKeyEnv": "OPENCODE_ZEN_API_KEY",
      "modelRoutes": {}
    }
  }
}
```

## Precedence

Use predictable precedence:

```text
CLI flags
  > environment where explicitly defined
  > agent.config.json
  > built-in defaults
```

API key is an exception: it should come from environment, not checked-in config.

## Secrets

Preferred setup:

```bash
export OPENCODE_ZEN_API_KEY='...'
```

Potential `.env` support is optional. If added:

- `.env` must be gitignored
- never print values
- do not automatically create `.env` containing secrets

## Missing API key behavior

Fail before making a request:

```text
Zen provider requires OPENCODE_ZEN_API_KEY.
Create an OpenCode Zen API key and set the environment variable.
```

## Trace redaction

Central redaction rules must cover:

```text
Authorization
apiKey
api_key
OPENCODE_ZEN_API_KEY
Bearer tokens
```

Unit-test redaction.

## Provider selection in eval files

Eval cases should normally be provider-independent.

Runner selection should be external:

```bash
agent-eval evals/work-orders.json --provider zen --model deepseek-v4-flash
```

Do not duplicate the same test cases into separate files per model.
