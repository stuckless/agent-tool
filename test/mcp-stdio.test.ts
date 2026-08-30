import { describe, expect, it } from "vitest";

import { McpManager } from "../src/mcp/manager.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("stdio MCP integration", () => {
  const runStdioTest = process.env.AGENT_TEST_STDIO === "1" ? it : it.skip;

  runStdioTest("discovers and invokes the real local test server", async () => {
    const manager = new McpManager({
      demo: {
        transport: "stdio",
        command: process.execPath,
        args: ["test/fixtures/stdio-mcp-server.mjs"],
      },
    });
    const registry = new ToolRegistry();

    try {
      await manager.connectAndRegister(registry);
      expect(registry.definitions().map((tool) => tool.name)).toEqual([
        "demo.get_test_value",
      ]);
      await expect(registry.get("demo.get_test_value")?.execute({})).resolves.toMatchObject({
        ok: true,
        content: [{ type: "text", text: "stdio-mcp-test-value" }],
      });
    } finally {
      await manager.close();
    }
  });
});
