import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const records: Record<string, { summary: string; category: string }> = {
  "agent-loop": {
    summary: "The agent loop asks the model, executes requested tools in order, then continues until a final answer.",
    category: "runtime",
  },
  mcp: {
    summary: "MCP servers expose tools that agent-tool namespaces and routes through one normalized registry.",
    category: "integration",
  },
};

const server = new McpServer({ name: "agent-tool-demo", version: "0.1.0" });

server.registerTool(
  "get_demo_status",
  {
    description: "Returns the deterministic status of the agent-tool demo MCP server.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: "The agent-tool demo MCP server is ready for tool-calling tests." }],
    structuredContent: { status: "ready", server: "agent-tool-demo" },
  }),
);

server.registerTool(
  "lookup_demo_record",
  {
    description: "Looks up one deterministic demo record. Use key agent-loop or mcp.",
    inputSchema: { key: z.enum(["agent-loop", "mcp"]) },
    annotations: { readOnlyHint: true },
  },
  async ({ key }) => {
    const record = records[key];
    return {
      content: [{ type: "text", text: `${key}: ${record.summary}` }],
      structuredContent: { key, ...record },
    };
  },
);

await server.connect(new StdioServerTransport());
keepStdioServerAlive();

function keepStdioServerAlive(): void {
  const interval = setInterval(() => undefined, 60_000);
  process.stdin.once("end", () => clearInterval(interval));
}
