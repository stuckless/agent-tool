import { describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../src/model/ollama.js";

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

    const response = await provider.chat({
      messages: [{ role: "user", content: "What is a work order?" }],
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
      text: "A work order tracks requested work.",
      finishReason: "stop",
      usage: { promptTokens: 12, completionTokens: 8 },
    });
  });

  it("reports HTTP failures without exposing a response body", async () => {
    const provider = new OllamaProvider({
      baseUrl: "http://ollama.test",
      model: "test-model",
      fetch: vi.fn().mockResolvedValue(new Response("sensitive server details", { status: 500 })),
    });

    await expect(provider.chat({ messages: [], options: {} })).rejects.toThrow("HTTP 500");
  });
});
