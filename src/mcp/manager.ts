import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { McpStdioServerConfig, ToolPolicy } from "../config.js";
import { ToolRegistry } from "../tools/registry.js";
import type { AgentTool } from "../tools/types.js";

export interface McpListedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface McpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpListedTool[]>;
  callTool(name: string, arguments_: Record<string, unknown>): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

export interface McpClientFactory {
  create(serverName: string, config: McpStdioServerConfig): McpClient;
}

export interface McpToolMetadata {
  serverName: string;
  originalName: string;
  annotations?: Record<string, unknown>;
}

export interface McpAgentTool extends AgentTool {
  mcp: McpToolMetadata;
}

export class McpManager {
  private readonly clients: McpClient[] = [];
  private connected = false;

  constructor(
    private readonly servers: Record<string, McpStdioServerConfig>,
    private readonly clientFactory: McpClientFactory = new StdioMcpClientFactory(),
    private readonly toolPolicy: ToolPolicy = { allow: ["*"], deny: [] },
  ) {}

  async connectAndRegister(registry: ToolRegistry): Promise<void> {
    if (this.connected) {
      throw new Error("MCP servers are already connected.");
    }

    try {
      for (const [serverName, config] of Object.entries(this.servers)) {
        const client = this.clientFactory.create(serverName, config);
        await client.connect();
        this.clients.push(client);
        const tools = await client.listTools();
        for (const tool of tools) {
          const normalizedName = `${serverName}.${tool.name}`;
          if (isToolAllowed(normalizedName, this.toolPolicy)) {
            registry.register(createMcpAgentTool(serverName, tool, client));
          }
        }
      }
      this.connected = true;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map((client) => client.close()));
    this.clients.length = 0;
    this.connected = false;
  }
}

export function isToolAllowed(name: string, policy: ToolPolicy): boolean {
  return policy.allow.some((pattern) => matchesToolPattern(name, pattern))
    && !policy.deny.some((pattern) => matchesToolPattern(name, pattern));
}

export class StdioMcpClientFactory implements McpClientFactory {
  create(_serverName: string, config: McpStdioServerConfig): McpClient {
    return new StdioMcpClient(config);
  }
}

class StdioMcpClient implements McpClient {
  private readonly client = new Client({ name: "agent-tool", version: "0.1.0" });
  private readonly transport: StdioClientTransport;

  constructor(config: McpStdioServerConfig) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...getDefaultEnvironment(), ...config.env } : undefined,
      stderr: "inherit",
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<McpListedTool[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = await this.client.callTool({ name, arguments: arguments_ });
    if (!("content" in result) || !Array.isArray(result.content)) {
      throw new Error("MCP server returned an unsupported tool result.");
    }
    return {
      content: result.content,
      ...(isJsonObject(result.structuredContent) ? { structuredContent: result.structuredContent } : {}),
      ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
      ...(isJsonObject(result._meta) ? { metadata: result._meta } : {}),
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createMcpAgentTool(serverName: string, tool: McpListedTool, client: McpClient): McpAgentTool {
  if (!tool.name.trim()) {
    throw new Error(`MCP server ${serverName} exposed a tool without a name.`);
  }
  if (!isJsonObject(tool.inputSchema) || tool.inputSchema.type !== "object") {
    throw new Error(`MCP tool ${serverName}.${tool.name} must have an object input schema.`);
  }

  return {
    name: `${serverName}.${tool.name}`,
    description: tool.description?.trim() || `MCP tool ${tool.name} from server ${serverName}.`,
    inputSchema: tool.inputSchema,
    mcp: { serverName, originalName: tool.name, annotations: tool.annotations },
    async execute(arguments_) {
      const result = await client.callTool(tool.name, arguments_);
      return {
        ok: !result.isError,
        content: result.content,
        ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      };
    },
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesToolPattern(name: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map(escapeRegularExpression)
    .join(".*");
  return new RegExp(`^${expression}$`).test(name);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
