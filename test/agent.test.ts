import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/agent.js";
import { StepLimitExceededError, type AgentTraceEvent } from "../src/agent/types.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/model/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createTestTools } from "../src/tools/test-tools.js";

class FakeModel implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: ModelResponse[]) {}

  async chat(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const response = this.responses.shift();
    if (!response) {
      throw new Error("Fake model ran out of responses.");
    }
    return response;
  }
}

describe("Agent", () => {
  it("executes an ordered tool call, preserves the complete assistant turn, and continues to a final answer", async () => {
    const model = new FakeModel([
      {
        message: {
          role: "assistant",
          content: "",
          reasoning: { text: "Use the current value.", metadata: { opaque: "state" } },
          toolCalls: [{ id: "call-1", name: "get_current_test_value", arguments: {} }],
        },
      },
      { message: { role: "assistant", content: "The current value is bluebird." } },
    ]);
    const events: AgentTraceEvent[] = [];
    const agent = new Agent({
      model,
      tools: new ToolRegistry(createTestTools("bluebird")),
      systemPrompt: "Use tools when needed.",
      reasoning: { mode: "enabled" },
      modelOptions: { temperature: 0 },
      tracer: { trace(event) { events.push(event); } },
    });

    const result = await agent.run("What is the current test value?");

    expect(result.answer).toBe("The current value is bluebird.");
    expect(result.steps).toBe(2);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "get_current_test_value"]);
    expect(model.requests[1]?.messages).toEqual([
      { role: "system", content: "Use tools when needed." },
      { role: "user", content: "What is the current test value?" },
      {
        role: "assistant",
        content: "",
        reasoning: { text: "Use the current value.", metadata: { opaque: "state" } },
        toolCalls: [{ id: "call-1", name: "get_current_test_value", arguments: {} }],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "get_current_test_value",
        content: JSON.stringify({ ok: true, result: { value: "bluebird" } }),
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "tool.catalog",
      "model.request",
      "model.response",
      "tool.call",
      "tool.result",
      "model.request",
      "model.response",
      "run.complete",
    ]);
  });

  it("returns safe tool errors to the model and lets it recover", async () => {
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "bad", name: "missing_tool", arguments: {} }] } },
      { message: { role: "assistant", content: "That tool is unavailable." } },
    ]);
    const agent = new Agent({
      model,
      tools: new ToolRegistry(),
      systemPrompt: "Use tools.",
      reasoning: { mode: "provider-default" },
      modelOptions: {},
    });

    await expect(agent.run("Try a tool.")).resolves.toMatchObject({ answer: "That tool is unavailable." });
    expect(model.requests[1]?.messages[3]).toMatchObject({
      role: "tool",
      content: JSON.stringify({ ok: false, error: { type: "UnknownTool", message: "No tool named missing_tool is available." } }),
    });
  });

  it("executes multiple calls from one assistant turn in returned order", async () => {
    const model = new FakeModel([
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "first", name: "echo", arguments: { value: "one" } },
            { id: "second", name: "echo", arguments: { value: "two" } },
          ],
        },
      },
      { message: { role: "assistant", content: "Both values were returned." } },
    ]);
    const agent = new Agent({
      model,
      tools: new ToolRegistry(createTestTools()),
      systemPrompt: "Use tools.",
      reasoning: { mode: "provider-default" },
      modelOptions: {},
    });

    await agent.run("Echo two values.");
    expect(model.requests[1]?.messages.slice(-2)).toMatchObject([
      { role: "tool", toolCallId: "first", content: JSON.stringify({ ok: true, result: { value: "one" } }) },
      { role: "tool", toolCallId: "second", content: JSON.stringify({ ok: true, result: { value: "two" } }) },
    ]);
  });

  it("enforces maxSteps instead of returning a partial response", async () => {
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "one", name: "echo", arguments: { value: "one" } }] } },
      { message: { role: "assistant", content: "", toolCalls: [{ id: "two", name: "echo", arguments: { value: "two" } }] } },
    ]);
    const agent = new Agent({
      model,
      tools: new ToolRegistry(createTestTools()),
      systemPrompt: "Use tools.",
      reasoning: { mode: "provider-default" },
      modelOptions: {},
      maxSteps: 2,
    });

    await expect(agent.run("Keep going.")).rejects.toThrow(StepLimitExceededError);
    expect(model.requests).toHaveLength(2);
  });

  it("rejects duplicate tool names", () => {
    const [echo] = createTestTools();
    expect(() => new ToolRegistry([echo!, echo!])).toThrow("already registered");
  });
});
