export type MessageRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: MessageRole;
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  options: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface ModelProvider {
  chat(request: ModelRequest): Promise<ModelResponse>;
}
