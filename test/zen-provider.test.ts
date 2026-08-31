import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { ZenAuthenticationError, redactZenSecrets } from "../src/model/zen/zen-errors.js";
import { ZenProvider } from "../src/model/zen/zen-provider.js";

describe("ZenProvider", () => {
  it("maps the Zen model-list fixture into provider-neutral descriptors", async () => {
    const fixture = await readFile(new URL("./fixtures/zen-models.json", import.meta.url), "utf8");
    const fetchMock = vi.fn().mockResolvedValue(new Response(fixture, { status: 200 }));
    const provider = new ZenProvider({ baseUrl: "https://zen.test/zen/v1/", apiKey: "test-key", fetch: fetchMock });

    await expect(provider.listModels()).resolves.toEqual([
      { id: "gpt-test", provider: "zen", metadata: { ownedBy: "openai", created: 123 } },
      { id: "deepseek-test", provider: "zen", metadata: { ownedBy: "deepseek" } },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://zen.test/zen/v1/models", {
      method: "GET",
      headers: { authorization: "Bearer test-key" },
    });
  });

  it("fails before fetching when the API key is missing", async () => {
    const fetchMock = vi.fn();
    const provider = new ZenProvider({ apiKey: "", fetch: fetchMock });

    await expect(provider.listModels()).rejects.toThrow("Zen provider requires OPENCODE_ZEN_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 401 responses to a safe authentication error", async () => {
    const provider = new ZenProvider({ apiKey: "test-key", fetch: vi.fn().mockResolvedValue(new Response("Authorization: Bearer test-key", { status: 401 })) });

    await expect(provider.listModels()).rejects.toBeInstanceOf(ZenAuthenticationError);
    await expect(provider.listModels()).rejects.toThrow("Zen authentication failed");
  });

  it("redacts API keys and Authorization values from error text", () => {
    const secret = "very-secret-value";
    const message = redactZenSecrets(`request failed: Authorization: Bearer ${secret}; api_key=${secret}`, [secret]);

    expect(message).not.toContain(secret);
    expect(message).toContain("[REDACTED]");
  });
});
