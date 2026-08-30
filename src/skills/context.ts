import type { Skill } from "./loader.js";

export type SkillDisclosureMode = "eager" | "progressive";

export function buildSystemPrompt(basePrompt: string, skills: Skill[], disclosureMode: SkillDisclosureMode = "eager"): string {
  if (skills.length === 0) {
    return basePrompt;
  }

  if (disclosureMode === "progressive") {
    const catalog = skills.map((skill) => `${skill.name} — ${skill.description}`).join("\n");
    return `${basePrompt.trimEnd()}\n\n<skill-catalog>\n${catalog}\n</skill-catalog>\n`;
  }

  const blocks = skills.map((skill) => [
    `<skill name="${escapeAttribute(skill.name)}">`,
    skill.body,
    "</skill>",
  ].join("\n"));
  return `${basePrompt.trimEnd()}\n\n<loaded-skills>\n${blocks.join("\n\n")}\n</loaded-skills>\n`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
