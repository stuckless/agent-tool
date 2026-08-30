import type { Skill } from "./loader.js";

export function buildSystemPrompt(basePrompt: string, skills: Skill[]): string {
  if (skills.length === 0) {
    return basePrompt;
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
