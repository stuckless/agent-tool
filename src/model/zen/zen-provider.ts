import type { ModelProvider } from "../model-provider.js";
import type { ModelDescriptor, ModelRequest, ModelResponse } from "../model-types.js";
import { loadDotEnv } from "../../env.js";
import { resolve } from "node:path";
import { ZenAuthenticationError, ZenProviderError, redactZenSecrets } from "./zen-errors.js";
import { resolveZenProtocol, type ZenModelRoutes } from "./zen-protocol-router.js";

const defaultZenBaseUrl = "https://opencode.ai/zen/v1";

export interface ZenProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  modelRoutes?: ZenModelRoutes;
}

interface ZenModelsResponse {
  data?: unknown;
}

/**
 * Zen's Z2 facade deliberately implements catalog discovery only. Protocol
 * routing and inference are added in later phases.
 */
export class ZenProvider implements ModelProvider {
  readonly id = "zen" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImplementation: typeof fetch;
  private readonly modelRoutes: ZenModelRoutes;

  constructor(options: ZenProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultZenBaseUrl).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.OPENCODE_ZEN_API_KEY;
    this.fetchImplementation = options.fetch ?? fetch;
    this.modelRoutes = options.modelRoutes ?? {};
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const apiKey = await this.requireApiKey();
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } catch (error) {
      throw new ZenProviderError(redactZenSecrets(`Could not reach OpenCode Zen model catalog: ${errorMessage(error)}`, [apiKey]));
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

  async generate(_request: ModelRequest): Promise<ModelResponse> {
    throw new ZenProviderError("Zen inference is not available until a Zen protocol adapter is configured.");
  }

  private async requireApiKey(): Promise<string> {
    const apiKey = this.apiKey ?? (await loadDotEnv(resolve(process.cwd(), ".env")).then((environment) => environment.OPENCODE_ZEN_API_KEY));
    if (!apiKey?.trim()) {
      throw new ZenAuthenticationError("Zen provider requires OPENCODE_ZEN_API_KEY. Create an OpenCode Zen API key and set the environment variable.");
    }
    return apiKey;
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
