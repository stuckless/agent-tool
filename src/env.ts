import { readFile } from "node:fs/promises";

export async function loadDotEnv(path: string): Promise<Record<string, string>> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw new Error(`Could not read .env file: ${path}`);
  }

  const values: Record<string, string> = {};
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const assignment = trimmed.replace(/^export\s+/, "");
    const equalsIndex = assignment.indexOf("=");
    const name = assignment.slice(0, equalsIndex).trim();
    let value = assignment.slice(equalsIndex + 1).trim();
    if (equalsIndex < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid .env entry at ${path}:${index + 1}.`);
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[name] = value;
  }
  return values;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
