import type { AssistantMessage, ConversationMessage, ModelToolCall } from "../model/types.js";

export type AgentTraceEvent =
  | { type: "model.request"; step: number }
  | { type: "model.response"; step: number; toolCalls: number; reasoningPresent: boolean }
  | { type: "tool.call"; step: number; toolCall: ModelToolCall }
  | { type: "tool.result"; step: number; toolCallId: string; name: string; ok: boolean }
  | { type: "run.complete"; step: number };

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
