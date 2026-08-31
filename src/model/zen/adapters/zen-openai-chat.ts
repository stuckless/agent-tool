import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Prompt } from "@ai-sdk/provider";
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
  baseUrl: string;
  fetch: typeof fetch;
}

/** Translates the normalized model contract to Zen's OpenAI-compatible API. */
export class ZenOpenAiChatAdapter {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: ZenOpenAiChatAdapterOptions) {
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetchImplementation = options.fetch;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      const zen = createOpenAICompatible({
        name: "zen",
        baseURL: this.baseUrl,
        fetch: this.fetchImplementation,
      });
      const result = await zen.chatModel(this.model).doGenerate(toAiSdkRequest(request));
      return normalizeAiSdkResponse(result, this.model);
    } catch (error) {
      if (error instanceof ZenProviderError) throw error;
      if (statusCode(error) === 401 || statusCode(error) === 403) throw new ZenAuthenticationError();
      if (statusCode(error) !== undefined) throw new ZenProviderError(`OpenCode Zen chat completions request failed with HTTP ${statusCode(error)}.`);
      throw new ZenProviderError("Could not reach OpenCode Zen chat completions.");
    }
  }
}

export function toAiSdkRequest(request: ModelRequest): LanguageModelV4CallOptions {
  return {
    prompt: request.messages.map(toAiSdkMessage),
    tools: request.tools.map(toAiSdkTool),
    ...(typeof request.options.temperature === "number" ? { temperature: request.options.temperature } : {}),
    ...toAiSdkReasoning(request.reasoning),
  };
}

function normalizeAiSdkResponse(result: LanguageModelV4GenerateResult, model: string): ModelResponse {
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("");
  return {
    message: {
      role: "assistant",
      content: text,
      toolCalls: result.content.filter((part) => part.type === "tool-call").map((part) => ({
        id: part.toolCallId,
        name: part.toolName,
        arguments: parseToolArguments(part.input),
      })),
    },
    finishReason: result.finishReason.unified === "tool-calls" ? "tool_calls" : result.finishReason.unified,
    usage: { promptTokens: result.usage.inputTokens.total, completionTokens: result.usage.outputTokens.total },
    providerMetadata: { provider: "zen", model, protocol: "openai-chat" },
  };
}

function toAiSdkMessage(message: ConversationMessage): LanguageModelV4Prompt[number] {
  if (message.role === "system") return { role: "system", content: message.content };
  if (message.role === "user") return { role: "user", content: [{ type: "text", text: message.content }] };
  if (message.role === "tool") return toAiSdkToolResult(message as ToolResultMessage);
  const assistant = message.role === "assistant" ? message as AssistantMessage : undefined;
  return {
    role: "assistant",
    content: [
      { type: "text", text: message.content },
      ...(assistant?.toolCalls ?? []).map((toolCall) => ({ type: "tool-call" as const, toolCallId: toolCall.id, toolName: toolCall.name, input: toolCall.arguments })),
    ],
  };
}

function toAiSdkToolResult(message: ToolResultMessage): LanguageModelV4Prompt[number] {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: message.toolCallId, toolName: message.name, output: { type: "text", value: message.content } }],
  };
}

function toAiSdkTool(tool: ModelToolDefinition): NonNullable<LanguageModelV4CallOptions["tools"]>[number] {
  return { type: "function", name: tool.name, description: tool.description, inputSchema: tool.inputSchema as never };
}

function toAiSdkReasoning(request: ModelRequest["reasoning"]): Pick<LanguageModelV4CallOptions, "reasoning"> {
  switch (request.mode) {
    case "provider-default": return { reasoning: "provider-default" };
    case "disabled": return { reasoning: "none" };
    case "effort": return { reasoning: request.effort === "max" ? "xhigh" : request.effort };
    case "enabled": throw new ZenProviderError("Zen openai-chat cannot map generic reasoning mode enabled. Use an explicit --reasoning effort or default.");
  }
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") try { const parsed = JSON.parse(value) as unknown; if (isRecord(parsed)) return parsed; } catch { /* Safe normalized error below. */ }
  throw new ZenProviderError("OpenCode Zen returned invalid chat completion tool arguments.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
}
