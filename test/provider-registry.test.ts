import { describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../src/model/ollama/ollama-provider.js";
import { providerRegistry } from "../src/model/provider-registry.js";

describe("providerRegistry", () => {
  it("creates the configured Ollama provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 }));
    const provider = providerRegistry.create({ provider: "ollama", baseUrl: "http://ollama.test", name: "test-model" }, { fetch: fetchMock });

    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.id).toBe("ollama");
    await provider.generate({ messages: [], tools: [], reasoning: { mode: "provider-default" }, options: {} });
    expect(fetchMock).toHaveBeenCalledWith("http://ollama.test/api/chat", expect.any(Object));
  });
});
