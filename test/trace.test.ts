import { describe, expect, it } from "vitest";

import { TraceRecorder } from "../src/trace/trace.js";

const skill = {
  name: "work-orders",
  description: "Use work-order tools.",
  tags: ["maintenance"],
  body: "Use authoritative tools.",
  path: "/skills/work-orders/SKILL.md",
};

describe("TraceRecorder", () => {
  it("records stable observable JSON events while hiding thinking text by default", () => {
    const clockValues = [0, 10, 20, 30, 40, 50];
    const tracer = new TraceRecorder({
      model: "fake-model",
      reasoning: { mode: "effort", effort: "high" },
      modelOptions: { temperature: 0, apiToken: "secret" },
      promptPath: "/prompts/minimal.md",
      promptContent: "Use tools.",
      skills: [skill],
      tools: [{ name: "echo", description: "Echo a value.", inputSchema: { type: "object" }, async execute() { return {}; } }],
      showThinking: false,
      now: () => clockValues.shift() ?? 50,
    });

    tracer.trace({ type: "model.request", step: 1 });
    tracer.trace({
      type: "model.response",
      step: 1,
      toolCalls: 1,
      reasoningPresent: true,
      durationMs: 9,
      finishReason: "tool_calls",
      usage: { promptTokens: 10, completionTokens: 2 },
      providerMetadata: { provider: "zen", model: "deepseek-test", protocol: "openai-chat", authorization: "secret" },
      message: { role: "assistant", content: "", reasoning: { text: "private reasoning" }, toolCalls: [{ id: "call-1", name: "echo", arguments: { apiKey: "secret", value: "hello" } }] },
    });
    tracer.trace({ type: "tool.call", step: 1, toolCall: { id: "call-1", name: "echo", arguments: { apiKey: "secret", value: "hello" } } });
    tracer.trace({ type: "tool.result", step: 1, toolCallId: "call-1", name: "echo", ok: true, payload: { value: "hello" }, durationMs: 7 });
    tracer.trace({ type: "model.response", step: 2, toolCalls: 0, reasoningPresent: false, durationMs: 8, message: { role: "assistant", content: "Done." } });
    tracer.trace({ type: "run.complete", step: 2, answer: "Done." });

    const json = tracer.toJson();
    expect(json).toMatchObject({
      model: "fake-model",
      reasoningConfig: { mode: "effort", effort: "high" },
      modelOptions: { temperature: 0, apiToken: "[REDACTED]" },
      skills: [{ name: "work-orders" }],
      tools: [{ name: "echo", source: "local" }],
      finalAnswer: "Done.",
      status: "completed",
    });
    expect(json.steps.map((event) => event.type)).toEqual(["model.request", "model.response", "tool.call", "tool.result", "model.response", "run.complete"]);
    expect(json.steps[1]).toMatchObject({ reasoning: { exposed: true, characters: 17 } });
    expect(json.steps[1]).toMatchObject({ durationMs: 9, finishReason: "tool_calls", usage: { promptTokens: 10, completionTokens: 2 }, providerMetadata: { provider: "zen", authorization: "[REDACTED]" } });
    expect(JSON.stringify(json)).not.toContain("private reasoning");
    expect(JSON.stringify(json)).toContain("[REDACTED]");
    expect(tracer.toHuman()).toContain("thinking exposed: yes (17 chars)");
  });

  it("includes only actually exposed thinking when explicitly requested", () => {
    const tracer = new TraceRecorder({
      model: "fake-model", reasoning: { mode: "enabled" }, modelOptions: {}, promptPath: "prompt.md", promptContent: "Use tools.", skills: [], tools: [], showThinking: true, now: () => 0,
    });
    tracer.trace({ type: "model.response", step: 1, toolCalls: 0, reasoningPresent: true, durationMs: 0, message: { role: "assistant", content: "Answer", reasoning: { text: "exposed text" } } });

    expect(tracer.toJson().steps[0]).toMatchObject({ reasoning: { text: "exposed text" } });
    expect(tracer.toHuman()).toContain("thinking: exposed text");
  });

  it("redacts configured environment values when they appear in trace data", () => {
    const tracer = new TraceRecorder({
      model: "fake-model", reasoning: { mode: "provider-default" }, modelOptions: {}, promptPath: "prompt.md", promptContent: "Use tools.", skills: [], tools: [], showThinking: false, secretValues: ["configured-secret"], now: () => 0,
    });
    tracer.trace({ type: "tool.result", step: 1, toolCallId: "call-1", name: "echo", ok: true, payload: { value: "configured-secret" }, durationMs: 0 });

    expect(tracer.toJson().steps[0]).toMatchObject({ result: { value: "[REDACTED]" } });
  });

  it("records progressive skill catalog and load events in JSON and human traces", () => {
    const tracer = new TraceRecorder({ model: "fake-model", reasoning: { mode: "provider-default" }, modelOptions: {}, promptPath: "prompt.md", promptContent: "Use tools.", skills: [skill], tools: [{ name: "runtime.load_skill", description: "Load a skill.", inputSchema: { type: "object" }, runtime: { kind: "load-skill" }, async execute() { return {}; } }], showThinking: false, now: () => 0 });
    tracer.trace({ type: "skill.catalog", skills: [{ name: "work-orders", description: "Use work-order tools." }] });
    tracer.trace({ type: "skill.load", step: 1, name: "work-orders", ok: true, alreadyLoaded: false });

    expect(tracer.toJson()).toMatchObject({ tools: [{ name: "runtime.load_skill", source: "runtime" }], steps: [{ type: "skill.catalog" }, { type: "skill.load", name: "work-orders", ok: true }] });
    expect(tracer.toHuman()).toContain("Skill catalog");
    expect(tracer.toHuman()).toContain("skill → loaded: work-orders");
  });
});
