import type { ModelProvider } from "./model-provider.js";
import { OllamaProvider, type OllamaProviderOptions } from "./ollama/ollama-provider.js";
import { ZenProvider, type ZenProviderOptions } from "./zen/zen-provider.js";

export type ProviderConfig = {
  provider: "ollama";
  baseUrl: string;
  name: string;
} | {
  provider: "zen";
  baseUrl: string;
  name: string;
};

export class ProviderRegistry {
  create(config: ProviderConfig, options: { fetch?: typeof fetch } = {}): ModelProvider {
    switch (config.provider) {
      case "ollama":
        return new OllamaProvider({
          baseUrl: config.baseUrl,
          model: config.name,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
      case "zen":
        return new ZenProvider({
          baseUrl: config.baseUrl,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
    }
  }
}

export const providerRegistry = new ProviderRegistry();

export type { OllamaProviderOptions, ZenProviderOptions };
