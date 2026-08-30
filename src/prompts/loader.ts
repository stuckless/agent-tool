import { readFile } from "node:fs/promises";

export async function loadSystemPrompt(promptPath: string): Promise<string> {
  try {
    return await readFile(promptPath, "utf8");
  } catch {
    throw new Error(`Could not load system prompt: ${promptPath}`);
  }
}
