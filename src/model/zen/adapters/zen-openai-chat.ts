import type {
  AssistantMessage,
  ConversationMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelToolDefinition,
  ToolResultMessage,
} from "../../model-types.js";
import { ZenAuthenticationError, ZenProviderError } from "../zen-errors.js";

export interface ZenOpenAiChatAdapterOptions {
  model: string;
  request: (path: string, init: RequestInit) => Promise<Response>;
}

interface ChatCompletionsResponse {
  choices?: unknown;
  usage?: unknown;
}

/** Translates the normalized model contract to Zen's OpenAI-compatible API. */
export class ZenOpenAiChatAdapter {
  private readonly model: string;
  private readonly request: ZenOpenAiChatAdapterOptions["request"];

  constructor(options: ZenOpenAiChatAdapterOptions) {
    this.model = options.model;
    this.request = options.request;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    let response: Response;
    try {
      response = await this.request("/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toOpenAiChatRequest(this.model, request)),
      });
    } catch (error) {
      if (error instanceof ZenProviderError) throw error;
      throw new ZenProviderError("Could not reach OpenCode Zen chat completions.");
    }

    if (response.status === 401 || response.status === 403) throw new ZenAuthenticationError();
    if (!response.ok) throw new ZenProviderError(`OpenCode Zen chat completions request failed with HTTP ${response.status}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ZenProviderError("OpenCode Zen returned an invalid chat completions response.");
    }
    return normalizeOpenAiChatResponse(body);
  }
}

export function toOpenAiChatRequest(model: string, request: ModelRequest): Record<string, unknown> {
  return {
    ...request.options,
    model,
    messages: request.messages.map(toOpenAiChatMessage),
    stream: false,
    ...(request.tools.length > 0 ? { tools: request.tools.map(toOpenAiChatTool) } : {}),
  };
}

export function normalizeOpenAiChatResponse(value: unknown): ModelResponse {
  const choices = isRecord(value) ? (value as ChatCompletionsResponse).choices : undefined;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ZenProviderError("OpenCode Zen returned an invalid chat completions response.");
  }
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new ZenProviderError("OpenCode Zen returned an invalid chat completions response.");
  }
  const content = choice.message.content;
  if (content !== null && content !== undefined && typeof content !== "string") {
    throw new ZenProviderError("OpenCode Zen returned an invalid chat completions response.");
  }

  return {
    message: {
      role: "assistant",
      content: content ?? "",
      toolCalls: parseToolCalls(choice.message.tool_calls),
    },
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined,
    usage: normalizeUsage((value as ChatCompletionsResponse).usage),
  };
}

function toOpenAiChatMessage(message: ConversationMessage): Record<string, unknown> {
  if (message.role === "tool") return toOpenAiChatToolResult(message as ToolResultMessage);
  const assistant = message.role === "assistant" ? message as AssistantMessage : undefined;
  return {
    role: message.role,
    content: message.content,
    ...(assistant?.toolCalls ? { tool_calls: assistant.toolCalls.map(toOpenAiChatToolCall) } : {}),
  };
}

function toOpenAiChatToolResult(message: ToolResultMessage): Record<string, unknown> {
  return {
    role: "tool",
    tool_call_id: message.toolCallId,
    name: message.name,
    content: message.content,
  };
}

function toOpenAiChatToolCall(toolCall: ModelToolCall): Record<string, unknown> {
  return {
    id: toolCall.id,
    type: "function",
    function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
  };
}

function toOpenAiChatTool(tool: ModelToolDefinition): Record<string, unknown> {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
}

function parseToolCalls(value: unknown): ModelToolCall[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ZenProviderError("OpenCode Zen returned invalid chat completion tool calls.");
  return value.map((toolCall) => {
    if (!isRecord(toolCall) || typeof toolCall.id !== "string" || !isRecord(toolCall.function) || typeof toolCall.function.name !== "string") {
      throw new ZenProviderError("OpenCode Zen returned invalid chat completion tool calls.");
    }
    return { id: toolCall.id, name: toolCall.function.name, arguments: parseToolArguments(toolCall.function.arguments) };
  });
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new ZenProviderError("OpenCode Zen returned invalid chat completion tool arguments.");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // The normalized provider error below intentionally omits raw provider data.
  }
  throw new ZenProviderError("OpenCode Zen returned invalid chat completion tool arguments.");
}

function normalizeUsage(value: unknown): ModelResponse["usage"] | undefined {
  if (!isRecord(value)) return undefined;
  const promptTokens = typeof value.prompt_tokens === "number" ? value.prompt_tokens : undefined;
  const completionTokens = typeof value.completion_tokens === "number" ? value.completion_tokens : undefined;
  return promptTokens === undefined && completionTokens === undefined ? undefined : { promptTokens, completionTokens };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
