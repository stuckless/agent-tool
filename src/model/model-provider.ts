import type { ModelRequest, ModelResponse } from "./model-types.js";

export type ModelProviderId = "ollama";

/**
 * The provider-neutral boundary used by the agent loop.
 *
 * Providers own wire-format translation and continuation replay; the agent
 * only handles normalized messages, tools, and tool results.
 */
export interface ModelProvider {
  readonly id: ModelProviderId;

  generate(request: ModelRequest): Promise<ModelResponse>;
}
