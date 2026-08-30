import { type Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  tags: string[];
  body: string;
  path: string;
}

export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillError";
  }
}

export async function loadSkills(directories: string[]): Promise<Skill[]> {
  const skillPaths = (await Promise.all(directories.map(findSkillFiles))).flat().sort();
  const skills = await Promise.all(skillPaths.map(loadSkill));
  const names = new Set<string>();

  for (const skill of skills) {
    if (names.has(skill.name)) {
      throw new SkillError(`Duplicate skill name "${skill.name}" found in ${skill.path}.`);
    }
    names.add(skill.name);
  }

  return skills;
}

export async function loadSkill(path: string): Promise<Skill> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new SkillError(`Could not read skill file: ${path}`);
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (!match) {
    throw new SkillError(`Skill file ${path} must start with YAML frontmatter delimited by ---.`);
  }

  const metadata = parseMetadata(match[1] ?? "", path);
  const name = metadata.name;
  const description = metadata.description;
  if (!name) {
    throw new SkillError(`Skill file ${path} is missing required metadata: name.`);
  }
  if (!description) {
    throw new SkillError(`Skill file ${path} is missing required metadata: description.`);
  }

  const body = contents.slice(match[0].length).trim();
  if (!body) {
    throw new SkillError(`Skill file ${path} must contain a Markdown body.`);
  }

  return { name, description, tags: metadata.tags, body, path };
}

export function selectSkills(skills: Skill[], mode: "all" | "none" | "progressive", requestedNames: string[]): Skill[] {
  if (requestedNames.length === 0) {
    return mode === "none" ? [] : skills;
  }

  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return requestedNames.map((name) => {
    const skill = byName.get(name);
    if (!skill) {
      throw new SkillError(`Requested skill "${name}" was not found.`);
    }
    return skill;
  });
}

async function findSkillFiles(directory: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw new SkillError(`Could not read skills directory: ${directory}`);
  }

  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await findSkillFiles(path)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      paths.push(path);
    }
  }
  return paths;
}

function parseMetadata(frontmatter: string, path: string): { name?: string; description?: string; tags: string[] } {
  const values: Record<string, string> = {};
  const tags: string[] = [];
  let readingTags = false;

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    const tagMatch = readingTags ? /^\s*-\s*(.+?)\s*$/.exec(rawLine) : undefined;
    if (tagMatch) {
      tags.push(parseScalar(tagMatch[1] ?? "", path));
      continue;
    }
    readingTags = false;

    const fieldMatch = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(rawLine);
    if (!fieldMatch) {
      throw new SkillError(`Invalid frontmatter in ${path}: ${rawLine}`);
    }
    const key = fieldMatch[1] ?? "";
    const value = fieldMatch[2] ?? "";
    if (key === "tags" && !value) {
      readingTags = true;
    } else if (key === "tags") {
      tags.push(...parseInlineTags(value, path));
    } else {
      values[key] = parseScalar(value, path);
    }
  }

  return { name: values.name, description: values.description, tags };
}

function parseInlineTags(value: string, path: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new SkillError(`Invalid tags metadata in ${path}. Use a YAML list.`);
  }
  const values = trimmed.slice(1, -1).split(",").map((tag) => tag.trim()).filter(Boolean);
  return values.map((tag) => parseScalar(tag, path));
}

function parseScalar(value: string, path: string): string {
  const trimmed = value.trim();
  const unquoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
  if (!unquoted) {
    throw new SkillError(`Invalid empty metadata value in ${path}.`);
  }
  return unquoted;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
