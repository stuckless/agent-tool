import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { loadDotEnv } from "./env.js";
import type { ReasoningConfig } from "./model/types.js";
import type { ProviderConfig } from "./model/provider-registry.js";

const defaultOllamaBaseUrl = "http://localhost:11434";
const defaultZenBaseUrl = "https://opencode.ai/zen/v1";
const defaultSystemPrompt = "./prompts/minimal.md";

const rawConfigSchema = z.object({
  model: z
    .object({
      provider: z.enum(["ollama", "zen"]).default("ollama"),
      baseUrl: z.string().url().optional(),
      name: z.string().min(1).optional(),
      reasoning: z
        .discriminatedUnion("mode", [
          z.object({ mode: z.literal("provider-default") }),
          z.object({ mode: z.literal("disabled") }),
          z.object({ mode: z.literal("enabled") }),
          z.object({ mode: z.literal("effort"), effort: z.enum(["low", "medium", "high", "max"]) }),
        ])
        .default({ mode: "provider-default" }),
      options: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ provider: "ollama", reasoning: { mode: "provider-default" }, options: {} }),
  providers: z.object({
    zen: z.object({
      baseUrl: z.string().url().optional(),
      apiKeyEnv: z.literal("OPENCODE_ZEN_API_KEY").optional(),
    }).default({}),
  }).default({ zen: {} }),
  agent: z
    .object({
      systemPrompt: z.string().min(1).optional(),
      maxSteps: z.number().int().positive().optional(),
    })
    .default({}),
  skills: z
    .object({
      directories: z.array(z.string().min(1)).default(["./skills"]),
      mode: z.enum(["all", "none", "progressive"]).default("all"),
    })
    .default({ directories: ["./skills"], mode: "all" }),
  mcpServers: z
    .record(
      z.string().min(1),
      z.object({
        transport: z.literal("stdio"),
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default({}),
  tools: z
    .object({
      allow: z.array(z.string().min(1)).default(["*"]),
      deny: z.array(z.string().min(1)).default([]),
      discovery: z.object({
        mode: z.enum(["disabled", "search"]).default("disabled"),
        initialAllow: z.array(z.string().min(1)).default([]),
      }).default({ mode: "disabled", initialAllow: [] }),
    })
    .default({ allow: ["*"], deny: [], discovery: { mode: "disabled", initialAllow: [] } }),
});

export interface McpStdioServerConfig {
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ToolPolicy {
  allow: string[];
  deny: string[];
  discovery: {
    mode: "disabled" | "search";
    initialAllow: string[];
  };
}

export interface SkillsConfig {
  directories: string[];
  mode: "all" | "none" | "progressive";
}

export interface RuntimeConfig {
  model: ProviderConfig & {
    reasoning: ReasoningConfig;
    options: Record<string, unknown>;
  };
  agent: {
    systemPrompt: string;
    maxSteps: number;
  };
  skills: SkillsConfig;
  mcpServers: Record<string, McpStdioServerConfig>;
  tools: ToolPolicy;
}

export interface LoadConfigOptions {
  cwd?: string;
  configPath?: string;
  provider?: "ollama" | "zen";
  modelName?: string;
  allowMissingModel?: boolean;
  reasoning?: ReasoningConfig;
  environment?: NodeJS.ProcessEnv;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RuntimeConfig> {
  const cwd = options.cwd ?? process.cwd();
  const processEnvironment = options.environment ?? { ...process.env };
  let dotenvEnvironment: Record<string, string>;
  try {
    dotenvEnvironment = await loadDotEnv(resolve(cwd, ".env"));
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : "Could not read .env file.");
  }
  const environment = { ...dotenvEnvironment, ...processEnvironment };
  const configPath = options.configPath ? resolve(cwd, options.configPath) : resolve(cwd, "agent.config.json");
  const isExplicitConfig = options.configPath !== undefined;
  const rawConfig = await readConfigFile(configPath, isExplicitConfig);
  const parsedConfig = rawConfigSchema.safeParse(rawConfig);

  if (!parsedConfig.success) {
    throw new ConfigError(`Invalid configuration in ${configPath}: ${parsedConfig.error.issues[0]?.message ?? "unknown error"}`);
  }

  const provider = options.provider ?? parseProvider(environment.AGENT_PROVIDER) ?? parsedConfig.data.model.provider;
  const modelName = options.modelName ?? environment.AGENT_MODEL ?? parsedConfig.data.model.name;
  if (!modelName && !options.allowMissingModel) {
    throw new ConfigError("Missing model name. Set model.name in agent.config.json, use --model, or set AGENT_MODEL.");
  }

  const baseUrl = provider === "zen"
    ? environment.OPENCODE_ZEN_BASE_URL ?? parsedConfig.data.providers.zen.baseUrl ?? defaultZenBaseUrl
    : environment.AGENT_OLLAMA_URL ?? parsedConfig.data.model.baseUrl ?? defaultOllamaBaseUrl;
  if (!isHttpUrl(baseUrl)) {
    throw new ConfigError(`${provider === "zen" ? "Zen" : "Ollama"} base URL must be an http or https URL.`);
  }

  return {
    model: {
      provider,
      baseUrl: baseUrl.replace(/\/$/, ""),
      name: modelName ?? "",
      reasoning: options.reasoning ?? parsedConfig.data.model.reasoning,
      options: parsedConfig.data.model.options,
    },
    agent: {
      systemPrompt: resolve(cwd, parsedConfig.data.agent.systemPrompt ?? defaultSystemPrompt),
      maxSteps: parsedConfig.data.agent.maxSteps ?? 10,
    },
    skills: {
      directories: parsedConfig.data.skills.directories.map((directory) => resolve(cwd, directory)),
      mode: parsedConfig.data.skills.mode,
    },
    mcpServers: parsedConfig.data.mcpServers,
    tools: parsedConfig.data.tools,
  };
}

function parseProvider(value: string | undefined): "ollama" | "zen" | undefined {
  if (value === undefined) return undefined;
  if (value === "ollama" || value === "zen") return value;
  throw new ConfigError("AGENT_PROVIDER must be either ollama or zen.");
}

async function readConfigFile(configPath: string, isExplicitConfig: boolean): Promise<unknown> {
  try {
    const contents = await readFile(configPath, "utf8");
    return JSON.parse(contents) as unknown;
  } catch (error) {
    if (isMissingFile(error) && !isExplicitConfig) {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new ConfigError(`Configuration file contains invalid JSON: ${configPath}`);
    }

    if (isMissingFile(error)) {
      throw new ConfigError(`Configuration file was not found: ${configPath}`);
    }

    throw new ConfigError(`Could not read configuration file: ${configPath}`);
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
