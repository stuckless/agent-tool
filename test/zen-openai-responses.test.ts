import { describe, expect, it, vi } from "vitest";

import { providerRegistry } from "../src/model/provider-registry.js";
import { ZenAuthenticationError, ZenProviderError } from "../src/model/zen/zen-errors.js";
import { ZenProvider } from "../src/model/zen/zen-provider.js";

const defaultRequest = {
  reasoning: { mode: "provider-default" } as const,
  options: { temperature: 0.2 },
};

function responsesBody(output: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "resp-123",
    object: "response",
    created_at: 1,
    model: "gpt-test",
    status: "completed",
    output,
    usage: { input_tokens: 12, output_tokens: 4, output_tokens_details: { reasoning_tokens: 1 } },
    ...overrides,
  });
}

describe("Zen OpenAI Responses", () => {
  it("maps normalized messages and tools to the Responses request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(responsesBody([{ type: "message", id: "msg-1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done", annotations: [] }] }]), { status: 200 }));
    const provider = new ZenProvider({ baseUrl: "https://zen.test/zen/v1/", apiKey: "test-key", model: "gpt-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [{ role: "system", content: "Be precise." }, { role: "user", content: "Look up a value." }],
      tools: [{ name: "lookup", description: "Looks up a value.", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
    });

    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/responses", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json", authorization: "Bearer test-key" }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      model: "gpt-test",
      temperature: 0.2,
      input: [
        { role: "system", content: "Be precise." },
        { role: "user", content: [{ type: "input_text", text: "Look up a value." }] },
      ],
      tools: [{ type: "function", name: "lookup", description: "Looks up a value.", parameters: { type: "object", properties: { id: { type: "string" } } } }],
    });
  });

  it("normalizes text, ordered tool calls, finish reason, usage, and safe trace metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(responsesBody([
      { type: "message", id: "msg-1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "I will check.", annotations: [] }] },
      { type: "function_call", id: "fc-one", call_id: "call-one", name: "first", arguments: "{\"value\":1}", status: "completed" },
      { type: "function_call", id: "fc-two", call_id: "call-two", name: "second", arguments: "{\"value\":2}", status: "completed" },
    ]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gpt-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).resolves.toEqual(expect.objectContaining({
      message: expect.objectContaining({
        role: "assistant",
        content: "I will check.",
        toolCalls: [
          { id: "call-one", name: "first", arguments: { value: 1 } },
          { id: "call-two", name: "second", arguments: { value: 2 } },
        ],
        reasoning: { metadata: { zenResponses: { protocol: "openai-responses", responseId: "resp-123", itemIds: { "text:0": "msg-1", "tool:call-one": "fc-one", "tool:call-two": "fc-two" } } } },
      }),
      finishReason: "tool_calls",
      usage: { promptTokens: 12, completionTokens: 4 },
      providerMetadata: { provider: "zen", model: "gpt-test", protocol: "openai-responses" },
    }));
  });

  it("maps namespaced MCP tool names to a Responses-safe name and restores them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(responsesBody([
      { type: "function_call", id: "fc-mcp", call_id: "call-mcp", name: "demo_lookup_demo_record", arguments: "{\"key\":\"mcp\"}", status: "completed" },
    ]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gpt-test", fetch: fetchMock });

    await expect(provider.generate({
      ...defaultRequest,
      messages: [{ role: "user", content: "Use the demo MCP tool." }],
      tools: [{ name: "demo.lookup_demo_record", description: "Look up a demo record.", inputSchema: { type: "object" } }],
    })).resolves.toMatchObject({ message: { toolCalls: [{ id: "call-mcp", name: "demo.lookup_demo_record", arguments: { key: "mcp" } }] } });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ tools: [{ name: "demo_lookup_demo_record" }] });
  });

  it("replays opaque response state and tool-call IDs for a tool-result continuation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(responsesBody([{ type: "message", id: "msg-final", role: "assistant", status: "completed", content: [{ type: "output_text", text: "The value is 42.", annotations: [] }] }], { id: "resp-final" }), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gpt-test", fetch: fetchMock });

    await provider.generate({
      ...defaultRequest,
      messages: [
        { role: "assistant", content: "", reasoning: { metadata: { zenResponses: { protocol: "openai-responses", responseId: "resp-prior", itemIds: { "tool:call-abc": "fc-abc" } } } }, toolCalls: [{ id: "call-abc", name: "lookup", arguments: { key: "answer" } }] },
        { role: "tool", toolCallId: "call-abc", name: "lookup", content: "42" },
      ],
      tools: [],
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { previous_response_id?: string; input: unknown[] };
    expect(body.previous_response_id).toBe("resp-prior");
    expect(body.input).toEqual([{ type: "function_call_output", call_id: "call-abc", output: "42" }]);
  });

  it("keeps reasoning provider-default and fails clearly for explicit unmappable requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(responsesBody([{ type: "message", id: "msg-1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] }]), { status: 200 }));
    const provider = new ZenProvider({ apiKey: "test-key", model: "gpt-test", fetch: fetchMock });

    await provider.generate({ ...defaultRequest, messages: [], tools: [] });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty("reasoning");
    await expect(provider.generate({ ...defaultRequest, reasoning: { mode: "effort", effort: "high" }, messages: [], tools: [] })).rejects.toThrow("cannot map an explicit reasoning request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps authentication and transport failures without leaking credentials", async () => {
    const secret = "very-secret-key";
    const authProvider = new ZenProvider({ apiKey: secret, model: "gpt-test", fetch: vi.fn().mockResolvedValue(new Response(`Authorization: Bearer ${secret}`, { status: 401 })) });
    await expect(authProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenAuthenticationError);

    const unavailableProvider = new ZenProvider({ apiKey: secret, model: "gpt-test", fetch: vi.fn().mockRejectedValue(new Error(`Bearer ${secret}`)) });
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toThrow("Could not reach OpenCode Zen");
    await expect(unavailableProvider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.not.toThrow(secret);
  });

  it("selects the Responses adapter through the provider registry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(responsesBody([{ type: "message", id: "msg-1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] }]), { status: 200 }));
    const provider = providerRegistry.create({ provider: "zen", baseUrl: "https://zen.test/zen/v1", name: "gpt-test", modelRoutes: {} }, { fetch: fetchMock });

    await provider.generate({ ...defaultRequest, messages: [], tools: [] });
    expect(provider.id).toBe("zen");
    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/responses", expect.any(Object));
  });

  it("fails clearly for Zen protocols without an implemented adapter", async () => {
    const fetchMock = vi.fn();
    const provider = new ZenProvider({ apiKey: "test-key", model: "claude-test", fetch: fetchMock });

    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toEqual(expect.objectContaining({
      name: "ZenProviderError",
      message: expect.stringContaining("routed to anthropic-messages"),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose invalid Responses response details", async () => {
    const provider = new ZenProvider({ apiKey: "test-key", model: "gpt-test", fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [] }), { status: 200 })) });
    await expect(provider.generate({ ...defaultRequest, messages: [], tools: [] })).rejects.toBeInstanceOf(ZenProviderError);
  });
});
