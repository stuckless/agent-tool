import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.js";
import { loadSystemPrompt } from "../src/prompts/loader.js";

describe("loadConfig", () => {
  it("loads an Ollama configuration and applies environment overrides", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-config-"));
    await writeFile(
      join(directory, "agent.config.json"),
      JSON.stringify({
        model: {
          name: "from-file",
          baseUrl: "http://localhost:11434/",
          options: { temperature: 0 },
        },
        agent: { systemPrompt: "./custom.md" },
      }),
    );

    const config = await loadConfig({
      cwd: directory,
      environment: { AGENT_MODEL: "from-environment", AGENT_OLLAMA_URL: "http://ollama.test:11434" },
    });

    expect(config).toEqual({
      model: {
        provider: "ollama",
        name: "from-environment",
        baseUrl: "http://ollama.test:11434",
        options: { temperature: 0 },
      },
      agent: { systemPrompt: join(directory, "custom.md") },
    });
  });

  it("rejects malformed JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-config-"));
    const configPath = join(directory, "broken.json");
    await writeFile(configPath, "{");

    await expect(loadConfig({ configPath, cwd: directory })).rejects.toThrow(ConfigError);
    await expect(loadConfig({ configPath, cwd: directory })).rejects.toThrow("invalid JSON");
  });

  it("requires a model name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-config-"));

    await expect(loadConfig({ cwd: directory, environment: {} })).rejects.toThrow("Missing model name");
  });

  it("loads the configured Markdown system prompt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-prompt-"));
    const promptPath = join(directory, "system.md");
    await writeFile(promptPath, "Answer in plain language.\n");

    await expect(loadSystemPrompt(promptPath)).resolves.toBe("Answer in plain language.\n");
  });
});
