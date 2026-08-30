import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "agent-tool-test-server", version: "0.1.0" });

server.registerTool(
  "get_test_value",
  {
    description: "Returns a deterministic value for the stdio MCP integration test.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: "stdio-mcp-test-value" }],
  }),
);

await server.connect(new StdioServerTransport());
const interval = setInterval(() => undefined, 60_000);
process.stdin.once("end", () => clearInterval(interval));
