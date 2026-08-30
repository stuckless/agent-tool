# MCP and Tool Integration

## Goal

Treat MCP as one tool provider rather than as the agent runtime itself.

```text
MCP Server
   ↓
MCP SDK Client
   ↓
MCP Adapter
   ↓
AgentTool
   ↓
Tool Registry
   ↓
Agent
```

## SDK

Use the official npm package:

```text
@modelcontextprotocol/sdk
```

Do not implement the MCP protocol manually.

## MCP Server Configuration

Recommended V1 shape:

```json
{
  "mcpServers": {
    "maximo": {
      "transport": "stdio",
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "EXAMPLE_SETTING": "value"
      }
    }
  }
}
```

Environment-variable substitution may be supported for secrets, but never print resolved secret values in traces.

Later HTTP example:

```json
{
  "mcpServers": {
    "knowledge": {
      "transport": "streamable-http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

## Discovery

On startup or first use:

1. connect to server
2. request tool list
3. validate name/description/input schema
4. normalize tools
5. register source metadata

Trace the discovered tool names, but avoid dumping enormous schemas unless verbose tracing is explicitly requested.

## Tool Names

MCP servers can expose colliding names.

Recommended normalized naming:

```text
<server>.<tool>
```

Example:

```text
maximo.workorders_count
maximo.workorders_search
```

A future alias feature can shorten names, but explicit namespacing is safer for early experiments.

## Tool Descriptions Matter

Do not discard or aggressively shorten descriptions received from MCP.

Tool descriptions are part of the agent's behavioral environment and can materially affect tool-selection quality.

Trace enough metadata to compare:

- original MCP name
- normalized name
- description length
- source server

This allows later experiments with improved descriptions without modifying the MCP server.

## Tool Definition Normalization

Internal definition should preserve:

- name
- description
- JSON input schema
- MCP annotations when present
- source server

Annotations such as read-only/destructive hints may later inform execution policy, but should be treated as hints rather than a hard security boundary.

## Execution

When the model requests:

```text
maximo.workorders_count
```

The registry:

1. validates the tool exists
2. validates/forwards arguments
3. invokes the originating MCP client
4. normalizes returned MCP content into a model-safe result
5. traces outcome

Preserve text and structured content where possible.

## Result Conversion

Create one canonical tool result representation regardless of MCP result content type.

Possible shape:

```ts
interface ToolExecutionResult {
  ok: boolean;
  content: unknown;
  metadata?: Record<string, unknown>;
}
```

When passing to the model, serialize deterministically and clearly.

## Connection Lifecycle

MCP manager should:

- lazily or eagerly connect based on simple config
- reuse clients during one process invocation
- close all clients on normal shutdown
- terminate stdio child processes on interrupt/error

## Tool Policy

Add simple configuration even if V1 defaults to permissive behavior in a test environment:

```json
{
  "tools": {
    "allow": ["maximo.*"],
    "deny": []
  }
}
```

Before using the framework with write-capable enterprise MCP tools, add an explicit safe policy for mutating/destructive calls.
