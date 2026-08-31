import type { ModelProvider } from "../model-provider.js";
import type {
  AssistantMessage,
  ConversationMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelToolDefinition,
  ReasoningConfig,
} from "../model-types.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}

interface OllamaChatResponse {
  message?: {
    content?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
  };
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama" as const;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    let response: Response;

    try {
      response = await this.fetchImplementation(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages.map(toOllamaMessage),
          options: request.options,
          stream: false,
          ...(request.tools.length > 0 ? { tools: request.tools.map(toOllamaTool) } : {}),
          ...toOllamaReasoning(request.reasoning),
        }),
      });
    } catch {
      throw new Error(`Could not reach Ollama at ${this.baseUrl}.`);
    }

    if (!response.ok) throw new Error(`Ollama request failed with HTTP ${response.status}.`);

    const responseBody = (await response.json()) as OllamaChatResponse;
    if (typeof responseBody.message?.content !== "string") throw new Error("Ollama returned an invalid chat response.");

    return {
      message: {
        role: "assistant",
        content: responseBody.message.content,
        toolCalls: parseToolCalls(responseBody.message.tool_calls),
        reasoning: typeof responseBody.message.thinking === "string" ? { text: responseBody.message.thinking } : undefined,
      },
      finishReason: typeof responseBody.done_reason === "string" ? responseBody.done_reason : undefined,
      usage: { promptTokens: toNumber(responseBody.prompt_eval_count), completionTokens: toNumber(responseBody.eval_count) },
    };
  }
}

function toOllamaMessage(message: ConversationMessage): Record<string, unknown> {
  const assistantMessage = message.role === "assistant" ? (message as AssistantMessage) : undefined;
  return {
    role: message.role,
    content: message.content,
    ...(message.reasoning?.text ? { thinking: message.reasoning.text } : {}),
    ...(assistantMessage?.toolCalls ? { tool_calls: assistantMessage.toolCalls.map((toolCall) => ({ function: { name: toolCall.name, arguments: toolCall.arguments } })) } : {}),
  };
}

function toOllamaTool(tool: ModelToolDefinition): Record<string, unknown> {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
}

function parseToolCalls(value: unknown): ModelToolCall[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Ollama returned invalid tool calls.");
  return value.map((toolCall, index) => {
    if (!isRecord(toolCall) || !isRecord(toolCall.function) || typeof toolCall.function.name !== "string") throw new Error("Ollama returned invalid tool calls.");
    return {
      id: typeof toolCall.id === "string" && toolCall.id.length > 0 ? toolCall.id : `ollama-call-${index + 1}`,
      name: toolCall.function.name,
      arguments: parseToolArguments(toolCall.function.arguments),
    };
  });
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Report the same safe provider error below.
    }
  }
  throw new Error("Ollama returned invalid tool call arguments.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOllamaReasoning(reasoning: ReasoningConfig): Record<string, boolean | string> {
  switch (reasoning.mode) {
    case "provider-default": return {};
    case "disabled": return { think: false };
    case "enabled": return { think: true };
    case "effort": return { think: reasoning.effort };
  }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
