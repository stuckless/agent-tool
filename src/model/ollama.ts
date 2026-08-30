import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse, ReasoningConfig } from "./types.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}

interface OllamaChatResponse {
  message?: {
    content?: unknown;
    thinking?: unknown;
  };
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}

export class OllamaProvider implements ModelProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async chat(request: ModelRequest): Promise<ModelResponse> {
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
          ...toOllamaReasoning(request.reasoning),
        }),
      });
    } catch {
      throw new Error(`Could not reach Ollama at ${this.baseUrl}.`);
    }

    if (!response.ok) {
      throw new Error(`Ollama request failed with HTTP ${response.status}.`);
    }

    const responseBody = (await response.json()) as OllamaChatResponse;
    if (typeof responseBody.message?.content !== "string") {
      throw new Error("Ollama returned an invalid chat response.");
    }

    return {
      message: {
        role: "assistant",
        content: responseBody.message.content,
        reasoning: typeof responseBody.message.thinking === "string" ? { text: responseBody.message.thinking } : undefined,
      },
      finishReason: typeof responseBody.done_reason === "string" ? responseBody.done_reason : undefined,
      usage: {
        promptTokens: toNumber(responseBody.prompt_eval_count),
        completionTokens: toNumber(responseBody.eval_count),
      },
    };
  }
}

function toOllamaMessage(message: ModelMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.reasoning?.text ? { thinking: message.reasoning.text } : {}),
  };
}

function toOllamaReasoning(reasoning: ReasoningConfig): Record<string, boolean | string> {
  switch (reasoning.mode) {
    case "provider-default":
      return {};
    case "disabled":
      return { think: false };
    case "enabled":
      return { think: true };
    case "effort":
      return { think: reasoning.effort };
  }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
