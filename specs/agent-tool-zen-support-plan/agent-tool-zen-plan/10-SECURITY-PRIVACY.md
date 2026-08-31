# Security and Privacy for Hosted Models

## Why this matters

Adding Zen changes the trust boundary.

With Ollama:

```text
prompt + tool results -> local inference host
```

With Zen:

```text
prompt + selected context + skill content + MCP tool results -> external hosted service
```

For a work-oriented agent experiment this difference must be explicit.

## Do not treat Zen as equivalent to local Ollama

Provider selection should be visible in trace/header output.

Suggested normal verbose output:

```text
Provider: zen
Model: claude-sonnet-5
Hosted inference: yes
```

## Secret handling

Never send or log:

- Zen API key
- MCP credentials
- database passwords
- bearer tokens
- session cookies
- raw environment variables

Tool results may themselves contain sensitive business data; this cannot be solved only by header redaction.

## Optional hosted-provider guard

Recommended config:

```json
{
  "security": {
    "allowHostedModels": true
  }
}
```

For a reusable work tool, consider defaulting this to `false` only if that aligns with the existing project UX. Do not introduce a disruptive default silently into an existing experiment.

A simpler V1 may rely on explicit `--provider zen` plus documentation.

## Data classification

The framework should not attempt to automatically classify corporate data in V1.

Document that users must only send data to Zen that their organization permits to be processed externally.

## Free/experimental Zen models

Zen documentation notes that privacy/retention conditions can differ for some free or contributor models. Therefore the project should avoid assuming all Zen models share identical retention/training policies.

Do not encode a hardcoded privacy promise in CLI output.

Potential future model metadata:

```text
external=true
privacyPolicyUrl
trainingUse=unknown/allowed/not-allowed
retention=unknown
```

But this is out of scope for V1 unless reliably exposed by an API.

## MCP tool boundary

The model sees the tool schema before it calls the tool.

After a tool executes, the model generally sees the returned tool result.

Therefore a hosted model can receive enterprise data returned by MCP tools.

This should be documented prominently because the MCP server itself may be internal while the model is external.

## Trace files

Trace files can contain:

- prompts
- tool arguments
- tool results
- model answers

They may be more sensitive than the model request itself.

Keep existing trace controls and ensure `.gitignore` covers generated traces if they are written to disk.

## Provider documentation reference

Zen's privacy terms and model exceptions can change. Link users to current Zen documentation rather than copying a permanent policy statement into the codebase.
