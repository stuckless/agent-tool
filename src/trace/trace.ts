import { createHash } from "node:crypto";

import type { AgentTraceEvent, AgentTracer } from "../agent/types.js";
import type { ReasoningConfig } from "../model/types.js";
import type { Skill } from "../skills/loader.js";
import type { AgentTool } from "../tools/types.js";

export interface TraceOptions {
  model: string;
  reasoning: ReasoningConfig;
  modelOptions: Record<string, unknown>;
  promptPath: string;
  promptContent: string;
  skills: Skill[];
  tools: AgentTool[];
  showThinking: boolean;
  secretValues?: string[];
  now?: () => number;
}

interface TraceEventRecord {
  type: string;
  step: number;
  atMs: number;
  [key: string]: unknown;
}

export interface JsonTrace {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  model: string;
  reasoningConfig: ReasoningConfig;
  modelOptions: Record<string, unknown>;
  systemPrompt: { path: string; sha256: string };
  skills: Array<{ name: string; description: string; tags: string[]; path: string }>;
  tools: Array<{ name: string; description: string; source: "local" | "mcp" | "runtime"; mcpServer?: string }>;
  steps: TraceEventRecord[];
  finalAnswer?: string;
  status: "running" | "completed" | "error";
  error?: string;
}

export class TraceRecorder implements AgentTracer {
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private readonly runTrace: JsonTrace;
  private readonly secretValues: string[];

  constructor(options: TraceOptions) {
    this.now = options.now ?? Date.now;
    this.secretValues = options.secretValues ?? [];
    this.startedAtMs = this.now();
    this.runTrace = {
      startedAt: new Date(this.startedAtMs).toISOString(),
      model: options.model,
      reasoningConfig: options.reasoning,
      modelOptions: this.redact(options.modelOptions) as Record<string, unknown>,
      systemPrompt: { path: options.promptPath, sha256: sha256(options.promptContent) },
      skills: options.skills.map((skill) => ({ name: skill.name, description: skill.description, tags: skill.tags, path: skill.path })),
      tools: options.tools.map(toTraceTool),
      steps: [],
      status: "running",
    };
    this.showThinking = options.showThinking;
  }

  private readonly showThinking: boolean;

  trace(event: AgentTraceEvent): void {
    const atMs = this.now() - this.startedAtMs;
    switch (event.type) {
      case "skill.catalog":
        this.runTrace.steps.push({ type: event.type, step: 0, atMs, skills: event.skills });
        return;
      case "skill.load":
        this.runTrace.steps.push({ type: event.type, step: event.step, atMs, name: event.name, ok: event.ok, ...(event.alreadyLoaded === undefined ? {} : { alreadyLoaded: event.alreadyLoaded }) });
        return;
      case "tool.catalog":
        this.runTrace.steps.push({ type: event.type, step: 0, atMs, totalTools: event.totalTools, availableTools: event.availableTools, filtering: event.filtering });
        return;
      case "tool.discovery":
        this.runTrace.steps.push({ type: event.type, step: event.step, atMs, query: this.redact(event.query), discoveredTools: event.discoveredTools });
        return;
      case "model.request":
        this.runTrace.steps.push({ type: event.type, step: event.step, atMs });
        return;
      case "model.response": {
        const thinking = event.message.reasoning?.text;
        this.runTrace.steps.push({
          type: event.type,
          step: event.step,
          atMs,
          toolCalls: event.toolCalls,
          content: this.redact(event.message.content),
          reasoning: {
            exposed: event.reasoningPresent,
            ...(thinking === undefined ? {} : { characters: thinking.length }),
            ...(this.showThinking && thinking !== undefined ? { text: this.redact(thinking) } : {}),
          },
        });
        return;
      }
      case "tool.call":
        this.runTrace.steps.push({ type: event.type, step: event.step, atMs, tool: event.toolCall.name, arguments: this.redact(event.toolCall.arguments) });
        return;
      case "tool.result":
        this.runTrace.steps.push({
          type: event.type,
          step: event.step,
          atMs,
          tool: event.name,
          toolCallId: event.toolCallId,
          ok: event.ok,
          durationMs: event.durationMs,
          result: this.redact(event.payload),
          resultCharacters: JSON.stringify(event.payload).length,
        });
        return;
      case "run.complete":
        this.runTrace.steps.push({ type: event.type, step: event.step, atMs });
        this.runTrace.finalAnswer = this.redact(event.answer) as string;
        this.runTrace.status = "completed";
        this.complete();
    }
  }

  fail(error: unknown): void {
    if (this.runTrace.status !== "running") return;
    this.runTrace.status = "error";
    this.runTrace.error = error instanceof Error ? error.message : "Unexpected error.";
    this.complete();
  }

  toJson(): JsonTrace {
    return structuredClone(this.runTrace);
  }

  toHuman(): string {
    const trace = this.runTrace;
    const lines = [
      "Run",
      `  model: ${trace.model}`,
      `  prompt: ${trace.systemPrompt.path}`,
      `  skills: ${trace.skills.length === 0 ? "none" : trace.skills.map((skill) => skill.name).join(", ")}`,
      `  tools: ${trace.tools.length === 0 ? "none" : trace.tools.map((tool) => tool.name).join(", ")}`,
      `  reasoning: ${formatReasoning(trace.reasoningConfig)}`,
    ];
    for (const event of trace.steps) lines.push(...formatEvent(event));
    if (trace.status === "completed") lines.push("", `Completed: ${trace.finalAnswer ?? ""}`);
    if (trace.status === "error") lines.push("", `Error: ${trace.error ?? "Unexpected error."}`);
    return lines.join("\n");
  }

  private complete(): void {
    const completedAtMs = this.now();
    this.runTrace.completedAt = new Date(completedAtMs).toISOString();
    this.runTrace.durationMs = completedAtMs - this.startedAtMs;
  }

  private redact(value: unknown): unknown {
    return redact(value, this.secretValues);
  }
}

function toTraceTool(tool: AgentTool): JsonTrace["tools"][number] {
  const mcp = "mcp" in tool ? tool.mcp as { serverName: string } : undefined;
  return { name: tool.name, description: tool.description, source: mcp ? "mcp" : tool.runtime ? "runtime" : "local", ...(mcp ? { mcpServer: mcp.serverName } : {}) };
}

function formatEvent(event: TraceEventRecord): string[] {
  const heading = `\nStep ${event.step}`;
  if (event.type === "skill.catalog") return ["\nSkill catalog", ...((event.skills as Array<{ name: string; description: string }>).map((skill) => `  ${skill.name}: ${skill.description}`))];
  if (event.type === "skill.load") return [heading, `  skill → ${event.ok ? "loaded" : "failed"}: ${event.name}${event.alreadyLoaded ? " (already loaded)" : ""}`];
  if (event.type === "tool.catalog") return ["\nTool catalog", `  filtering: ${event.filtering ? "enabled" : "disabled"}`, `  available: ${(event.availableTools as string[]).join(", ") || "none"}`, `  total registered: ${event.totalTools}`];
  if (event.type === "tool.discovery") return [heading, `  tool search: ${event.query}`, `  discovered: ${(event.discoveredTools as string[]).join(", ") || "none"}`];
  if (event.type === "model.request") return [heading, "  model → request"];
  if (event.type === "model.response") {
    const reasoning = event.reasoning as { exposed: boolean; characters?: number; text?: string };
    const lines = [heading, `  model → ${(event.toolCalls as number) > 0 ? "tool call" : "final answer"}`];
    lines.push(`  thinking exposed: ${reasoning.exposed ? `yes${reasoning.characters === undefined ? "" : ` (${reasoning.characters} chars)`}` : "no"}`);
    if (reasoning.text !== undefined) lines.push(`  thinking: ${reasoning.text}`);
    if ((event.content as string).length > 0) lines.push(`  content: ${event.content}`);
    return lines;
  }
  if (event.type === "tool.call") return [heading, "  tool → call", `  tool: ${event.tool}`, `  args: ${JSON.stringify(event.arguments)}`];
  if (event.type === "tool.result") return [heading, `  tool → ${event.ok ? "success" : "failure"}`, `  tool: ${event.tool}`, `  duration: ${event.durationMs} ms`, `  result: ${JSON.stringify(event.result)}`];
  return [heading, "  run → complete"];
}

function formatReasoning(reasoning: ReasoningConfig): string {
  return reasoning.mode === "effort" ? reasoning.effort : reasoning.mode;
}

const secretName = /(?:api[-_]?key|authorization|cookie|password|secret|token)/i;

export function redact(value: unknown, secretValues: string[] = []): unknown {
  if (typeof value === "string" && secretValues.includes(value)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redact(entry, secretValues));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, secretName.test(key) ? "[REDACTED]" : redact(entry, secretValues)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
