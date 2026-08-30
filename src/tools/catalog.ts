import type { ModelToolDefinition } from "../model/types.js";
import type { AgentTool } from "./types.js";
import { toModelToolDefinition } from "./types.js";
import { ToolRegistry } from "./registry.js";

export interface ToolDiscoveryConfig {
  mode: "disabled" | "search";
  initialAllow: string[];
}

export interface ToolCatalog {
  definitions(): ModelToolDefinition[];
  get(name: string): AgentTool | undefined;
  isKnown(name: string): boolean;
  isAvailable(name: string): boolean;
  initialNames(): string[];
  allNames(): string[];
  filteringEnabled(): boolean;
  search(query: string): ToolSearchResult;
}

export interface ToolSearchResult {
  query: string;
  tools: Array<{ name: string; description: string }>;
}

export class RuntimeToolCatalog implements ToolCatalog {
  private readonly available = new Set<string>();

  constructor(private readonly registry: ToolRegistry, private readonly config: ToolDiscoveryConfig) {
    if (config.mode === "disabled") {
      for (const tool of registry.entries()) this.available.add(tool.name);
      return;
    }
    for (const tool of registry.entries()) {
      if (tool.runtime || matchesAny(tool.name, config.initialAllow)) this.available.add(tool.name);
    }
  }

  definitions(): ModelToolDefinition[] {
    return this.registry.entries().filter((tool) => this.isAvailable(tool.name)).map(toModelToolDefinition);
  }

  get(name: string): AgentTool | undefined {
    return this.isAvailable(name) ? this.registry.get(name) : undefined;
  }

  isKnown(name: string): boolean {
    return this.registry.get(name) !== undefined;
  }

  isAvailable(name: string): boolean {
    return this.config.mode === "disabled" || this.available.has(name) || this.registry.get(name)?.runtime !== undefined;
  }

  initialNames(): string[] {
    return this.definitions().map((tool) => tool.name);
  }

  allNames(): string[] {
    return this.registry.entries().map((tool) => tool.name);
  }

  filteringEnabled(): boolean {
    return this.config.mode === "search";
  }

  search(query: string): ToolSearchResult {
    const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const matches = this.registry.entries()
      .filter((tool) => !tool.runtime)
      .map((tool) => ({ tool, score: score(tool, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
      .slice(0, 8)
      .map(({ tool }) => tool);
    for (const tool of matches) this.available.add(tool.name);
    return { query, tools: matches.map((tool) => ({ name: tool.name, description: tool.description })) };
  }
}

function score(tool: AgentTool, terms: string[]): number {
  const text = `${tool.name} ${tool.description}`.toLowerCase();
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`).test(name));
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
