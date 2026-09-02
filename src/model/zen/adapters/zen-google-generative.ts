import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3Prompt, LanguageModelV3ToolCall } from "@ai-sdk/provider";

import type { AssistantMessage, ConversationMessage, ModelRequest, ModelResponse, ModelToolDefinition, ToolResultMessage } from "../../model-types.js";
import { ZenAuthenticationError, ZenProviderError } from "../zen-errors.js";

export interface ZenGoogleGenerativeAdapterOptions {
  model: string;
  baseUrl: string;
  fetch: typeof fetch;
}

/** Gemini thought signatures are opaque continuation state, never agent input. */
interface GoogleContinuationState {
  protocol: "google-generative";
  thoughtSignatures: Record<string, string>;
}

/** Translates the normalized contract to Zen's model-specific Gemini endpoint. */
export class ZenGoogleGenerativeAdapter {
  constructor(private readonly options: ZenGoogleGenerativeAdapterOptions) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      const google = createGoogleGenerativeAI({
        name: "zen-google",
        baseURL: this.options.baseUrl,
        // ZenProvider owns the real credential and substitutes this required
        // SDK header at the shared transport boundary.
        apiKey: "zen-managed",
        fetch: this.options.fetch,
      });
      const toolNames = createToolNameMap(request);
      const result = await google.languageModel(this.options.model).doGenerate(toAiSdkRequest(request, toolNames));
      return normalizeAiSdkResponse(result, this.options.model, toolNames);
    } catch (error) {
      if (error instanceof ZenProviderError) throw error;
      if (statusCode(error) === 401 || statusCode(error) === 403) throw new ZenAuthenticationError();
      if (statusCode(error) !== undefined) throw new ZenProviderError(`OpenCode Zen Google Generative request failed with HTTP ${statusCode(error)}.`);
      throw new ZenProviderError("Could not reach OpenCode Zen Google Generative.");
    }
  }
}

export function toAiSdkRequest(request: ModelRequest, toolNames = createToolNameMap(request)): LanguageModelV3CallOptions {
  return {
    prompt: request.messages.map((message) => toAiSdkMessage(message, toolNames)),
    tools: request.tools.map((tool) => toAiSdkTool(tool, toolNames)),
    ...(typeof request.options.temperature === "number" ? { temperature: request.options.temperature } : {}),
    ...toAiSdkReasoning(request.reasoning),
  };
}

function normalizeAiSdkResponse(result: LanguageModelV3GenerateResult, model: string, toolNames: ToolNameMap): ModelResponse {
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("");
  const toolCalls = result.content.filter((part): part is LanguageModelV3ToolCall => part.type === "tool-call" && !part.providerExecuted).map((part) => ({
    id: part.toolCallId,
    name: toolNames.toNormalized(part.toolName),
    arguments: parseToolArguments(part.input),
  }));
  const thoughtSignatures: Record<string, string> = {};
  let reasoningText = "";
  for (const part of result.content) {
    const signature = googleThoughtSignature(part.providerMetadata);
    if (signature) {
      const key = part.type === "tool-call" ? `tool:${part.toolCallId}` : part.type;
      thoughtSignatures[key] = signature;
    }
    if (part.type === "reasoning") reasoningText += part.text;
  }
  const continuation = Object.keys(thoughtSignatures).length > 0
    ? { protocol: "google-generative" as const, thoughtSignatures } satisfies GoogleContinuationState
    : undefined;

  return {
    message: {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(reasoningText || continuation ? { reasoning: {
        ...(reasoningText ? { text: reasoningText } : {}),
        ...(continuation ? { metadata: { zenGoogle: continuation } } : {}),
      } } : {}),
    },
    finishReason: result.finishReason.unified === "tool-calls" ? "tool_calls" : result.finishReason.unified,
    usage: { promptTokens: result.usage.inputTokens.total, completionTokens: result.usage.outputTokens.total },
    providerMetadata: { provider: "zen", model, protocol: "google-generative" },
  };
}

function toAiSdkMessage(message: ConversationMessage, toolNames: ToolNameMap): LanguageModelV3Prompt[number] {
  if (message.role === "system") return { role: "system", content: message.content };
  if (message.role === "user") return { role: "user", content: [{ type: "text", text: message.content }] };
  if (message.role === "tool") return toAiSdkToolResult(message as ToolResultMessage, toolNames);
  const assistant = message as AssistantMessage;
  const continuation = googleContinuation(assistant.reasoning?.metadata?.zenGoogle);
  return {
    role: "assistant",
    content: [
      ...(assistant.reasoning?.text ? [{ type: "reasoning" as const, text: assistant.reasoning.text, providerOptions: googleProviderOptions(continuation?.thoughtSignatures.reasoning) }] : []),
      ...(assistant.content ? [{ type: "text" as const, text: assistant.content, providerOptions: googleProviderOptions(continuation?.thoughtSignatures.text) }] : []),
      ...(assistant.toolCalls ?? []).map((toolCall) => ({
        type: "tool-call" as const,
        toolCallId: toolCall.id,
        toolName: toolNames.toProvider(toolCall.name),
        input: toolCall.arguments,
        providerOptions: googleProviderOptions(continuation?.thoughtSignatures[`tool:${toolCall.id}`]),
      })),
    ],
  };
}

function toAiSdkToolResult(message: ToolResultMessage, toolNames: ToolNameMap): LanguageModelV3Prompt[number] {
  return { role: "tool", content: [{ type: "tool-result", toolCallId: message.toolCallId, toolName: toolNames.toProvider(message.name), output: { type: "text", value: message.content } }] };
}

function toAiSdkTool(tool: ModelToolDefinition, toolNames: ToolNameMap): NonNullable<LanguageModelV3CallOptions["tools"]>[number] {
  return { type: "function", name: toolNames.toProvider(tool.name), description: tool.description, inputSchema: tool.inputSchema as never };
}

function toAiSdkReasoning(reasoning: ModelRequest["reasoning"]): Pick<LanguageModelV3CallOptions, "providerOptions"> {
  if (reasoning.mode === "provider-default") return {};
  // Zen documents the Gemini endpoint, but not model-specific reasoning
  // capability or accepted thinking configuration. Do not infer it from IDs.
  throw new ZenProviderError("Zen google-generative cannot map this explicit reasoning request because Zen has not documented model-specific Gemini reasoning capability. Use --reasoning default.");
}

function googleProviderOptions(thoughtSignature: string | undefined): Record<string, Record<string, string>> | undefined {
  return thoughtSignature ? { google: { thoughtSignature } } : undefined;
}

interface ToolNameMap {
  toProvider(name: string): string;
  toNormalized(name: string): string;
}

function createToolNameMap(request: ModelRequest): ToolNameMap {
  const normalizedToProvider = new Map<string, string>();
  const providerToNormalized = new Map<string, string>();
  for (const tool of request.tools) {
    const providerName = tool.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_").slice(0, 64);
    const existing = providerToNormalized.get(providerName);
    if (existing && existing !== tool.name) throw new ZenProviderError(`Zen google-generative cannot map colliding tool names "${existing}" and "${tool.name}".`);
    normalizedToProvider.set(tool.name, providerName);
    providerToNormalized.set(providerName, tool.name);
  }
  return {
    toProvider(name) { return normalizedToProvider.get(name) ?? name.replace(/[^A-Za-z0-9_]/g, "_"); },
    toNormalized(name) { return providerToNormalized.get(name) ?? name; },
  };
}

function googleContinuation(value: unknown): GoogleContinuationState | undefined {
  if (!isRecord(value) || value.protocol !== "google-generative" || !isRecord(value.thoughtSignatures)) return undefined;
  const thoughtSignatures = Object.fromEntries(Object.entries(value.thoughtSignatures).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return Object.keys(thoughtSignatures).length === Object.keys(value.thoughtSignatures).length ? { protocol: "google-generative", thoughtSignatures } : undefined;
}

function googleThoughtSignature(value: unknown): string | undefined {
  return isRecord(value) && isRecord(value.google) && typeof value.google.thoughtSignature === "string" ? value.google.thoughtSignature : undefined;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") try { const parsed = JSON.parse(value) as unknown; if (isRecord(parsed)) return parsed; } catch { /* Safe normalized error below. */ }
  throw new ZenProviderError("OpenCode Zen returned invalid Google Generative tool arguments.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
}
