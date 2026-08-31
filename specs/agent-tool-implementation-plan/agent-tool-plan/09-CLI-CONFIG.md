# CLI and Configuration

## CLI Goal

Primary UX:

```bash
agent-tool "how many open work orders are in bedford"
```

Use `yargs` for argument parsing.

## Recommended Options

V1/V2:

```text
--config <file>          configuration path
--model <name>           override configured model
--prompt <name|path>     override system prompt
--skill <name>           load a skill; repeatable
--skills <mode>          none|all
--trace                   human-readable trace
--trace-json              JSON trace
--max-steps <n>          maximum model turns
--reasoning <mode>        default|off|on|low|medium|high|max
--show-thinking           with trace, show provider-exposed thinking text
--json                    emit final result as JSON
--help
--version
```

Do not add dozens of flags initially. Configuration should handle less frequently changed settings.

## Configuration Search

Recommended order:

1. explicit `--config`
2. `./agent.config.json`
3. sensible defaults

Do not search many implicit home-directory locations in V1.

## Example Configuration

```json
{
  "model": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434",
    "name": "gpt-oss:120b",
    "reasoning": {
      "mode": "effort",
      "effort": "high"
    },
    "options": {
      "temperature": 0
    }
  },
  "agent": {
    "systemPrompt": "./prompts/investigative.md",
    "maxSteps": 10
  },
  "skills": {
    "directories": ["./skills"],
    "mode": "all"
  },
  "mcpServers": {
    "maximo": {
      "transport": "stdio",
      "command": "node",
      "args": ["./servers/maximo.js"]
    }
  },
  "tools": {
    "allow": ["*"],
    "deny": []
  },
  "trace": {
    "enabled": false,
    "showThinking": false
  }
}
```

Model names are examples only and must not be hard-coded as defaults if the developer's local Ollama setup differs.

Reasoning is intentionally separate from generic `options`. Map CLI values as follows:

```text
default -> { mode: "provider-default" }
off     -> { mode: "disabled" }
on      -> { mode: "enabled" }
low..max -> { mode: "effort", effort: <value> }
```

For Ollama GPT-OSS, use effort `low`, `medium`, or `high`; do not use boolean examples. The adapter should surface incompatible configurations clearly rather than silently changing the user's request. See `12-REASONING-THINKING.md`.

## Environment Variables

Support a small number of top-level overrides only when useful, e.g.:

```text
AGENT_OLLAMA_URL
AGENT_MODEL
```

MCP server environment values can reference existing environment variables rather than storing secrets directly in JSON.

Possible convention:

```json
{
  "env": {
    "API_TOKEN": "${MAXIMO_API_TOKEN}"
  }
}
```

If implemented, missing referenced environment variables should fail fast.

## Exit Codes

Recommended:

- `0` success
- `1` runtime/model/tool failure
- `2` configuration/CLI validation error

Eval mode can use a distinct nonzero code when assertions fail.

## Output Separation

Normal mode should keep stdout clean for the answer.

Prefer diagnostics/tracing on stderr so shell usage works:

```bash
answer=$(agent-tool "...")
```

JSON output should be stable enough for scripts.
