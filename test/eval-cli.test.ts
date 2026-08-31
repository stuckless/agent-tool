import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runEvalCli } from "../src/eval-cli.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent-eval CLI", () => {
  it("runs a local deterministic provider response and writes its JSON report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-eval-"));
    tempDirectories.push(directory);
    const promptPath = join(directory, "prompt.md");
    const configPath = join(directory, "agent.config.json");
    const datasetPath = join(directory, "evals.json");
    const outputPath = join(directory, "results.json");
    await writeFile(promptPath, "Answer directly.");
    await writeFile(configPath, JSON.stringify({ model: { name: "fake-model", baseUrl: "http://fake.local" }, agent: { systemPrompt: promptPath }, skills: { directories: [], mode: "none" } }));
    await writeFile(datasetPath, JSON.stringify([{ id: "direct", prompt: "Say hello", expect: { requiredTools: [], forbiddenTools: ["echo"], maxToolCalls: 0, outputIncludes: ["Hello"] } }]));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { role: "assistant", content: "Hello." }, done: true }), { status: 200 })));
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const passed = await runEvalCli(["--config", configPath, "--output", outputPath, datasetPath]);

    expect(passed).toBe(true);
    const report = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(report).toMatchObject({ summary: { passed: 1 }, cases: [{ id: "direct", assertions: { passed: true }, trace: { model: "fake-model" } }] });
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({ summary: { passed: 1 } });
  });

  it("runs the baseline Ollama tool-call smoke fixture", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-tool-eval-"));
    tempDirectories.push(directory);
    const promptPath = join(directory, "prompt.md");
    const configPath = join(directory, "agent.config.json");
    const fixturePath = new URL("./fixtures/ollama-tool-smoke-eval.json", import.meta.url);
    await writeFile(promptPath, "Use tools when needed.");
    await writeFile(configPath, JSON.stringify({ model: { name: "fake-model", baseUrl: "http://fake.local" }, agent: { systemPrompt: promptPath }, skills: { directories: [], mode: "none" } }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "get_current_test_value", arguments: {} } }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: "assistant", content: "The current value is phase-2-current-test-value." } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const passed = await runEvalCli(["--config", configPath, fixturePath.pathname]);

    expect(passed).toBe(true);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      summary: { passed: 1 },
      cases: [{ id: "get-current-test-value", assertions: { requiredTools: { get_current_test_value: true }, passed: true } }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const continuationBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as { messages: Array<{ role: string; tool_call_id?: string }> };
    expect(continuationBody.messages.slice(-2)).toEqual([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "get_current_test_value", arguments: {} } }] },
      expect.objectContaining({ role: "tool", content: expect.stringContaining("phase-2-current-test-value") }),
    ]);
  });
});
