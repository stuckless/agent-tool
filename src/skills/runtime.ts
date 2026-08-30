import type { AgentTool } from "../tools/types.js";
import { ToolExecutionError } from "../tools/types.js";
import type { Skill } from "./loader.js";

export function createLoadSkillTool(selectedSkills: Skill[], availableSkills: Skill[] = selectedSkills): AgentTool {
  const skillsByName = new Map(selectedSkills.map((skill) => [skill.name, skill]));
  const availableNames = new Set(availableSkills.map((skill) => skill.name));
  const loadedNames = new Set<string>();

  return {
    name: "runtime.load_skill",
    description: "Load the full instructions for a skill listed in the skill catalog.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "The exact skill name from the skill catalog." } },
      required: ["name"],
      additionalProperties: false,
    },
    runtime: { kind: "load-skill" },
    async execute(arguments_) {
      const name = arguments_.name;
      if (typeof name !== "string" || !name.trim()) {
        throw new ToolExecutionError("InvalidToolArguments", "Skill name must be a non-empty string.");
      }
      const skill = skillsByName.get(name);
      if (!skill) {
        if (availableNames.has(name)) {
          throw new ToolExecutionError("SkillNotSelected", `Skill "${name}" was not selected for this run.`);
        }
        throw new ToolExecutionError("UnknownSkill", `Skill "${name}" is not known.`);
      }
      if (loadedNames.has(name)) {
        return { name, alreadyLoaded: true };
      }
      loadedNames.add(name);
      return { name, content: skill.body, alreadyLoaded: false };
    },
  };
}
