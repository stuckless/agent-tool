import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/agent.js";
import type { AgentTraceEvent } from "../src/agent/types.js";
import type { McpStdioServerConfig } from "../src/config.js";
import { McpManager, isToolAllowed, type McpClient, type McpClientFactory, type McpListedTool, type McpToolCallResult } from "../src/mcp/manager.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/model/types.js";
import { ToolRegistry } from "../src/tools/registry.js";

class FakeMcpClient implements McpClient {
  connected = false;
  closed = false;
  readonly calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];

  constructor(
    private readonly tools: McpListedTool[],
    private readonly result: McpToolCallResult,
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async listTools(): Promise<McpListedTool[]> {
    return this.tools;
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpToolCallResult> {
    this.calls.push({ name, arguments_ });
    return this.result;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeMcpClientFactory implements McpClientFactory {
  constructor(readonly clients: Record<string, FakeMcpClient>) {}

  create(serverName: string, _config: McpStdioServerConfig): McpClient {
    const client = this.clients[serverName];
    if (!client) {
      throw new Error(`No fake client for ${serverName}.`);
    }
    return client;
  }
}

class FakeModel implements ModelProvider {
  readonly id = "ollama" as const;
  constructor(private readonly responses: ModelResponse[]) {}

  async generate(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses.shift();
    if (!response) {
      throw new Error("Fake model ran out of responses.");
    }
    return response;
  }
}

describe("McpManager", () => {
  it("connects, namespaces discovered tools, and routes execution to the originating client", async () => {
    const weather = new FakeMcpClient(
      [{ name: "forecast", description: "Get a forecast.", inputSchema: { type: "object", properties: { city: { type: "string" } } }, annotations: { readOnlyHint: true } }],
      { content: [{ type: "text", text: "Sunny" }], structuredContent: { temperatureC: 23 } },
    );
    const calendar = new FakeMcpClient(
      [{ name: "forecast", description: "Get a calendar forecast.", inputSchema: { type: "object" } }],
      { content: [{ type: "text", text: "Busy" }] },
    );
    const manager = new McpManager(
      {
        weather: { transport: "stdio", command: "fake" },
        calendar: { transport: "stdio", command: "fake" },
      },
      new FakeMcpClientFactory({ weather, calendar }),
    );
    const registry = new ToolRegistry();

    await manager.connectAndRegister(registry);

    expect(registry.definitions()).toEqual([
      { name: "weather.forecast", description: "Get a forecast.", inputSchema: { type: "object", properties: { city: { type: "string" } } } },
      { name: "calendar.forecast", description: "Get a calendar forecast.", inputSchema: { type: "object" } },
    ]);
    await expect(registry.get("weather.forecast")?.execute({ city: "Toronto" })).resolves.toEqual({
      ok: true,
      content: [{ type: "text", text: "Sunny" }],
      structuredContent: { temperatureC: 23 },
    });
    expect(weather.calls).toEqual([{ name: "forecast", arguments_: { city: "Toronto" } }]);
    expect(calendar.calls).toEqual([]);
    expect((registry.get("weather.forecast") as { mcp: unknown }).mcp).toEqual({
      serverName: "weather",
      originalName: "forecast",
      annotations: { readOnlyHint: true },
    });

    await manager.close();
    expect(weather.closed).toBe(true);
    expect(calendar.closed).toBe(true);
  });

  it("closes already-connected clients when discovery fails", async () => {
    const invalid = new FakeMcpClient([{ name: "bad", inputSchema: { type: "string" } }], { content: [] });
    const manager = new McpManager(
      { invalid: { transport: "stdio", command: "fake" } },
      new FakeMcpClientFactory({ invalid }),
    );

    await expect(manager.connectAndRegister(new ToolRegistry())).rejects.toThrow("must have an object input schema");
    expect(invalid.closed).toBe(true);
  });

  it("lets the agent answer through a namespaced MCP tool and traces that call", async () => {
    const weather = new FakeMcpClient(
      [{ name: "forecast", description: "Get a forecast.", inputSchema: { type: "object" } }],
      { content: [{ type: "text", text: "Sunny" }] },
    );
    const manager = new McpManager(
      { weather: { transport: "stdio", command: "fake" } },
      new FakeMcpClientFactory({ weather }),
    );
    const registry = new ToolRegistry();
    await manager.connectAndRegister(registry);
    const events: AgentTraceEvent[] = [];
    const agent = new Agent({
      model: new FakeModel([
        { message: { role: "assistant", content: "", toolCalls: [{ id: "forecast-1", name: "weather.forecast", arguments: {} }] } },
        { message: { role: "assistant", content: "The forecast is sunny." } },
      ]),
      tools: registry,
      systemPrompt: "Use the weather tool.",
      reasoning: { mode: "provider-default" },
      modelOptions: {},
      tracer: { trace(event) { events.push(event); } },
    });

    await expect(agent.run("What is the forecast?")).resolves.toMatchObject({ answer: "The forecast is sunny." });
    expect(weather.calls).toEqual([{ name: "forecast", arguments_: {} }]);
    expect(events).toContainEqual({
      type: "tool.call",
      step: 1,
      toolCall: { id: "forecast-1", name: "weather.forecast", arguments: {} },
    });
    await manager.close();
  });

  it("filters discovered MCP tools with allow and deny patterns", async () => {
    const admin = new FakeMcpClient(
      [
        { name: "read", inputSchema: { type: "object" } },
        { name: "delete", inputSchema: { type: "object" } },
      ],
      { content: [] },
    );
    const registry = new ToolRegistry();
    const manager = new McpManager(
      { admin: { transport: "stdio", command: "fake" } },
      new FakeMcpClientFactory({ admin }),
      { allow: ["admin.*"], deny: ["*.delete"] },
    );

    await manager.connectAndRegister(registry);
    expect(registry.definitions().map((tool) => tool.name)).toEqual(["admin.read"]);
    expect(isToolAllowed("admin.delete", { allow: ["*"], deny: ["*.delete"] })).toBe(false);
    await manager.close();
  });
});
