import type { AssistantMessage, ConversationMessage, ModelToolCall } from "../model/types.js";
import type { Skill } from "../skills/loader.js";

export type AgentTraceEvent =
  | { type: "skill.catalog"; skills: Array<Pick<Skill, "name" | "description">> }
  | { type: "skill.load"; step: number; name: string; ok: boolean; alreadyLoaded?: boolean }
  | { type: "tool.catalog"; totalTools: number; availableTools: string[]; filtering: boolean }
  | { type: "tool.discovery"; step: number; query: string; discoveredTools: string[] }
  | { type: "model.request"; step: number; messages?: ConversationMessage[] }
  | {
      type: "model.response";
      step: number;
      message: AssistantMessage;
      toolCalls: number;
      reasoningPresent: boolean;
    }
  | { type: "tool.call"; step: number; toolCall: ModelToolCall }
  | { type: "tool.result"; step: number; toolCallId: string; name: string; ok: boolean; payload: unknown; durationMs: number }
  | { type: "run.complete"; step: number; answer: string };

export interface AgentTracer {
  trace(event: AgentTraceEvent): void;
}

export interface AgentRunResult {
  answer: string;
  steps: number;
  messages: ConversationMessage[];
  finalMessage: AssistantMessage;
}

export class StepLimitExceededError extends Error {
  constructor(readonly maxSteps: number) {
    super(`Agent reached the maximum of ${maxSteps} model steps.`);
    this.name = "StepLimitExceededError";
  }
}
