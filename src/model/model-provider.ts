import type { ModelDescriptor, ModelRequest, ModelResponse } from "./model-types.js";

export type ModelProviderId = "ollama" | "zen";

/**
 * The provider-neutral boundary used by the agent loop.
 *
 * Providers own wire-format translation and continuation replay; the agent
 * only handles normalized messages, tools, and tool results.
 */
export interface ModelProvider {
  readonly id: ModelProviderId;

  generate(request: ModelRequest): Promise<ModelResponse>;

  /** Discovery is optional because not every provider exposes a catalog API. */
  listModels?(): Promise<ModelDescriptor[]>;
}
