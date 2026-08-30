import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/agent.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/model/types.js";
import { buildSystemPrompt } from "../src/skills/context.js";
import { SkillError, loadSkills, selectSkills, type Skill } from "../src/skills/loader.js";
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
  readonly requests: ModelRequest[] = [];

  async chat(request: ModelRequest): Promise<ModelResponse> {
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
});
