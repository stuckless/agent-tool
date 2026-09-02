import { describe, expect, it, vi } from "vitest";

import { providerRegistry } from "../src/model/provider-registry.js";
import { ZenAuthenticationError, ZenProviderError } from "../src/model/zen/zen-errors.js";
import { ZenProvider } from "../src/model/zen/zen-provider.js";

const defaultRequest = {
  reasoning: { mode: "provider-default" } as const,
  options: { temperature: 0.2 },
};

describe("Zen OpenAI-compatible Chat Completions", () => {
  it("maps normalized messages and tools to the chat completions request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Done" }, finish_reason: "stop" }] }), { status: 200 }));
    const provider = new ZenProvider({ baseUrl: "https://zen.test/zen/v1/", apiKey: "test-key", model: "deepseek-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [{ role: "system", content: "Be precise." }, { role: "user", content: "Look up a value." }],
      tools: [{ name: "lookup", description: "Looks up a value.", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
    });

    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json", authorization: "Bearer test-key" }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      temperature: 0.2,
      model: "deepseek-test",
      messages: [{ role: "system", content: "Be precise." }, { role: "user", content: "Look up a value." }],
      tools: [{ type: "function", function: { name: "lookup", description: "Looks up a value.", parameters: { type: "object", properties: { id: { type: "string" } } } } }],
    });
  });

  it("normalizes text, ordered tool calls, finish reason, and usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "I will check.", tool_calls: [
        { id: "call-one", type: "function", function: { name: "first", arguments: "{\"value\":1}" } },
        { id: "call-two", type: "function", function: { name: "second", arguments: "{\"value\":2}" } },
      ] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "deepseek-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).resolves.toEqual({
      message: { role: "assistant", content: "I will check.", toolCalls: [
        { id: "call-one", name: "first", arguments: { value: 1 } },
        { id: "call-two", name: "second", arguments: { value: 2 } },
      ] },
      finishReason: "tool_calls",
      usage: { promptTokens: 12, completionTokens: 4 },
      providerMetadata: { provider: "zen", model: "deepseek-test", protocol: "openai-chat" },
    });
  });

  it("replays assistant tool calls and tool results with their original IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "The value is 42." }, finish_reason: "stop" }] }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "deepseek-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [
        { role: "assistant", content: "", toolCalls: [{ id: "call-abc", name: "lookup", arguments: { key: "answer" } }] },
        { role: "tool", toolCallId: "call-abc", name: "lookup", content: "42" },
      ],
      tools: [],
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "call-abc", type: "function", function: { name: "lookup", arguments: "{\"key\":\"answer\"}" } }] },
      { role: "tool", tool_call_id: "call-abc", content: "42" },
    ]);
  });

  it("maps supported reasoning effort and rejects an unmappable generic enabled mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "deepseek-test", fetch: fetchMock });

    await provider.generate({ ...defaultRequest, reasoning: { mode: "effort", effort: "high" }, messages: [], tools: [] });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ reasoning_effort: "high" });
    await expect(provider.generate({ ...defaultRequest, reasoning: { mode: "enabled" }, messages: [], tools: [] })).rejects.toThrow("cannot map generic reasoning mode enabled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps authentication and transport failures without leaking credentials", async () => {
    const secret = "very-secret-key";
    const authProvider = new ZenProvider({ apiKey: secret, model: "deepseek-test", fetch: vi.fn().mockResolvedValue(new Response(`Authorization: Bearer ${secret}`, { status: 401 })) });
    await expect(authProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenAuthenticationError);

    const unavailableProvider = new ZenProvider({ apiKey: secret, model: "deepseek-test", fetch: vi.fn().mockRejectedValue(new Error(`Bearer ${secret}`)) });
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toThrow("Could not reach OpenCode Zen");
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.not.toThrow(secret);
  });

  it("selects the openai-chat adapter through the provider registry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const provider = providerRegistry.create({ provider: "zen", baseUrl: "https://zen.test/zen/v1", name: "deepseek-test", modelRoutes: {} }, { fetch: fetchMock });

    await provider.generate({ ...defaultRequest, messages: [], tools: [] });
    expect(provider.id).toBe("zen");
    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/chat/completions", expect.any(Object));
  });

  it("fails clearly for Zen models without the openai-chat protocol", async () => {
    const fetchMock = vi.fn();
    const provider = new ZenProvider({ apiKey: "test-key", model: "unrouted-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toEqual(expect.objectContaining({
      name: "ZenProviderError",
      message: expect.stringContaining("routed to unknown"),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose invalid provider response details", async () => {
    const provider = new ZenProvider({ apiKey: "test-key", model: "deepseek-test", fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })) });
    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenProviderError);
  });
});
