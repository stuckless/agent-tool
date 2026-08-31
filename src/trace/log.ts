import type { AgentTraceEvent, AgentTracer } from "../agent/types.js";
import type { ConversationMessage, ModelMessage } from "../model/types.js";
import { redact } from "./trace.js";

export interface LiveLogOptions {
  showThinking: boolean;
  secretValues?: string[];
  write?: (line: string) => void;
}

/** Writes a compact, color-coded view of agent events as they happen. */
export class LiveLogger implements AgentTracer {
  private readonly write: (line: string) => void;
  private readonly secretValues: string[];

  constructor(private readonly options: LiveLogOptions) {
    this.write = options.write ?? ((line) => process.stderr.write(`${line}\n`));
    this.secretValues = options.secretValues ?? [];
  }

  trace(event: AgentTraceEvent): void {
    switch (event.type) {
      case "model.request":
        this.print("cyan", `→ ASSISTANT  step ${event.step}`, event.messages === undefined ? undefined : { messages: this.messagesForLog(event.messages) });
        return;
      case "model.response":
        this.print("yellow", `← ASSISTANT  step ${event.step}`, this.messageForLog(event.message));
        return;
      case "tool.call":
        this.print("magenta", `→ TOOL       ${event.toolCall.name}`, { id: event.toolCall.id, arguments: this.safe(event.toolCall.arguments) });
        return;
      case "tool.result":
        this.print(event.ok ? "green" : "red", `← TOOL       ${event.name} ${event.ok ? "ok" : "failed"} (${event.durationMs} ms)`, this.safe(event.payload));
        return;
      case "tool.discovery":
        this.print("blue", `TOOL SEARCH  step ${event.step}`, { query: this.safe(event.query), discoveredTools: event.discoveredTools });
        return;
      case "skill.load":
        this.print(event.ok ? "green" : "red", `SKILL        ${event.name} ${event.ok ? "loaded" : "failed"}`);
        return;
      case "run.complete":
        this.print("green", `COMPLETE     step ${event.step}`);
        return;
      default:
        return;
    }
  }

  fail(error: unknown): void {
    this.print("red", "ERROR", error instanceof Error ? error.message : "Unexpected error.");
  }

  private messagesForLog(messages: ConversationMessage[]): unknown {
    return messages.map((message) => this.messageForLog(message));
  }

  private messageForLog(message: ModelMessage): unknown {
    const { reasoning, ...rest } = message;
    return this.safe({
      ...rest,
      ...(reasoning === undefined ? {} : {
        reasoning: this.options.showThinking
          ? { ...(reasoning.text === undefined ? {} : { text: reasoning.text }), ...(reasoning.metadata === undefined ? {} : { opaqueState: true }) }
          : { exposed: true, ...(reasoning.text === undefined ? {} : { characters: reasoning.text.length }) },
      }),
    });
  }

  private safe(value: unknown): unknown {
    return redact(value, this.secretValues);
  }

  private print(color: Color, heading: string, payload?: unknown): void {
    const suffix = payload === undefined ? "" : `\n${JSON.stringify(payload, null, 2)}`;
    this.write(`${ansi[color]}${heading}${ansi.reset}${suffix}`);
  }
}

type Color = "cyan" | "yellow" | "magenta" | "green" | "red" | "blue";

const ansi: Record<Color | "reset", string> = {
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  magenta: "\u001b[35m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  blue: "\u001b[34m",
  reset: "\u001b[0m",
};
