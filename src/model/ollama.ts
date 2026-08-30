import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}

interface OllamaChatResponse {
  message?: {
    content?: unknown;
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
          messages: request.messages,
          options: request.options,
          stream: false,
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
      text: responseBody.message.content,
      finishReason: typeof responseBody.done_reason === "string" ? responseBody.done_reason : undefined,
      usage: {
        promptTokens: toNumber(responseBody.prompt_eval_count),
        completionTokens: toNumber(responseBody.eval_count),
      },
    };
  }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
