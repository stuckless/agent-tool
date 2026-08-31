/**
 * Routes OpenCode Zen model IDs to their documented protocol families.
 *
 * Zen documents these families at https://opencode.ai/zen/v1/models, but the
 * catalog endpoint does not include protocol information. Keep this mapping
 * here so discovery, configuration, and future adapters do not duplicate it.
 */
export type ZenProtocol =
  | "openai-responses"
  | "anthropic-messages"
  | "openai-chat"
  | "google-generative";

export type ZenModelRoutes = Record<string, ZenProtocol>;

interface ZenFamilyRoute {
  readonly protocol: ZenProtocol;
  readonly matches: (modelId: string) => boolean;
}

const exactKnownRoutes: ZenModelRoutes = {};

const familyRoutes: readonly ZenFamilyRoute[] = [
  { protocol: "openai-responses", matches: (modelId) => /^gpt-|^grok-|^muse-spark-/.test(modelId) },
  { protocol: "anthropic-messages", matches: (modelId) => /^claude-|^qwen3\.|^qwen3-/.test(modelId) },
  { protocol: "openai-chat", matches: (modelId) => /^deepseek-|^minimax-|^glm-|^kimi-|^big-pickle$|^mimo-|^ling-|^nemotron-/.test(modelId) },
  { protocol: "google-generative", matches: (modelId) => /^gemini-/.test(modelId) },
];

export function resolveZenProtocol(modelId: string, modelRoutes: ZenModelRoutes = {}): ZenProtocol | undefined {
  return modelRoutes[modelId]
    ?? exactKnownRoutes[modelId]
    ?? familyRoutes.find((route) => route.matches(modelId))?.protocol;
}
