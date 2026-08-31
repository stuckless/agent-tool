import { describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../src/model/ollama/ollama-provider.js";

describe("OllamaProvider", () => {
  it("normalizes a native Ollama chat response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { role: "assistant", content: "A work order tracks requested work." },
          done_reason: "stop",
          prompt_eval_count: 12,
          eval_count: 8,
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaProvider({
      baseUrl: "http://ollama.test/",
      model: "test-model",
      fetch: fetchMock,
    });

    const response = await provider.generate({
      messages: [{ role: "user", content: "What is a work order?" }],
      tools: [],
      reasoning: { mode: "provider-default" },
      options: { temperature: 0 },
    });

    expect(fetchMock).toHaveBeenCalledWith("http://ollama.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "What is a work order?" }],
        options: { temperature: 0 },
        stream: false,
      }),
    });
    expect(response).toEqual({
      message: {
        role: "assistant",
        content: "A work order tracks requested work.",
        reasoning: undefined,
      },
      finishReason: "stop",
      usage: { promptTokens: 12, completionTokens: 8 },
    });
  });

  it.each([
    [{ mode: "provider-default" } as const, undefined],
    [{ mode: "disabled" } as const, false],
    [{ mode: "enabled" } as const, true],
    [{ mode: "effort", effort: "high" } as const, "high"],
  ])("maps %o reasoning to Ollama think=%o", async (reasoning, expectedThink) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 }),
    );
    const provider = new OllamaProvider({ baseUrl: "http://ollama.test", model: "test-model", fetch: fetchMock });

    await provider.generate({ messages: [], tools: [], reasoning, options: {} });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(requestBody.think).toBe(expectedThink);
  });

  it("normalizes and replays provider-exposed thinking", async () => {
    const firstFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "", thinking: "I should inspect the record." } }), { status: 200 }),
    );
    const provider = new OllamaProvider({ baseUrl: "http://ollama.test", model: "test-model", fetch: firstFetch });

    const firstResponse = await provider.generate({
      messages: [{ role: "user", content: "Inspect the record." }],
      tools: [],
      reasoning: { mode: "enabled" },
      options: {},
    });
    expect(firstResponse.message.reasoning).toEqual({ text: "I should inspect the record." });

    const replayFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "done" } }), { status: 200 }),
    );
    const replayProvider = new OllamaProvider({ baseUrl: "http://ollama.test", model: "test-model", fetch: replayFetch });
    await replayProvider.generate({
      messages: [firstResponse.message],
      tools: [],
      reasoning: { mode: "provider-default" },
      options: {},
    });

    const requestBody = JSON.parse(replayFetch.mock.calls[0]?.[1]?.body as string) as { messages: Array<Record<string, unknown>> };
    expect(requestBody.messages[0]).toEqual({
      role: "assistant",
      content: "",
      thinking: "I should inspect the record.",
    });
  });

  it("serializes tool definitions and normalizes native tool calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: "",
            tool_calls: [{ function: { name: "echo", arguments: { value: "hello" } } }],
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaProvider({ baseUrl: "http://ollama.test", model: "test-model", fetch: fetchMock });

    const response = await provider.generate({
      messages: [{ role: "user", content: "Echo hello." }],
      tools: [{ name: "echo", description: "Echoes text.", inputSchema: { type: "object" } }],
      reasoning: { mode: "provider-default" },
      options: {},
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(requestBody.tools).toEqual([
      { type: "function", function: { name: "echo", description: "Echoes text.", parameters: { type: "object" } } },
    ]);
    expect(response.message.toolCalls).toEqual([{ id: "ollama-call-1", name: "echo", arguments: { value: "hello" } }]);
  });

  it("reports HTTP failures without exposing a response body", async () => {
    const provider = new OllamaProvider({
      baseUrl: "http://ollama.test",
      model: "test-model",
      fetch: vi.fn().mockResolvedValue(new Response("sensitive server details", { status: 500 })),
    });

    await expect(provider.generate({ messages: [], tools: [], reasoning: { mode: "provider-default" }, options: {} })).rejects.toThrow("HTTP 500");
  });
});
