#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError, loadConfig } from "./config.js";
import { Agent } from "./agent/agent.js";
import { OllamaProvider } from "./model/ollama.js";
import type { ReasoningConfig } from "./model/types.js";
import { loadSystemPrompt } from "./prompts/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import { createTestTools } from "./tools/test-tools.js";
import { McpManager } from "./mcp/manager.js";
import { buildSystemPrompt } from "./skills/context.js";
import { loadSkills, selectSkills } from "./skills/loader.js";
import { createLoadSkillTool } from "./skills/runtime.js";
import { TraceRecorder } from "./trace/trace.js";

export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const arguments_ = await yargs(argv)
    .scriptName("agent-tool")
    .usage("$0 <prompt>")
    .option("config", { type: "string", description: "Path to a JSON configuration file." })
    .option("model", { type: "string", description: "Override the configured Ollama model." })
    .option("prompt", { type: "string", description: "Override the configured system prompt path." })
    .option("skill", { type: "string", array: true, nargs: 1, description: "Load one named skill; repeatable." })
    .option("skills", { choices: ["all", "none", "progressive"] as const, description: "Load all, no, or progressively disclosed skills." })
    .option("reasoning", {
      choices: ["default", "off", "on", "low", "medium", "high", "max"] as const,
      description: "Override reasoning mode or effort.",
    })
    .option("max-steps", { type: "number", description: "Maximum model turns before the agent stops." })
    .option("trace", { type: "boolean", default: false, description: "Write a human-readable run trace to stderr." })
    .option("trace-json", { type: "boolean", default: false, description: "Write a JSON run trace to stderr." })
    .option("show-thinking", { type: "boolean", default: false, description: "With tracing, include provider-exposed thinking text." })
    .demandCommand(1, "Provide a prompt.")
    .strict()
    .help()
    .parse();

  const prompt = arguments_._.map(String).join(" ");
  if (arguments_.trace && arguments_["trace-json"]) {
    throw new ConfigError("--trace cannot be combined with --trace-json.");
  }
  const requestedSkillNames = arguments_.skill ?? [];
  const config = await loadConfig({
    configPath: arguments_.config,
    modelName: arguments_.model,
    reasoning: arguments_.reasoning ? parseReasoningOption(arguments_.reasoning) : undefined,
  });
  if (requestedSkillNames.length > 0 && arguments_.skills === "all") {
    throw new ConfigError("--skill cannot be combined with --skills all.");
  }
  const basePrompt = await loadSystemPrompt(arguments_.prompt ? resolve(arguments_.prompt) : config.agent.systemPrompt);
  const availableSkills = await loadSkills(config.skills.directories);
  const selectedSkills = selectSkills(availableSkills, arguments_.skills ?? config.skills.mode, requestedSkillNames);
  const progressiveSkills = (arguments_.skills ?? config.skills.mode) === "progressive";
  const systemPrompt = buildSystemPrompt(basePrompt, selectedSkills, progressiveSkills ? "progressive" : "eager");
  const model = new OllamaProvider({
    baseUrl: config.model.baseUrl,
    model: config.model.name,
  });
  const tools = new ToolRegistry(createTestTools());
  if (progressiveSkills) tools.register(createLoadSkillTool(selectedSkills, availableSkills));
  const mcp = new McpManager(config.mcpServers, undefined, config.tools);
  const traceEnabled = arguments_.trace || arguments_["trace-json"];
  let tracer: TraceRecorder | undefined;
  try {
    await mcp.connectAndRegister(tools);
    if (traceEnabled) {
      tracer = new TraceRecorder({
        model: config.model.name,
        reasoning: config.model.reasoning,
        modelOptions: config.model.options,
        promptPath: arguments_.prompt ? resolve(arguments_.prompt) : config.agent.systemPrompt,
        promptContent: basePrompt,
        skills: selectedSkills,
        tools: tools.entries(),
        showThinking: arguments_["show-thinking"],
        secretValues: Object.values(config.mcpServers).flatMap((server) => Object.values(server.env ?? {})),
      });
    }
    const agent = new Agent({
      model,
      tools,
      systemPrompt,
      reasoning: config.model.reasoning,
      modelOptions: config.model.options,
      maxSteps: arguments_.maxSteps ?? config.agent.maxSteps,
      tracer,
      ...(progressiveSkills ? { skillCatalog: selectedSkills } : {}),
    });
    const result = await agent.run(prompt);
    if (tracer) {
      console.error(arguments_["trace-json"] ? JSON.stringify(tracer.toJson()) : tracer.toHuman());
    }
    console.log(result.answer);
  } catch (error) {
    if (tracer) {
      tracer.fail(error);
      console.error(arguments_["trace-json"] ? JSON.stringify(tracer.toJson()) : tracer.toHuman());
    }
    throw error;
  } finally {
    await mcp.close();
  }
}

function parseReasoningOption(value: "default" | "off" | "on" | "low" | "medium" | "high" | "max"): ReasoningConfig {
  if (value === "default") {
    return { mode: "provider-default" };
  }
  if (value === "off") {
    return { mode: "disabled" };
  }
  if (value === "on") {
    return { mode: "enabled" };
  }
  return { mode: "effort", effort: value };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    console.error(`agent-tool: ${message}`);
    process.exitCode = error instanceof ConfigError ? 2 : 1;
  }
}
