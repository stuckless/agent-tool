import { describe, expect, it, vi } from "vitest";

import { providerRegistry } from "../src/model/provider-registry.js";
import { ZenAuthenticationError, ZenProviderError } from "../src/model/zen/zen-errors.js";
import { ZenProvider } from "../src/model/zen/zen-provider.js";

const defaultRequest = { reasoning: { mode: "provider-default" } as const, options: { temperature: 0.2 } };

function geminiBody(parts: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    responseId: "response-123",
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 1 },
    ...overrides,
  });
}

describe("Zen Google Generative", () => {
  it("maps normalized system, user, tools, and function names to Gemini", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(geminiBody([{ text: "Done" }]), { status: 200 }));
    const provider = new ZenProvider({ baseUrl: "https://zen.test/zen/v1/", apiKey: "test-key", model: "gemini-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [{ role: "system", content: "Be precise." }, { role: "user", content: "Look up a value." }],
      tools: [{ name: "demo.lookup", description: "Looks up a value.", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
    });

    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/models/gemini-test:generateContent", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json", authorization: "Bearer test-key", "x-goog-api-key": "test-key" }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      systemInstruction: { parts: [{ text: "Be precise." }] },
      contents: [{ role: "user", parts: [{ text: "Look up a value." }] }],
      tools: [{ functionDeclarations: [{ name: "demo_lookup", description: "Looks up a value.", parameters: { type: "object", properties: { id: { type: "string" } } } }] }],
    });
  });

  it("normalizes text, ordered function calls, finish reason, usage, and safe trace metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(geminiBody([
      { text: "I will check." },
      { functionCall: { id: "call-one", name: "first", args: { value: 1 } } },
      { functionCall: { id: "call-two", name: "second", args: { value: 2 } } },
    ], { candidates: [{ content: { role: "model", parts: [
      { text: "I will check." },
      { functionCall: { id: "call-one", name: "first", args: { value: 1 } } },
      { functionCall: { id: "call-two", name: "second", args: { value: 2 } } },
    ] }, finishReason: "STOP" }] }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gemini-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).resolves.toEqual({
      message: { role: "assistant", content: "I will check.", toolCalls: [
        { id: "call-one", name: "first", arguments: { value: 1 } },
        { id: "call-two", name: "second", arguments: { value: 2 } },
      ] },
      finishReason: "tool_calls",
      usage: { promptTokens: 12, completionTokens: 5 },
      providerMetadata: { provider: "zen", model: "gemini-test", protocol: "google-generative" },
    });
  });

  it("replays function call IDs, ordering, and required opaque thought signatures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(geminiBody([{ text: "The values are 42 and 7." }]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gemini-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [
        { role: "assistant", content: "", reasoning: { metadata: { zenGoogle: { protocol: "google-generative", thoughtSignatures: { "tool:call-abc": "signature-1" } } } }, toolCalls: [{ id: "call-abc", name: "first", arguments: { key: "one" } }, { id: "call-def", name: "second", arguments: { key: "two" } }] },
        { role: "tool", toolCallId: "call-abc", name: "first", content: "42" },
        { role: "tool", toolCallId: "call-def", name: "second", content: "7" },
      ],
      tools: [],
    });

    expect((JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { contents: unknown[] }).contents).toEqual([
      { role: "model", parts: [
        { functionCall: { id: "call-abc", name: "first", args: { key: "one" } }, thoughtSignature: "signature-1" },
        { functionCall: { id: "call-def", name: "second", args: { key: "two" } } },
      ] },
      { role: "user", parts: [{ functionResponse: { id: "call-abc", name: "first", response: { name: "first", content: "42" } } }] },
      { role: "user", parts: [{ functionResponse: { id: "call-def", name: "second", response: { name: "second", content: "7" } } }] },
    ]);
  });

  it("preserves returned thought signatures opaquely and restores namespaced MCP tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(geminiBody([
      { functionCall: { id: "call-mcp", name: "demo_lookup_demo_record", args: { key: "mcp" } }, thoughtSignature: "signature-1" },
    ]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gemini-test", fetch: fetchMock });

    await expect(provider.generate({
      ...defaultRequest,
      messages: [{ role: "user", content: "Use the demo MCP tool." }],
      tools: [{ name: "demo.lookup_demo_record", description: "Look up a demo record.", inputSchema: { type: "object" } }],
    })).resolves.toMatchObject({ message: {
      toolCalls: [{ id: "call-mcp", name: "demo.lookup_demo_record", arguments: { key: "mcp" } }],
      reasoning: { metadata: { zenGoogle: { protocol: "google-generative", thoughtSignatures: { "tool:call-mcp": "signature-1" } } } },
    } });
  });

  it("leaves provider-default untouched and rejects explicit unmappable reasoning", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(geminiBody([{ text: "ok" }]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gemini-test", fetch: fetchMock });

    await provider.generate({ ...defaultRequest, messages: [], tools: [] });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty("generationConfig.thinkingConfig");
    await expect(provider.generate({ ...defaultRequest, reasoning: { mode: "effort", effort: "high" }, messages: [], tools: [] })).rejects.toThrow("cannot map this explicit reasoning request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps authentication and transport failures without leaking credentials", async () => {
    const secret = "very-secret-key";
    const authProvider = new ZenProvider({ apiKey: secret, model: "gemini-test", fetch: vi.fn().mockResolvedValue(new Response(`Bearer ${secret}`, { status: 401 })) });
    await expect(authProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenAuthenticationError);
    const unavailableProvider = new ZenProvider({ apiKey: secret, model: "gemini-test", fetch: vi.fn().mockRejectedValue(new Error(`Bearer ${secret}`)) });
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toThrow("Could not reach OpenCode Zen");
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.not.toThrow(secret);
  });

  it("selects Gemini through the registry and keeps unknown Zen routes unsupported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(geminiBody([{ text: "ok" }]), { status: 200 }));
    const provider = providerRegistry.create({ provider: "zen", baseUrl: "https://zen.test/zen/v1", name: "gemini-test", modelRoutes: {} }, { fetch: fetchMock });
    await provider.generate({ ...defaultRequest, messages: [], tools: [] });
    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/models/gemini-test:generateContent", expect.any(Object));

    await expect(new ZenProvider({ apiKey: "test-key", model: "unrouted-test", fetch: vi.fn() }).generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenProviderError);
  });
});
