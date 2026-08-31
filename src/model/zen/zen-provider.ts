import type { ModelProvider } from "../model-provider.js";
import type { ModelDescriptor, ModelRequest, ModelResponse } from "../model-types.js";
import { loadDotEnv } from "../../env.js";
import { resolve } from "node:path";
import { ZenAuthenticationError, ZenProviderError, redactZenSecrets } from "./zen-errors.js";
import { resolveZenProtocol, type ZenModelRoutes } from "./zen-protocol-router.js";
import { ZenOpenAiChatAdapter } from "./adapters/zen-openai-chat.js";
import { ZenOpenAiResponsesAdapter } from "./adapters/zen-openai-responses.js";

const defaultZenBaseUrl = "https://opencode.ai/zen/v1";

export interface ZenProviderOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  modelRoutes?: ZenModelRoutes;
}

interface ZenModelsResponse {
  data?: unknown;
}

/**
 * Zen owns shared authentication and protocol routing. Wire-format translation
 * remains inside protocol adapters.
 */
export class ZenProvider implements ModelProvider {
  readonly id = "zen" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImplementation: typeof fetch;
  private readonly modelRoutes: ZenModelRoutes;
  private readonly model: string | undefined;

  constructor(options: ZenProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultZenBaseUrl).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.OPENCODE_ZEN_API_KEY;
    this.fetchImplementation = options.fetch ?? fetch;
    this.modelRoutes = options.modelRoutes ?? {};
    this.model = options.model;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    let response: Response;
    try {
      response = await this.fetchZen("/models", {
        method: "GET",
      });
    } catch (error) {
      if (error instanceof ZenProviderError) throw error;
      throw new ZenProviderError(`Could not reach OpenCode Zen model catalog: ${errorMessage(error)}`);
    }

    if (response.status === 401 || response.status === 403) throw new ZenAuthenticationError();
    if (!response.ok) throw new ZenProviderError(`OpenCode Zen model catalog request failed with HTTP ${response.status}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ZenProviderError("OpenCode Zen returned an invalid model catalog response.");
    }
    return normalizeZenModelDescriptors(body, this.modelRoutes);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.model) throw new ZenProviderError("Zen inference requires a model name.");
    const protocol = resolveZenProtocol(this.model, this.modelRoutes);
    if (protocol === "openai-responses") {
      return new ZenOpenAiResponsesAdapter({
        model: this.model,
        baseUrl: this.baseUrl,
        fetch: (input, init) => this.fetchZen(input instanceof Request ? input.url : input.toString(), init ?? {}),
      }).generate(request);
    }
    if (protocol !== "openai-chat") {
      const routedProtocol = protocol ?? "unknown";
      throw new ZenProviderError(`Zen model \"${this.model}\" is routed to ${routedProtocol}, but no adapter for that Zen protocol is implemented.`);
    }
    return new ZenOpenAiChatAdapter({
      model: this.model,
      baseUrl: this.baseUrl,
      fetch: (input, init) => this.fetchZen(input instanceof Request ? input.url : input.toString(), init ?? {}),
    }).generate(request);
  }

  private async requireApiKey(): Promise<string> {
    const apiKey = this.apiKey ?? (await loadDotEnv(resolve(process.cwd(), ".env")).then((environment) => environment.OPENCODE_ZEN_API_KEY));
    if (!apiKey?.trim()) {
      throw new ZenAuthenticationError("Zen provider requires OPENCODE_ZEN_API_KEY. Create an OpenCode Zen API key and set the environment variable.");
    }
    return apiKey;
  }

  private async fetchZen(url: string, init: RequestInit): Promise<Response> {
    const apiKey = await this.requireApiKey();
    try {
      return await this.fetchImplementation(url.startsWith("http") ? url : `${this.baseUrl}${url}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${apiKey}` },
      });
    } catch (error) {
      throw new ZenProviderError(redactZenSecrets(`Could not reach OpenCode Zen: ${errorMessage(error)}`, [apiKey]));
    }
  }
}

export function normalizeZenModelDescriptors(value: unknown, modelRoutes: ZenModelRoutes = {}): ModelDescriptor[] {
  const data = isRecord(value) ? (value as ZenModelsResponse).data : undefined;
  if (!Array.isArray(data)) {
    throw new ZenProviderError("OpenCode Zen returned an invalid model catalog response.");
  }
  const descriptors: ModelDescriptor[] = [];
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      throw new ZenProviderError("OpenCode Zen returned an invalid model catalog response.");
    }
    const metadata: Record<string, unknown> = {};
    if (typeof entry.owned_by === "string") metadata.ownedBy = entry.owned_by;
    if (typeof entry.created === "number") metadata.created = entry.created;
    const protocol = resolveZenProtocol(entry.id, modelRoutes);
    metadata.protocol = protocol ?? "unknown";
    metadata.routingStatus = protocol ? "supported" : "discovered/unroutable";
    descriptors.push({ id: entry.id, provider: "zen", metadata });
  }
  return descriptors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
