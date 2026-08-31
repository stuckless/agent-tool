import { describe, expect, it } from "vitest";

import { resolveZenProtocol } from "../src/model/zen/zen-protocol-router.js";

describe("resolveZenProtocol", () => {
  it.each([
    ["gpt-5.6-sol", "openai-responses"],
    ["grok-4", "openai-responses"],
    ["muse-spark-pro", "openai-responses"],
    ["claude-sonnet-5", "anthropic-messages"],
    ["qwen3.5-plus", "anthropic-messages"],
    ["qwen3-next", "anthropic-messages"],
    ["deepseek-v4-flash", "openai-chat"],
    ["minimax-m2", "openai-chat"],
    ["glm-5", "openai-chat"],
    ["kimi-k2", "openai-chat"],
    ["big-pickle", "openai-chat"],
    ["mimo-v2", "openai-chat"],
    ["ling-1", "openai-chat"],
    ["nemotron-3", "openai-chat"],
    ["gemini-3.7-flash", "google-generative"],
  ] as const)("routes %s to %s", (modelId, protocol) => {
    expect(resolveZenProtocol(modelId)).toBe(protocol);
  });

  it("gives configured routes precedence over documented families", () => {
    expect(resolveZenProtocol("gpt-5.6-sol", { "gpt-5.6-sol": "openai-chat" })).toBe("openai-chat");
  });

  it("returns undefined for an unroutable model", () => {
    expect(resolveZenProtocol("new-model-x")).toBeUndefined();
  });

  it("does not let partial family names collide", () => {
    expect(resolveZenProtocol("qwen3x-next")).toBeUndefined();
    expect(resolveZenProtocol("big-pickle-extra")).toBeUndefined();
    expect(resolveZenProtocol("qwen3-next")).toBe("anthropic-messages");
  });
});
