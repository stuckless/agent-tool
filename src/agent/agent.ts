import type { ConversationMessage, ModelProvider, ModelToolCall, ReasoningConfig, ToolResultMessage } from "../model/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolCatalog } from "../tools/catalog.js";
import { ToolExecutionError } from "../tools/types.js";
import type { Skill } from "../skills/loader.js";
import type { AgentTracer, AgentRunResult } from "./types.js";
import { StepLimitExceededError } from "./types.js";

export interface AgentOptions {
  model: ModelProvider;
  tools: ToolRegistry | ToolCatalog;
  systemPrompt: string;
  reasoning: ReasoningConfig;
  modelOptions: Record<string, unknown>;
  maxSteps?: number;
  tracer?: AgentTracer;
  skillCatalog?: Skill[];
}

export class Agent {
  private readonly maxSteps: number;

  constructor(private readonly options: AgentOptions) {
    this.maxSteps = options.maxSteps ?? 10;
    if (!Number.isInteger(this.maxSteps) || this.maxSteps < 1) {
      throw new Error("maxSteps must be a positive integer.");
    }
  }

  async run(prompt: string): Promise<AgentRunResult> {
    const messages: ConversationMessage[] = [
      { role: "system" as const, content: this.options.systemPrompt },
      { role: "user" as const, content: prompt },
    ];
    if (this.options.skillCatalog) {
      this.options.tracer?.trace({ type: "skill.catalog", skills: this.options.skillCatalog.map(({ name, description }) => ({ name, description })) });
    }
    const catalog = this.toolCatalog();
    this.options.tracer?.trace({ type: "tool.catalog", totalTools: catalog.allNames().length, availableTools: catalog.initialNames(), filtering: catalog.filteringEnabled() });

    for (let step = 1; step <= this.maxSteps; step += 1) {
      this.options.tracer?.trace({ type: "model.request", step, messages: structuredClone(messages) });
      const response = await this.options.model.chat({
        messages,
        tools: catalog.definitions(),
        reasoning: this.options.reasoning,
        options: this.options.modelOptions,
      });
      const toolCalls = response.message.toolCalls ?? [];
      this.options.tracer?.trace({
        type: "model.response",
        step,
        message: response.message,
        toolCalls: toolCalls.length,
        reasoningPresent: response.message.reasoning !== undefined,
      });

      messages.push(response.message);
      if (toolCalls.length === 0) {
        this.options.tracer?.trace({ type: "run.complete", step, answer: response.message.content });
        return { answer: response.message.content, steps: step, messages, finalMessage: response.message };
      }

      for (const toolCall of toolCalls) {
        messages.push(await this.executeToolCall(step, toolCall, catalog));
      }
    }

    throw new StepLimitExceededError(this.maxSteps);
  }

  private async executeToolCall(step: number, toolCall: ModelToolCall, catalog: ToolCatalog): Promise<ToolResultMessage> {
    this.options.tracer?.trace({ type: "tool.call", step, toolCall });
    const startedAt = Date.now();
    const tool = catalog.get(toolCall.name);
    let payload: unknown;
    let ok = false;

    if (!tool) {
      const type = catalog.isKnown(toolCall.name) ? "ToolUnavailable" : "UnknownTool";
      const message = type === "ToolUnavailable"
        ? `Tool ${toolCall.name} is not available in the current tool context. Search the tool catalog first.`
        : `No tool named ${toolCall.name} is available.`;
      payload = { ok: false, error: { type, message } };
    } else {
      try {
        payload = { ok: true, result: await tool.execute(toolCall.arguments) };
        ok = true;
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          payload = { ok: false, error: { type: error.type, message: error.message } };
        } else {
          payload = { ok: false, error: { type: "ToolExecutionError", message: "Tool execution failed." } };
        }
      }
    }

    const result: ToolResultMessage = {
      role: "tool",
      content: JSON.stringify(payload),
      toolCallId: toolCall.id,
      name: toolCall.name,
    };
    if (tool?.runtime?.kind === "search-tools" && ok && typeof toolCall.arguments.query === "string") {
      const discoveredTools = Array.isArray((payload as { result?: { tools?: unknown } }).result?.tools)
        ? ((payload as { result: { tools: Array<{ name: string }> } }).result.tools).map((entry) => entry.name)
        : [];
      this.options.tracer?.trace({ type: "tool.discovery", step, query: toolCall.arguments.query, discoveredTools });
    }
    this.options.tracer?.trace({
      type: "tool.result",
      step,
      toolCallId: toolCall.id,
      name: toolCall.name,
      ok,
      payload,
      durationMs: Date.now() - startedAt,
    });
    if (tool?.runtime?.kind === "load-skill") {
      const loaded = ok ? (payload as { result: { name?: unknown; alreadyLoaded?: unknown } }).result : undefined;
      this.options.tracer?.trace({
        type: "skill.load",
        step,
        name: typeof loaded?.name === "string" ? loaded.name : String(toolCall.arguments.name ?? ""),
        ok,
        ...(typeof loaded?.alreadyLoaded === "boolean" ? { alreadyLoaded: loaded.alreadyLoaded } : {}),
      });
    }
    return result;
  }

  private toolCatalog(): ToolCatalog {
    if ("allNames" in this.options.tools) return this.options.tools;
    const registry = this.options.tools;
    return {
      definitions: () => registry.definitions(), get: (name) => registry.get(name), isKnown: (name) => registry.get(name) !== undefined,
      isAvailable: (name) => registry.get(name) !== undefined, initialNames: () => registry.entries().map((tool) => tool.name),
      allNames: () => registry.entries().map((tool) => tool.name), filteringEnabled: () => false,
      search: () => ({ query: "", tools: [] }),
    };
  }
}
