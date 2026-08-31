import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/agent.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/model/types.js";
import { buildSystemPrompt } from "../src/skills/context.js";
import { SkillError, loadSkills, selectSkills, type Skill } from "../src/skills/loader.js";
import { createLoadSkillTool } from "../src/skills/runtime.js";
import { TraceRecorder } from "../src/trace/trace.js";
import { createMcpAgentTool } from "../src/mcp/manager.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createTestTools } from "../src/tools/test-tools.js";

async function writeSkill(directory: string, name: string, contents: string): Promise<void> {
  const skillDirectory = join(directory, name);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), contents);
}

const workOrderSkill = `---
name: work-orders
description: Guidance for work-order queries.
tags:
  - maximo
  - work-orders
---

# Work Orders

Use a count tool for count questions.
`;

class SkillAwareModel implements ModelProvider {
  readonly id = "ollama" as const;
  readonly requests: ModelRequest[] = [];

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const systemPrompt = request.messages[0]?.content ?? "";
    const hasWorkOrderSkill = systemPrompt.includes('<skill name="work-orders">');
    const hasToolResult = request.messages.some((message) => message.role === "tool");

    if (!hasWorkOrderSkill) {
      return { message: { role: "assistant", content: "No work-order skill was loaded." } };
    }
    if (!hasToolResult) {
      return {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "count", name: "get_current_test_value", arguments: {} }],
        },
      };
    }
    return { message: { role: "assistant", content: "Used the skill and retrieved the current value." } };
  }
}

class FakeModel implements ModelProvider {
  readonly id = "ollama" as const;
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: ModelResponse[]) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const response = this.responses.shift();
    if (!response) throw new Error("Fake model ran out of responses.");
    return response;
  }
}

describe("skills", () => {
  it("discovers SKILL.md files and parses their required metadata, tags, and Markdown body", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-skills-"));
    await writeSkill(directory, "work-orders", workOrderSkill);

    await expect(loadSkills([directory])).resolves.toEqual([
      expect.objectContaining({
        name: "work-orders",
        description: "Guidance for work-order queries.",
        tags: ["maximo", "work-orders"],
        body: "# Work Orders\n\nUse a count tool for count questions.",
      }),
    ]);
  });

  it("fails fast for malformed skills and duplicate names", async () => {
    const malformedDirectory = await mkdtemp(join(tmpdir(), "agent-tool-skills-"));
    await writeSkill(malformedDirectory, "broken", "# Missing frontmatter\n");
    await expect(loadSkills([malformedDirectory])).rejects.toThrow("must start with YAML frontmatter");

    const duplicateDirectory = await mkdtemp(join(tmpdir(), "agent-tool-skills-"));
    await writeSkill(duplicateDirectory, "first", workOrderSkill);
    await writeSkill(duplicateDirectory, "second", workOrderSkill.replace("# Work Orders", "# Another Work Orders"));
    await expect(loadSkills([duplicateDirectory])).rejects.toThrow('Duplicate skill name "work-orders"');
  });

  it("selects all, none, or explicitly named skills without changing the user prompt", () => {
    const skills: Skill[] = [
      { name: "work-orders", description: "Work orders.", tags: [], body: "Use a count tool.", path: "/skills/work-orders/SKILL.md" },
      { name: "locations", description: "Locations.", tags: [], body: "Resolve location names.", path: "/skills/locations/SKILL.md" },
    ];

    expect(selectSkills(skills, "all", []).map((skill) => skill.name)).toEqual(["work-orders", "locations"]);
    expect(selectSkills(skills, "none", [])).toEqual([]);
    expect(selectSkills(skills, "all", ["locations"]).map((skill) => skill.name)).toEqual(["locations"]);
    expect(() => selectSkills(skills, "none", ["unknown"])).toThrow(SkillError);

    expect(buildSystemPrompt("Base instructions.\n", selectSkills(skills, "none", []))).toBe("Base instructions.\n");
    expect(buildSystemPrompt("Base instructions.\n", selectSkills(skills, "all", ["work-orders"]))).toBe(
      "Base instructions.\n\n<loaded-skills>\n<skill name=\"work-orders\">\nUse a count tool.\n</skill>\n</loaded-skills>\n",
    );
  });

  it("makes the selected skill visible to the model while preserving the user prompt", async () => {
    const skill: Skill = {
      name: "work-orders",
      description: "Work orders.",
      tags: [],
      body: "Use get_current_test_value before answering.",
      path: "/skills/work-orders/SKILL.md",
    };
    const disabledModel = new SkillAwareModel();
    const enabledModel = new SkillAwareModel();
    const makeAgent = (model: SkillAwareModel, selectedSkills: Skill[]) => new Agent({
      model,
      tools: new ToolRegistry(createTestTools("bluebird")),
      systemPrompt: buildSystemPrompt("Answer accurately.\n", selectedSkills),
      reasoning: { mode: "provider-default" },
      modelOptions: {},
    });

    const question = "What is the current work-order value?";
    await expect(makeAgent(disabledModel, []).run(question)).resolves.toMatchObject({ answer: "No work-order skill was loaded." });
    await expect(makeAgent(enabledModel, [skill]).run(question)).resolves.toMatchObject({
      answer: "Used the skill and retrieved the current value.",
      steps: 2,
    });

    expect(disabledModel.requests).toHaveLength(1);
    expect(enabledModel.requests).toHaveLength(2);
    expect(enabledModel.requests[0]?.messages).toMatchObject([
      { role: "system", content: expect.stringContaining('<skill name="work-orders">') },
      { role: "user", content: question },
    ]);
    expect(enabledModel.requests[0]?.messages[1]).toEqual({ role: "user", content: question });
  });

  it("progressively catalogs selected skills, loads one in order, and keeps it available without duplication", async () => {
    const skills: Skill[] = [
      { name: "work-orders", description: "Work order guidance.", tags: [], body: "Use the count tool before answering.", path: "/skills/work-orders/SKILL.md" },
      { name: "locations", description: "Location guidance.", tags: [], body: "Resolve locations first.", path: "/skills/locations/SKILL.md" },
    ];
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "load", name: "runtime.load_skill", arguments: { name: "work-orders" } }] } },
      { message: { role: "assistant", content: "", toolCalls: [{ id: "again", name: "runtime.load_skill", arguments: { name: "work-orders" } }] } },
      { message: { role: "assistant", content: "The loaded instructions were followed." } },
    ]);
    const tracer = new TraceRecorder({ model: "fake", reasoning: { mode: "provider-default" }, modelOptions: {}, promptPath: "prompt.md", promptContent: "Base.", skills, tools: [...createTestTools(), createLoadSkillTool(skills)], showThinking: false });
    const agent = new Agent({
      model,
      tools: new ToolRegistry([...createTestTools(), createLoadSkillTool(skills)]),
      systemPrompt: buildSystemPrompt("Base.\n", skills, "progressive"),
      skillCatalog: skills,
      reasoning: { mode: "provider-default" },
      modelOptions: {},
      tracer,
    });

    await expect(agent.run("Count work orders.")).resolves.toMatchObject({ answer: "The loaded instructions were followed.", steps: 3 });
    expect(model.requests[0]?.messages[0]?.content).toContain("work-orders — Work order guidance.");
    expect(model.requests[0]?.messages[0]?.content).not.toContain("Use the count tool before answering.");
    expect(model.requests[1]?.messages.at(-1)).toEqual({ role: "tool", toolCallId: "load", name: "runtime.load_skill", content: JSON.stringify({ ok: true, result: { name: "work-orders", content: "Use the count tool before answering.", alreadyLoaded: false } }) });
    expect(model.requests[2]?.messages.at(-1)).toEqual({ role: "tool", toolCallId: "again", name: "runtime.load_skill", content: JSON.stringify({ ok: true, result: { name: "work-orders", alreadyLoaded: true } }) });
    expect(model.requests[2]?.messages.filter((message) => message.role === "tool" && message.name === "runtime.load_skill")).toHaveLength(2);
    expect(tracer.toJson().steps).toContainEqual(expect.objectContaining({ type: "skill.catalog", skills: [{ name: "work-orders", description: "Work order guidance." }, { name: "locations", description: "Location guidance." }] }));
    expect(tracer.toJson().steps).toContainEqual(expect.objectContaining({ type: "skill.load", name: "work-orders", ok: true, alreadyLoaded: false }));
    expect(tracer.toJson().steps).toContainEqual(expect.objectContaining({ type: "skill.load", name: "work-orders", ok: true, alreadyLoaded: true }));
  });

  it("returns safe normalized errors for unknown and unselected skill requests", async () => {
    const selected: Skill[] = [{ name: "work-orders", description: "Work order guidance.", tags: [], body: "Use a count tool.", path: "/skills/work-orders/SKILL.md" }];
    const available = [...selected, { name: "assets", description: "Asset guidance.", tags: [], body: "Inspect assets.", path: "/skills/assets/SKILL.md" }];
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "unselected", name: "runtime.load_skill", arguments: { name: "assets" } }] } },
      { message: { role: "assistant", content: "", toolCalls: [{ id: "unknown", name: "runtime.load_skill", arguments: { name: "missing" } }] } },
      { message: { role: "assistant", content: "Recovered." } },
    ]);
    const agent = new Agent({ model, tools: new ToolRegistry([createLoadSkillTool(selected, available)]), systemPrompt: buildSystemPrompt("Base.", selected, "progressive"), skillCatalog: selected, reasoning: { mode: "provider-default" }, modelOptions: {} });

    await expect(agent.run("Load assets.")).resolves.toMatchObject({ answer: "Recovered." });
    expect(model.requests[1]?.messages.at(-1)).toEqual({ role: "tool", toolCallId: "unselected", name: "runtime.load_skill", content: JSON.stringify({ ok: false, error: { type: "SkillNotSelected", message: "Skill \"assets\" was not selected for this run." } }) });
    expect(model.requests[2]?.messages.at(-1)).toEqual({ role: "tool", toolCallId: "unknown", name: "runtime.load_skill", content: JSON.stringify({ ok: false, error: { type: "UnknownSkill", message: "Skill \"missing\" is not known." } }) });
  });

  it("keeps runtime, local, and MCP tools in one callable registry", async () => {
    const skills: Skill[] = [{ name: "work-orders", description: "Work order guidance.", tags: [], body: "Use the available tools.", path: "/skills/work-orders/SKILL.md" }];
    const mcpTool = createMcpAgentTool("demo", { name: "lookup", description: "Look up a record.", inputSchema: { type: "object" } }, {
      async connect() {}, async listTools() { return []; }, async close() {},
      async callTool() { return { content: [{ type: "text", text: "record found" }] }; },
    });
    const model = new FakeModel([
      { message: { role: "assistant", content: "", toolCalls: [{ id: "load", name: "runtime.load_skill", arguments: { name: "work-orders" } }] } },
      { message: { role: "assistant", content: "", toolCalls: [{ id: "mcp", name: "demo.lookup", arguments: {} }] } },
      { message: { role: "assistant", content: "Done." } },
    ]);
    const registry = new ToolRegistry([...createTestTools(), createLoadSkillTool(skills), mcpTool]);
    const agent = new Agent({ model, tools: registry, systemPrompt: buildSystemPrompt("Base.", skills, "progressive"), skillCatalog: skills, reasoning: { mode: "provider-default" }, modelOptions: {} });

    await expect(agent.run("Look this up.")).resolves.toMatchObject({ answer: "Done." });
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "get_current_test_value", "runtime.load_skill", "demo.lookup"]);
    expect(model.requests[2]?.messages.at(-1)).toMatchObject({ role: "tool", name: "demo.lookup", content: expect.stringContaining("record found") });
  });
});
