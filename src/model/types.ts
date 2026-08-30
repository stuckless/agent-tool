export type MessageRole = "system" | "user" | "assistant" | "tool";

export type ReasoningConfig =
  | { mode: "provider-default" }
  | { mode: "disabled" }
  | { mode: "enabled" }
  | { mode: "effort"; effort: "low" | "medium" | "high" | "max" };

export interface ReasoningPayload {
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelMessage {
  role: MessageRole;
  content: string;
  reasoning?: ReasoningPayload;
}

export interface AssistantMessage extends ModelMessage {
  role: "assistant";
  toolCalls?: ModelToolCall[];
}

export interface ToolResultMessage extends ModelMessage {
  role: "tool";
  toolCallId: string;
  name: string;
}

export type ConversationMessage = ModelMessage | ToolResultMessage;

export interface ModelRequest {
  messages: ConversationMessage[];
  tools: ModelToolDefinition[];
  reasoning: ReasoningConfig;
  options: Record<string, unknown>;
}

export interface ModelResponse {
  message: AssistantMessage;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface ModelProvider {
  chat(request: ModelRequest): Promise<ModelResponse>;
}
