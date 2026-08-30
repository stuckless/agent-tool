import type { ModelToolDefinition } from "../model/types.js";

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(arguments_: Record<string, unknown>): Promise<unknown>;
  runtime?: { kind: "load-skill" };
}

export class ToolExecutionError extends Error {
  constructor(readonly type: string, message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export function toModelToolDefinition(tool: AgentTool): ModelToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}
