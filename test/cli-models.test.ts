import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";

describe("agent-tool models", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists Zen models through the configured discovery provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-zen-cli-"));
    const configPath = join(directory, "agent.config.json");
    await writeFile(configPath, JSON.stringify({ model: { provider: "zen", name: "unused" }, providers: { zen: { baseUrl: "https://zen.test/zen/v1" } } }));
    vi.stubEnv("OPENCODE_ZEN_API_KEY", "cli-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-test" }, { id: "new-model-x" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["models", "--provider", "zen", "--config", configPath]);

    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/models", {
      method: "GET",
      headers: { authorization: "Bearer cli-test-key" },
    });
    expect(output).toHaveBeenNthCalledWith(1, "MODEL\tPROTOCOL\tSTATUS");
    expect(output).toHaveBeenNthCalledWith(2, "gpt-test\topenai-responses\tsupported");
    expect(output).toHaveBeenNthCalledWith(3, "new-model-x\tunknown\tdiscovered/unroutable");
  });
});
