import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Prompt } from "@ai-sdk/provider";

import type {
  AssistantMessage,
  ConversationMessage,
  ModelRequest,
  ModelResponse,
  ModelToolDefinition,
  ToolResultMessage,
} from "../../model-types.js";
import { ZenAuthenticationError, ZenProviderError } from "../zen-errors.js";

export interface ZenAnthropicMessagesAdapterOptions {
  model: string;
  baseUrl: string;
  fetch: typeof fetch;
}

/** Opaque thinking blocks required by Anthropic when continuing a tool turn. */
interface AnthropicContinuationState {
  protocol: "anthropic-messages";
  thinking: Array<{ text: string; signature?: string; redactedData?: string }>;
}

/** Translates the normalized contract to Zen's Anthropic Messages endpoint. */
export class ZenAnthropicMessagesAdapter {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: ZenAnthropicMessagesAdapterOptions) {
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetchImplementation = options.fetch;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      const zen = createAnthropic({
        name: "zen",
        baseURL: this.baseUrl,
        // ZenProvider's fetch wrapper replaces this SDK-required Anthropic
        // header with the configured Zen credential before transport.
        apiKey: "zen-managed",
        fetch: this.fetchImplementation,
      });
      const toolNames = createToolNameMap(request);
      const result = await zen.languageModel(this.model).doGenerate(toAiSdkRequest(request, toolNames));
      return normalizeAiSdkResponse(result, this.model, toolNames);
    } catch (error) {
      if (error instanceof ZenProviderError) throw error;
      if (statusCode(error) === 401 || statusCode(error) === 403) throw new ZenAuthenticationError();
      if (statusCode(error) !== undefined) throw new ZenProviderError(`OpenCode Zen Anthropic Messages request failed with HTTP ${statusCode(error)}.`);
      throw new ZenProviderError("Could not reach OpenCode Zen Anthropic Messages.");
    }
  }
}

export function toAiSdkRequest(request: ModelRequest, toolNames = createToolNameMap(request)): LanguageModelV4CallOptions {
  return {
    prompt: request.messages.map((message) => toAiSdkMessage(message, toolNames)),
    tools: request.tools.map((tool) => toAiSdkTool(tool, toolNames)),
    ...(typeof request.options.temperature === "number" ? { temperature: request.options.temperature } : {}),
    ...toAiSdkReasoning(request.reasoning),
  };
}

function normalizeAiSdkResponse(result: LanguageModelV4GenerateResult, model: string, toolNames: ToolNameMap): ModelResponse {
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("");
  const toolCalls = result.content.filter((part) => part.type === "tool-call").map((part) => ({
    id: part.toolCallId,
    name: toolNames.toNormalized(part.toolName),
    arguments: parseToolArguments(part.input),
  }));
  const thinking = result.content.filter((part) => part.type === "reasoning").map((part) => {
    const metadata = anthropicReasoningMetadata(part.providerMetadata);
    return { text: part.text, ...(metadata?.signature ? { signature: metadata.signature } : {}), ...(metadata?.redactedData ? { redactedData: metadata.redactedData } : {}) };
  });
  const continuation = thinking.length > 0 ? { protocol: "anthropic-messages" as const, thinking } satisfies AnthropicContinuationState : undefined;

  return {
    message: {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      // The complete thinking block is retained only for protocol replay. The
      // agent and normal traces never inspect or print this opaque metadata.
      ...(continuation ? { reasoning: { metadata: { zenAnthropic: continuation } } } : {}),
    },
    finishReason: result.finishReason.unified === "tool-calls" ? "tool_calls" : result.finishReason.unified,
    usage: { promptTokens: result.usage.inputTokens.total, completionTokens: result.usage.outputTokens.total },
    providerMetadata: { provider: "zen", model, protocol: "anthropic-messages" },
  };
}

function toAiSdkMessage(message: ConversationMessage, toolNames: ToolNameMap): LanguageModelV4Prompt[number] {
  if (message.role === "system") return { role: "system", content: message.content };
  if (message.role === "user") return { role: "user", content: [{ type: "text", text: message.content }] };
  if (message.role === "tool") return toAiSdkToolResult(message as ToolResultMessage, toolNames);
  const assistant = message as AssistantMessage;
  const continuation = anthropicContinuation(assistant.reasoning?.metadata?.zenAnthropic);
  return {
    role: "assistant",
    content: [
      ...toAiSdkThinking(continuation),
      ...(assistant.content ? [{ type: "text" as const, text: assistant.content }] : []),
      ...(assistant.toolCalls ?? []).map((toolCall) => ({ type: "tool-call" as const, toolCallId: toolCall.id, toolName: toolNames.toProvider(toolCall.name), input: toolCall.arguments })),
    ],
  } as LanguageModelV4Prompt[number];
}

function toAiSdkThinking(state: AnthropicContinuationState | undefined): Array<{ type: "reasoning"; text: string; providerOptions: Record<string, unknown> }> {
  if (!state) return [];
  return state.thinking.map((thinking) => ({
    type: "reasoning",
    text: thinking.text,
    providerOptions: { anthropic: thinking.signature ? { signature: thinking.signature } : { redactedData: thinking.redactedData } },
  }));
}

function toAiSdkToolResult(message: ToolResultMessage, toolNames: ToolNameMap): LanguageModelV4Prompt[number] {
  return { role: "tool", content: [{ type: "tool-result", toolCallId: message.toolCallId, toolName: toolNames.toProvider(message.name), output: { type: "text", value: message.content } }] };
}

function toAiSdkTool(tool: ModelToolDefinition, toolNames: ToolNameMap): NonNullable<LanguageModelV4CallOptions["tools"]>[number] {
  return { type: "function", name: toolNames.toProvider(tool.name), description: tool.description, inputSchema: tool.inputSchema as never };
}

function toAiSdkReasoning(reasoning: ModelRequest["reasoning"]): Pick<LanguageModelV4CallOptions, "providerOptions"> {
  if (reasoning.mode === "provider-default") return {};
  // Disabling an exposed Anthropic thinking mode is documented by the SDK.
  // Enabling it needs a model-specific budget/capability that Zen's catalog
  // does not provide, so do not guess based on a model name.
  if (reasoning.mode === "disabled") return { providerOptions: { anthropic: { thinking: { type: "disabled" } } } };
  throw new ZenProviderError("Zen anthropic-messages cannot map this explicit reasoning request because Zen has not documented model-specific thinking capability. Use --reasoning default or off.");
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
    if (existing && existing !== tool.name) throw new ZenProviderError(`Zen anthropic-messages cannot map colliding tool names "${existing}" and "${tool.name}".`);
    normalizedToProvider.set(tool.name, providerName);
    providerToNormalized.set(providerName, tool.name);
  }
  return {
    toProvider(name) { return normalizedToProvider.get(name) ?? name.replace(/[^A-Za-z0-9_-]/g, "_"); },
    toNormalized(name) { return providerToNormalized.get(name) ?? name; },
  };
}

function anthropicContinuation(value: unknown): AnthropicContinuationState | undefined {
  if (!isRecord(value) || value.protocol !== "anthropic-messages" || !Array.isArray(value.thinking)) return undefined;
  const thinking = value.thinking.filter((entry): entry is { text: string; signature?: string; redactedData?: string } => isRecord(entry) && typeof entry.text === "string" && (typeof entry.signature === "string" || typeof entry.redactedData === "string"));
  return thinking.length === value.thinking.length ? { protocol: "anthropic-messages", thinking } : undefined;
}

function anthropicReasoningMetadata(value: unknown): { signature?: string; redactedData?: string } | undefined {
  if (!isRecord(value) || !isRecord(value.anthropic)) return undefined;
  const metadata = value.anthropic;
  if (typeof metadata.signature === "string") return { signature: metadata.signature };
  if (typeof metadata.redactedData === "string") return { redactedData: metadata.redactedData };
  return undefined;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") try { const parsed = JSON.parse(value) as unknown; if (isRecord(parsed)) return parsed; } catch { /* Safe normalized error below. */ }
  throw new ZenProviderError("OpenCode Zen returned invalid Anthropic Messages tool arguments.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
}
