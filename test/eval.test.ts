import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/agent.js";
import { parseEvalDataset, runEval, type EvalRuntime } from "../src/eval/runner.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/model/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { AgentTool } from "../src/tools/types.js";
import { createLoadSkillTool } from "../src/skills/runtime.js";

class FakeModel implements ModelProvider {
  constructor(private readonly responses: ModelResponse[]) {}
  async chat(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses.shift();
    if (!response) throw new Error("Fake model ran out of responses.");
    return response;
  }
}

function runtime(responses: ModelResponse[], tools: AgentTool[] = []): EvalRuntime {
  return {
    model: "fake-model",
    reasoning: { mode: "effort", effort: "high" },
    modelOptions: { temperature: 0 },
    promptPath: "/prompts/test.md",
    promptContent: "Use tools.",
    skills: [{ name: "test-skill", description: "Test guidance.", tags: [], body: "Use the test tool.", path: "/skills/test/SKILL.md" }],
    tools,
    createAgent: (tracer) => new Agent({
      model: new FakeModel(structuredClone(responses)),
      tools: new ToolRegistry(tools),
      systemPrompt: "Use tools.",
      reasoning: { mode: "effort", effort: "high" },
      modelOptions: { temperature: 0 },
      tracer,
    }),
  };
}

const echo: AgentTool = { name: "echo", description: "Echo.", inputSchema: { type: "object" }, async execute(args) { return args; } };

describe("eval runner", () => {
  it("records a passing deterministic tool eval with controlled reasoning metadata", async () => {
    const report = await runEval(parseEvalDataset([{ id: "echo", prompt: "Echo this.", expect: { requiredTools: ["echo"], forbiddenTools: ["delete"], maxToolCalls: 1, outputIncludes: ["Done"] } }]), runtime([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "echo", arguments: { value: "hello" } }] } },
      { message: { role: "assistant", content: "Done." } },
    ], [echo]));

    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(report.cases[0]).toMatchObject({
      prompt: { sha256: expect.any(String) },
      assertions: { completed: true, requiredTools: { echo: true }, forbiddenTools: { delete: true }, maxToolCalls: { actual: 1, passed: true }, outputIncludes: { Done: true }, noToolErrors: true, passed: true },
      trace: { model: "fake-model", reasoningConfig: { mode: "effort", effort: "high" }, skills: [{ name: "test-skill" }], tools: [{ name: "echo" }] },
    });
    expect(report.cases[0]?.trace.steps.filter((event) => event.type === "model.request")).toHaveLength(2);
  });

  it("fails required and forbidden-tool, call-limit, and output assertions objectively", async () => {
    const report = await runEval(parseEvalDataset([{ id: "bad-selection", prompt: "Do it.", expect: { requiredTools: ["required"], forbiddenTools: ["echo"], maxToolCalls: 0, outputIncludes: ["expected text"] } }]), runtime([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "echo", arguments: {} }] } },
      { message: { role: "assistant", content: "Different output." } },
    ], [echo]));

    expect(report.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(report.cases[0]?.assertions).toMatchObject({ requiredTools: { required: false }, forbiddenTools: { echo: false }, maxToolCalls: { actual: 1, passed: false }, outputIncludes: { "expected text": false }, passed: false });
  });

  it("fails a completed run when a tool returns an error", async () => {
    const broken: AgentTool = { name: "broken", description: "Fails.", inputSchema: { type: "object" }, async execute() { throw new Error("secret failure"); } };
    const report = await runEval(parseEvalDataset([{ id: "tool-error", prompt: "Try it.", expect: { requiredTools: ["broken"], forbiddenTools: [], maxToolCalls: 1, outputIncludes: ["Recovered"] } }]), runtime([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "broken", arguments: {} }] } },
      { message: { role: "assistant", content: "Recovered." } },
    ], [broken]));

    expect(report.cases[0]?.assertions).toMatchObject({ completed: true, noToolErrors: false, passed: false });
    expect(report.cases[0]?.trace.steps).toContainEqual(expect.objectContaining({ type: "tool.result", ok: false }));
  });

  it("marks model/runtime errors as incomplete and rejects malformed datasets", async () => {
    const report = await runEval(parseEvalDataset([{ id: "runtime-error", prompt: "Hello", expect: { requiredTools: [], forbiddenTools: [], maxToolCalls: 0, outputIncludes: [] } }]), runtime([], []));
    expect(report.cases[0]).toMatchObject({ status: "error", assertions: { completed: false, passed: false } });
    expect(() => parseEvalDataset([{ id: "missing-expect", prompt: "x" }])).toThrow("Invalid eval dataset");
  });

  it("evaluates expected progressive skill-load tool usage", async () => {
    const skills = [{ name: "test-skill", description: "Test guidance.", tags: [], body: "Use the test tool.", path: "/skills/test/SKILL.md" }];
    const loadSkill = createLoadSkillTool(skills);
    const report = await runEval(parseEvalDataset([{ id: "load-skill", prompt: "Use guidance.", expect: { requiredTools: ["runtime.load_skill"], forbiddenTools: [], maxToolCalls: 1, outputIncludes: ["Done"] } }]), {
      ...runtime([], [loadSkill]),
      skills,
      tools: [loadSkill],
      createAgent: (tracer) => new Agent({
        model: new FakeModel([
          { message: { role: "assistant", content: "", toolCalls: [{ id: "load", name: "runtime.load_skill", arguments: { name: "test-skill" } }] } },
          { message: { role: "assistant", content: "Done." } },
        ]),
        tools: new ToolRegistry([createLoadSkillTool(skills)]), systemPrompt: "Skill catalog only.", skillCatalog: skills,
        reasoning: { mode: "effort", effort: "high" }, modelOptions: {}, tracer,
      }),
    });

    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(report.cases[0]?.trace.steps).toContainEqual(expect.objectContaining({ type: "skill.load", name: "test-skill", ok: true }));
  });
});
