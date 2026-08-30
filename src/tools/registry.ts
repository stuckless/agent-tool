import type { AgentTool } from "./types.js";
import { toModelToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool named ${tool.name} is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  definitions() {
    return [...this.tools.values()].map(toModelToolDefinition);
  }
}
