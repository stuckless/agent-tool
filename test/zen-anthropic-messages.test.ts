import { describe, expect, it, vi } from "vitest";

import { providerRegistry } from "../src/model/provider-registry.js";
import { ZenAuthenticationError, ZenProviderError } from "../src/model/zen/zen-errors.js";
import { ZenProvider } from "../src/model/zen/zen-provider.js";

const defaultRequest = {
  reasoning: { mode: "provider-default" } as const,
  options: { temperature: 0.2 },
};

function messagesBody(content: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "msg-123",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content,
    stop_reason: "end_turn",
    usage: { input_tokens: 12, output_tokens: 4 },
    ...overrides,
  });
}

describe("Zen Anthropic Messages", () => {
  it("maps normalized messages and tools to the Messages request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([{ type: "text", text: "Done" }]), { status: 200 }));
    const provider = new ZenProvider({ baseUrl: "https://zen.test/zen/v1/", apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [{ role: "system", content: "Be precise." }, { role: "user", content: "Look up a value." }],
      tools: [{ name: "lookup", description: "Looks up a value.", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
    });

    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/messages", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json", authorization: "Bearer test-key", "x-api-key": "test-key" }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      model: "claude-test",
      system: [{ type: "text", text: "Be precise." }],
      messages: [{ role: "user", content: [{ type: "text", text: "Look up a value." }] }],
      tools: [{ name: "lookup", description: "Looks up a value.", input_schema: { type: "object", properties: { id: { type: "string" } } } }],
    });
  });

  it("normalizes text, ordered tool uses, finish reason, usage, and safe trace metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([
      { type: "text", text: "I will check." },
      { type: "tool_use", id: "call-one", name: "first", input: { value: 1 } },
      { type: "tool_use", id: "call-two", name: "second", input: { value: 2 } },
    ], { stop_reason: "tool_use", usage: { input_tokens: 12, output_tokens: 4, output_tokens_details: { thinking_tokens: 1 } } }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).resolves.toEqual({
      message: { role: "assistant", content: "I will check.", toolCalls: [
        { id: "call-one", name: "first", arguments: { value: 1 } },
        { id: "call-two", name: "second", arguments: { value: 2 } },
      ] },
      finishReason: "tool_calls",
      usage: { promptTokens: 12, completionTokens: 4 },
      providerMetadata: { provider: "zen", model: "claude-test", protocol: "anthropic-messages" },
    });
  });

  it("replays opaque thinking state, tool-use IDs, and ordered tool results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([{ type: "text", text: "The values are 42 and 7." }]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [
        { role: "assistant", content: "", reasoning: { metadata: { zenAnthropic: { protocol: "anthropic-messages", thinking: [{ text: "opaque thought", signature: "signature-1" }] } } }, toolCalls: [{ id: "call-abc", name: "first", arguments: { key: "one" } }, { id: "call-def", name: "second", arguments: { key: "two" } }] },
        { role: "tool", toolCallId: "call-abc", name: "first", content: "42" },
        { role: "tool", toolCallId: "call-def", name: "second", content: "7" },
      ],
      tools: [],
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: "assistant", content: [
        { type: "thinking", thinking: "opaque thought", signature: "signature-1" },
        { type: "tool_use", id: "call-abc", name: "first", input: { key: "one" } },
        { type: "tool_use", id: "call-def", name: "second", input: { key: "two" } },
      ] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "call-abc", content: "42" },
        { type: "tool_result", tool_use_id: "call-def", content: "7" },
      ] },
    ]);
  });

  it("preserves returned thinking blocks as opaque continuation metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([
      { type: "thinking", thinking: "provider thought", signature: "signature-1" },
      { type: "tool_use", id: "call-one", name: "lookup", input: { key: "answer" } },
    ], { stop_reason: "tool_use" }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).resolves.toMatchObject({
      message: {
        toolCalls: [{ id: "call-one", name: "lookup", arguments: { key: "answer" } }],
        reasoning: { metadata: { zenAnthropic: { protocol: "anthropic-messages", thinking: [{ text: "provider thought", signature: "signature-1" }] } } },
      },
    });
  });

  it("maps documented disabled thinking and rejects unmappable explicit reasoning", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([{ type: "text", text: "ok" }]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await provider.generate({ ...defaultRequest, reasoning: { mode: "disabled" }, messages: [], tools: [] });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ thinking: { type: "disabled" } });
    await expect(provider.generate({ ...defaultRequest, reasoning: { mode: "effort", effort: "high" }, messages: [], tools: [] })).rejects.toThrow("cannot map this explicit reasoning request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps namespaced MCP tool names to an Anthropic-safe name and restores them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([{ type: "tool_use", id: "call-mcp", name: "demo_lookup_demo_record", input: { key: "mcp" } }], { stop_reason: "tool_use" }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await expect(provider.generate({
      ...defaultRequest,
      messages: [{ role: "user", content: "Use the demo MCP tool." }],
      tools: [{ name: "demo.lookup_demo_record", description: "Look up a demo record.", inputSchema: { type: "object" } }],
    })).resolves.toMatchObject({ message: { toolCalls: [{ id: "call-mcp", name: "demo.lookup_demo_record", arguments: { key: "mcp" } }] } });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ tools: [{ name: "demo_lookup_demo_record" }] });
  });

  it("maps authentication and transport failures without leaking credentials", async () => {
    const secret = "very-secret-key";
    const authProvider = new ZenProvider({ apiKey: secret, model: "claude-test", fetch: vi.fn().mockResolvedValue(new Response(`Authorization: Bearer ${secret}`, { status: 401 })) });
    await expect(authProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenAuthenticationError);

    const unavailableProvider = new ZenProvider({ apiKey: secret, model: "claude-test", fetch: vi.fn().mockRejectedValue(new Error(`Bearer ${secret}`)) });
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toThrow("Could not reach OpenCode Zen");
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.not.toThrow(secret);
  });

  it("selects the Anthropic Messages adapter through the provider registry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(messagesBody([{ type: "text", text: "ok" }]), { status: 200 }));
    const provider = providerRegistry.create({ provider: "zen", baseUrl: "https://zen.test/zen/v1", name: "claude-test", modelRoutes: {} }, { fetch: fetchMock });

    await provider.generate({ ...defaultRequest, messages: [], tools: [] });
    expect(provider.id).toBe("zen");
    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/messages", expect.any(Object));
  });

  it("fails clearly for an unsupported Zen protocol", async () => {
    const fetchMock = vi.fn();
    const provider = new ZenProvider({ apiKey: "test-key", model: "gemini-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toEqual(expect.objectContaining({
      name: "ZenProviderError",
      message: expect.stringContaining("routed to google-generative"),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose invalid provider response details", async () => {
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 })) });
    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenProviderError);
  });
});
