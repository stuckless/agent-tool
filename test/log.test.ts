import { describe, expect, it } from "vitest";

import { LiveLogger } from "../src/trace/log.js";

describe("LiveLogger", () => {
  it("writes color-coded, redacted live model and tool events", () => {
    const lines: string[] = [];
    const logger = new LiveLogger({ showThinking: false, secretValues: ["configured-secret"], write: (line) => lines.push(line) });

    logger.trace({ type: "model.request", step: 1, messages: [{ role: "user", content: "Find the value." }] });
    logger.trace({ type: "model.response", step: 1, toolCalls: 1, reasoningPresent: true, message: { role: "assistant", content: "", reasoning: { text: "private reasoning" }, toolCalls: [{ id: "call-1", name: "echo", arguments: { apiKey: "secret" } }] } });
    logger.trace({ type: "tool.call", step: 1, toolCall: { id: "call-1", name: "echo", arguments: { apiKey: "secret" } } });
    logger.trace({ type: "tool.result", step: 1, toolCallId: "call-1", name: "echo", ok: true, payload: { value: "configured-secret" }, durationMs: 7 });

    expect(lines.join("\n")).toContain("\u001b[36m→ ASSISTANT");
    expect(lines.join("\n")).toContain("\u001b[35m→ TOOL");
    expect(lines.join("\n")).toContain("\u001b[32m← TOOL");
    expect(lines.join("\n")).toContain("[REDACTED]");
    expect(lines.join("\n")).not.toContain("private reasoning");
  });
});
