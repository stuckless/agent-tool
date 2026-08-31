import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3Prompt } from "@ai-sdk/provider";

import type {
  AssistantMessage,
  ConversationMessage,
  ModelRequest,
  ModelResponse,
  ModelToolDefinition,
  ToolResultMessage,
} from "../../model-types.js";
import { ZenAuthenticationError, ZenProviderError } from "../zen-errors.js";

export interface ZenOpenAiResponsesAdapterOptions {
  model: string;
  baseUrl: string;
  fetch: typeof fetch;
}

interface ResponsesContinuationState {
  protocol: "openai-responses";
  responseId: string;
  /** Provider item IDs are retained for replay/debugging, never agent control flow. */
  itemIds: Record<string, string>;
}

/** Translates the normalized contract to Zen's OpenAI Responses endpoint. */
export class ZenOpenAiResponsesAdapter {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: ZenOpenAiResponsesAdapterOptions) {
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetchImplementation = options.fetch;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      const zen = createOpenAI({
        name: "zen",
        baseURL: this.baseUrl,
        // Authorization is owned by ZenProvider's fetch wrapper. This value is
        // deliberately non-secret and is overwritten before transport.
        apiKey: "zen-managed",
        fetch: this.fetchImplementation,
      });
      const toolNames = createToolNameMap(request);
      const result = await zen.responses(this.model).doGenerate(toAiSdkRequest(request, toolNames));
      return normalizeAiSdkResponse(result, this.model, toolNames);
    } catch (error) {
      if (error instanceof ZenProviderError) throw error;
      if (statusCode(error) === 401 || statusCode(error) === 403) throw new ZenAuthenticationError();
      if (statusCode(error) !== undefined) throw new ZenProviderError(`OpenCode Zen Responses request failed with HTTP ${statusCode(error)}.`);
      throw new ZenProviderError("Could not reach OpenCode Zen Responses.");
    }
  }
}

export function toAiSdkRequest(request: ModelRequest, toolNames = createToolNameMap(request)): LanguageModelV3CallOptions {
  const continuation = latestContinuation(request.messages);
  return {
    // The response chain already retains its tool-call items. Only send the
    // following tool-result messages with its opaque response ID, preventing
    // duplicate function-call items on a continuation request.
    prompt: (continuation ? request.messages.slice(continuation.assistantIndex + 1) : request.messages).map((message) => toAiSdkMessage(message, toolNames)),
    tools: request.tools.map((tool) => toAiSdkTool(tool, toolNames)),
    ...(typeof request.options.temperature === "number" ? { temperature: request.options.temperature } : {}),
    ...toAiSdkReasoning(request.reasoning),
    ...(continuation ? { providerOptions: { openai: { previousResponseId: continuation.state.responseId } } } : {}),
  };
}

function latestContinuation(messages: ConversationMessage[]): { assistantIndex: number; state: ResponsesContinuationState } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const value = message.reasoning?.metadata?.zenResponses;
    if (isContinuationState(value)) return { assistantIndex: index, state: value };
  }
  return undefined;
}

function isContinuationState(value: unknown): value is ResponsesContinuationState {
  return isRecord(value)
    && value.protocol === "openai-responses"
    && typeof value.responseId === "string"
    && isRecord(value.itemIds);
}

function normalizeAiSdkResponse(result: LanguageModelV3GenerateResult, model: string, toolNames: ToolNameMap): ModelResponse {
  const itemIds: Record<string, string> = {};
  const text = result.content.filter((part) => part.type === "text").map((part) => {
    const itemId = itemIdOf(part.providerMetadata);
    if (itemId) itemIds[`text:${Object.keys(itemIds).length}`] = itemId;
    return part.text;
  }).join("");
  const toolCalls = result.content.filter((part) => part.type === "tool-call").map((part) => {
    const itemId = itemIdOf(part.providerMetadata);
    if (itemId) itemIds[`tool:${part.toolCallId}`] = itemId;
    return { id: part.toolCallId, name: toolNames.toNormalized(part.toolName), arguments: parseToolArguments(part.input) };
  });
  const reasoning = result.content.filter((part) => part.type === "reasoning");
  for (const [index, part] of reasoning.entries()) {
    const itemId = itemIdOf(part.providerMetadata);
    if (itemId) itemIds[`reasoning:${index}`] = itemId;
  }
  const responseId = responseIdOf(result.providerMetadata) ?? result.response?.id;
  if (!responseId && result.content.length === 0) {
    throw new ZenProviderError("OpenCode Zen returned an invalid Responses response.");
  }
  const continuation = responseId ? { protocol: "openai-responses" as const, responseId, itemIds } satisfies ResponsesContinuationState : undefined;

  return {
    message: {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(continuation ? { reasoning: { metadata: { zenResponses: continuation } } } : {}),
    },
    finishReason: result.finishReason.unified === "tool-calls" ? "tool_calls" : result.finishReason.unified,
    usage: { promptTokens: result.usage.inputTokens.total, completionTokens: result.usage.outputTokens.total },
    providerMetadata: { provider: "zen", model, protocol: "openai-responses" },
  };
}

function toAiSdkMessage(message: ConversationMessage, toolNames: ToolNameMap): LanguageModelV3Prompt[number] {
  if (message.role === "system") return { role: "system", content: message.content };
  if (message.role === "user") return { role: "user", content: [{ type: "text", text: message.content }] };
  if (message.role === "tool") return toAiSdkToolResult(message as ToolResultMessage, toolNames);
  const assistant = message as AssistantMessage;
  return {
    role: "assistant",
    content: [
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
      ...(assistant.toolCalls ?? []).map((toolCall) => ({ type: "tool-call" as const, toolCallId: toolCall.id, toolName: toolNames.toProvider(toolCall.name), input: toolCall.arguments })),
    ],
  };
}

function toAiSdkToolResult(message: ToolResultMessage, toolNames: ToolNameMap): LanguageModelV3Prompt[number] {
  return { role: "tool", content: [{ type: "tool-result", toolCallId: message.toolCallId, toolName: toolNames.toProvider(message.name), output: { type: "text", value: message.content } }] };
}

function toAiSdkTool(tool: ModelToolDefinition, toolNames: ToolNameMap): NonNullable<LanguageModelV3CallOptions["tools"]>[number] {
  return { type: "function", name: toolNames.toProvider(tool.name), description: tool.description, inputSchema: tool.inputSchema as never };
}

interface ToolNameMap {
  toProvider(name: string): string;
  toNormalized(name: string): string;
}

function createToolNameMap(request: ModelRequest): ToolNameMap {
  const normalizedToProvider = new Map<string, string>();
  const providerToNormalized = new Map<string, string>();
  for (const tool of request.tools) {
    const providerName = tool.name.replace(/[^A-Za-z0-9_-]/g, "_");
    const existing = providerToNormalized.get(providerName);
    if (existing && existing !== tool.name) throw new ZenProviderError(`Zen openai-responses cannot map colliding tool names "${existing}" and "${tool.name}".`);
    normalizedToProvider.set(tool.name, providerName);
    providerToNormalized.set(providerName, tool.name);
  }
  return {
    toProvider(name) { return normalizedToProvider.get(name) ?? name.replace(/[^A-Za-z0-9_-]/g, "_"); },
    toNormalized(name) { return providerToNormalized.get(name) ?? name; },
  };
}

function toAiSdkReasoning(reasoning: ModelRequest["reasoning"]): Pick<LanguageModelV3CallOptions, "providerOptions"> {
  if (reasoning.mode === "provider-default") return {};
  // Zen discovery has no per-model reasoning capabilities. The Responses API
  // SDK itself also uses an OpenAI-owned model catalog, which cannot safely be
  // treated as a capability catalog for Zen's GPT/Grok/Muse routes.
  throw new ZenProviderError("Zen openai-responses cannot map an explicit reasoning request because Zen has not documented reasoning capability for this model. Use --reasoning default.");
}

function responseIdOf(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.openai) || typeof value.openai.responseId !== "string") return undefined;
  return value.openai.responseId;
}

function itemIdOf(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.openai) || typeof value.openai.itemId !== "string") return undefined;
  return value.openai.itemId;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") try { const parsed = JSON.parse(value) as unknown; if (isRecord(parsed)) return parsed; } catch { /* Safe normalized error below. */ }
  throw new ZenProviderError("OpenCode Zen returned invalid Responses tool arguments.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
}
