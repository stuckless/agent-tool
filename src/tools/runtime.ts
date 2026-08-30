import { ToolExecutionError, type AgentTool } from "./types.js";
import type { ToolCatalog } from "./catalog.js";

export function createSearchToolsTool(catalog: ToolCatalog): AgentTool {
  return {
    name: "runtime.search_tools",
    description: "Search the available tool catalog by capability, then use a returned exact tool name.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "A short description of the capability needed." } },
      required: ["query"],
      additionalProperties: false,
    },
    runtime: { kind: "search-tools" },
    async execute(arguments_) {
      const query = arguments_.query;
      if (typeof query !== "string" || !query.trim()) {
        throw new ToolExecutionError("InvalidToolArguments", "Tool search query must be a non-empty string.");
      }
      return catalog.search(query);
    },
  };
}
