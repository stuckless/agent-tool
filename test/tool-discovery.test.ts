import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/agent.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/model/types.js";
import { createMcpAgentTool, type McpClient } from "../src/mcp/manager.js";
import { createLoadSkillTool } from "../src/skills/runtime.js";
import { TraceRecorder } from "../src/trace/trace.js";
import { RuntimeToolCatalog } from "../src/tools/catalog.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSearchToolsTool } from "../src/tools/runtime.js";
import { createTestTools } from "../src/tools/test-tools.js";

class FakeModel implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly responses: ModelResponse[]) {}
  async chat(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const response = this.responses.shift();
    if (!response) throw new Error("Fake model ran out of responses.");
    return response;
  }
}

function searchableCatalog(registry: ToolRegistry, initialAllow: string[] = []): RuntimeToolCatalog {
  const catalog = new RuntimeToolCatalog(registry, { mode: "search", initialAllow });
  registry.register(createSearchToolsTool(catalog));
  return catalog;
}

function options(model: FakeModel, tools: ToolRegistry | RuntimeToolCatalog) {
  return { model, tools, systemPrompt: "Use tools.", reasoning: { mode: "provider-default" } as const, modelOptions: {} };
}

describe("dynamic tool discovery", () => {
  it("keeps the current all-tools behavior by default", async () => {
    const model = new FakeModel([{ message: { role: "assistant", content: "Done." } }]);
    await new Agent(options(model, new ToolRegistry(createTestTools()))).run("Answer.");
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "get_current_test_value"]);
  });

  it("sends only the filtered initial context plus runtime search", async () => {
    const registry = new ToolRegistry(createTestTools());
    const catalog = searchableCatalog(registry, ["echo"]);
    const model = new FakeModel([{ message: { role: "assistant", content: "Done." } }]);
    await new Agent(options(model, catalog)).run("Answer.");
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "runtime.search_tools"]);
  });

  it("discovers a needed tool, makes it visible on the next turn, then calls it", async () => {
    const registry = new ToolRegistry(createTestTools("bluebird"));
    const catalog = searchableCatalog(registry);
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "search", name: "runtime.search_tools", arguments: { query: "current test value" } }] } },
      { message: { role: "assistant", content: "", toolCalls: [{ id: "value", name: "get_current_test_value", arguments: {} }] } },
      { message: { role: "assistant", content: "The value is bluebird." } },
    ]);
    await expect(new Agent(options(model, catalog)).run("What is the value?")).resolves.toMatchObject({ answer: "The value is bluebird." });
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["runtime.search_tools"]);
    expect(model.requests[1]?.tools.map((tool) => tool.name)).toEqual(["echo", "get_current_test_value", "runtime.search_tools"]);
    expect(model.requests[2]?.messages.at(-1)).toMatchObject({ name: "get_current_test_value", content: expect.stringContaining("bluebird") });
  });

  it("returns a safe unavailable-tool error and allows recovery", async () => {
    const registry = new ToolRegistry(createTestTools());
    const catalog = searchableCatalog(registry);
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "hidden", name: "echo", arguments: { value: "no" } }] } },
      { message: { role: "assistant", content: "Recovered by searching first." } },
    ]);
    await expect(new Agent(options(model, catalog)).run("Echo a value.")).resolves.toMatchObject({ answer: "Recovered by searching first." });
    expect(model.requests[1]?.messages.at(-1)).toEqual({ role: "tool", toolCallId: "hidden", name: "echo", content: JSON.stringify({ ok: false, error: { type: "ToolUnavailable", message: "Tool echo is not available in the current tool context. Search the tool catalog first." } }) });
  });

  it("keeps progressive skills and runtime-owned loading compatible", async () => {
    const skill = { name: "work-orders", description: "Work-order guidance.", tags: [], body: "Use tools.", path: "/skills/work-orders/SKILL.md" };
    const registry = new ToolRegistry([...createTestTools(), createLoadSkillTool([skill])]);
    const catalog = searchableCatalog(registry);
    const model = new FakeModel([{ message: { role: "assistant", content: "Done." } }]);
    await new Agent({ ...options(model, catalog), skillCatalog: [skill] }).run("Answer.");
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["runtime.load_skill", "runtime.search_tools"]);
  });

  it("discovers and calls local and namespaced MCP tools", async () => {
    const client: McpClient = { async connect() {}, async listTools() { return []; }, async close() {}, async callTool() { return { content: [{ type: "text", text: "Sunny" }] }; } };
    const mcp = createMcpAgentTool("weather", { name: "forecast", description: "Get weather forecast.", inputSchema: { type: "object" } }, client);
    const registry = new ToolRegistry([...createTestTools(), mcp]);
    const catalog = searchableCatalog(registry);
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "find", name: "runtime.search_tools", arguments: { query: "weather forecast" } }] } },
      { message: { role: "assistant", content: "", toolCalls: [{ id: "weather", name: "weather.forecast", arguments: {} }] } },
      { message: { role: "assistant", content: "Sunny." } },
    ]);
    await expect(new Agent(options(model, catalog)).run("Forecast?")).resolves.toMatchObject({ answer: "Sunny." });
    expect(model.requests[1]?.tools.map((tool) => tool.name)).toContain("weather.forecast");
    expect(model.requests[2]?.messages.at(-1)).toMatchObject({ name: "weather.forecast", content: expect.stringContaining("Sunny") });
  });

  it("records catalog and discovery events in human and JSON traces", async () => {
    const registry = new ToolRegistry(createTestTools());
    const catalog = searchableCatalog(registry);
    const tracer = new TraceRecorder({ model: "fake", reasoning: { mode: "provider-default" }, modelOptions: {}, promptPath: "prompt.md", promptContent: "Use tools.", skills: [], tools: registry.entries(), showThinking: false });
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "find", name: "runtime.search_tools", arguments: { query: "echo" } }] } },
      { message: { role: "assistant", content: "Done." } },
    ]);
    await new Agent({ ...options(model, catalog), tracer }).run("Find echo.");
    expect(tracer.toJson().steps).toContainEqual(expect.objectContaining({ type: "tool.catalog", filtering: true, availableTools: ["runtime.search_tools"] }));
    expect(tracer.toJson().steps).toContainEqual(expect.objectContaining({ type: "tool.discovery", query: "echo", discoveredTools: ["echo"] }));
    expect(tracer.toHuman()).toContain("Tool catalog");
    expect(tracer.toHuman()).toContain("tool search: echo");
  });
});
