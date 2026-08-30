import type { ConversationMessage, ModelProvider, ModelToolCall, ReasoningConfig, ToolResultMessage } from "../model/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutionError } from "../tools/types.js";
import type { Skill } from "../skills/loader.js";
import type { AgentTracer, AgentRunResult } from "./types.js";
import { StepLimitExceededError } from "./types.js";

export interface AgentOptions {
  model: ModelProvider;
  tools: ToolRegistry;
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

    for (let step = 1; step <= this.maxSteps; step += 1) {
      this.options.tracer?.trace({ type: "model.request", step });
      const response = await this.options.model.chat({
        messages,
        tools: this.options.tools.definitions(),
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
        messages.push(await this.executeToolCall(step, toolCall));
      }
    }

    throw new StepLimitExceededError(this.maxSteps);
  }

  private async executeToolCall(step: number, toolCall: ModelToolCall): Promise<ToolResultMessage> {
    this.options.tracer?.trace({ type: "tool.call", step, toolCall });
    const startedAt = Date.now();
    const tool = this.options.tools.get(toolCall.name);
    let payload: unknown;
    let ok = false;

    if (!tool) {
      payload = { ok: false, error: { type: "UnknownTool", message: `No tool named ${toolCall.name} is available.` } };
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
}
