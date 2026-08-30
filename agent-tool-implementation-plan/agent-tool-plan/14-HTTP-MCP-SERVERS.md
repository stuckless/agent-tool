# HTTP MCP Servers

## Status

Planned after the stdio-only Phase 3 implementation. This document specifies the next MCP transport increment; it does not authorize HTTP transport implementation by itself.

## Goal

Add support for remote MCP servers using the current Streamable HTTP transport while preserving the existing normalized tool contract:

```text
HTTP MCP server
  -> MCP SDK StreamableHTTPClientTransport
  -> MCP adapter
  -> Tool registry
  -> Agent loop
```

Stdio and HTTP servers must coexist in one `mcpServers` configuration. Their tools continue to be registered as `serverName.toolName` and are subject to the existing allow/deny policy.

## Configuration

Use a discriminated transport configuration. Keep process-only fields (`command`, `args`, `env`) exclusive to `stdio`.

```json
{
  "mcpServers": {
    "local-demo": {
      "transport": "stdio",
      "command": "node",
      "args": ["./dist/mcp/demo-server.js"],
      "env": {
        "DEMO_LABEL": "local"
      }
    },
    "knowledge": {
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": {
          "env": "KNOWLEDGE_MCP_TOKEN",
          "prefix": "Bearer "
        }
      }
    }
  }
}
```

For HTTP servers, `headers` are client request headers. The runtime environment is not sent to the remote server. Header values should be either a fixed non-secret string or an explicit environment reference:

```json
{ "env": "VARIABLE_NAME", "prefix": "optional text" }
```

Resolve references at startup, fail fast for an unset variable, and never include the resolved value in traces, tool results, or thrown error messages. Do not introduce unrestricted `${VARIABLE}` interpolation for all configuration strings in this increment.

## Implementation Steps

1. Change `McpStdioServerConfig` to an `McpServerConfig` discriminated union.
2. Validate `streamable-http` URLs and header definitions with Zod.
3. Resolve HTTP header environment references in the configuration layer using the injected test environment.
4. Add an HTTP MCP client implementation backed by the SDK's `StreamableHTTPClientTransport`.
5. Keep `McpClient`, tool normalization, registration, policy checks, and result conversion transport-neutral.
6. Close Streamable HTTP transports with the same manager lifecycle already used for stdio clients.
7. Surface connection failures without URLs containing credentials or resolved header values.

## Authentication and Security

- Prefer standards-based MCP/OAuth support when a server requires interactive authorization; do not treat a static bearer token as a substitute for OAuth.
- Keep bearer-token headers as a pragmatic non-interactive option for services that document them.
- Do not support credentials in the URL userinfo component.
- Do not log request headers, resolved environment values, or SDK authorization state in normal trace output.
- Keep deny rules higher priority than allow rules for every transport.

## Compatibility

Use Streamable HTTP for new connections. The legacy SSE transport may be added only when a specific required server cannot use Streamable HTTP, because the SDK marks its SSE client transport deprecated.

## Tests and Acceptance

Normal tests must use a local in-process HTTP MCP server or an SDK-compatible local test transport; they must not contact the network. Cover:

- mixed stdio and Streamable HTTP configuration
- header environment-reference resolution and missing-variable failures
- no secret values in error or trace data
- discovery, namespacing, allow/deny filtering, call routing, result normalization, and cleanup
- an agent model -> HTTP MCP tool -> final answer sequence using fakes for the model

Manual acceptance should use a local HTTP MCP server plus a live tool-calling model. It should prove tool discovery and one successful call, then confirm that a configured secret header is accepted without appearing in output.
