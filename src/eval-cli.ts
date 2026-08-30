#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { Agent } from "./agent/agent.js";
import { ConfigError, loadConfig } from "./config.js";
import { parseEvalDataset, runEval } from "./eval/runner.js";
import { McpManager } from "./mcp/manager.js";
import { OllamaProvider } from "./model/ollama.js";
import type { ReasoningConfig } from "./model/types.js";
import { loadSystemPrompt } from "./prompts/loader.js";
import { buildSystemPrompt } from "./skills/context.js";
import { loadSkills, selectSkills } from "./skills/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import { createTestTools } from "./tools/test-tools.js";

export async function runEvalCli(argv = hideBin(process.argv)): Promise<boolean> {
  const arguments_ = await yargs(argv)
    .scriptName("agent-eval")
    .usage("$0 <file>")
    .option("config", { type: "string", description: "Path to a JSON configuration file." })
    .option("model", { type: "string", description: "Override the configured Ollama model." })
    .option("prompt", { type: "string", description: "Override the configured system prompt path." })
    .option("skill", { type: "string", array: true, nargs: 1, description: "Load one named skill; repeatable." })
    .option("skills", { choices: ["all", "none"] as const, description: "Load all skills or no skills." })
    .option("reasoning", { choices: ["default", "off", "on", "low", "medium", "high", "max"] as const, description: "Override reasoning mode or effort." })
    .option("max-steps", { type: "number", description: "Maximum model turns before the agent stops." })
    .option("output", { type: "string", description: "Write the JSON report to this file as well as stdout." })
    .demandCommand(1, "Provide an eval dataset JSON file.")
    .strict()
    .help()
    .parse();
  const datasetPath = resolve(String(arguments_._[0]));
  if ((arguments_.skill?.length ?? 0) > 0 && arguments_.skills === "all") throw new ConfigError("--skill cannot be combined with --skills all.");
  const config = await loadConfig({ configPath: arguments_.config, modelName: arguments_.model, reasoning: arguments_.reasoning ? parseReasoningOption(arguments_.reasoning) : undefined });
  const basePrompt = await loadSystemPrompt(arguments_.prompt ? resolve(arguments_.prompt) : config.agent.systemPrompt);
  const skills = selectSkills(await loadSkills(config.skills.directories), arguments_.skills ?? config.skills.mode, arguments_.skill ?? []);
  const tools = new ToolRegistry(createTestTools());
  const mcp = new McpManager(config.mcpServers, undefined, config.tools);
  try {
    await mcp.connectAndRegister(tools);
    const dataset = parseEvalDataset(JSON.parse(await readFile(datasetPath, "utf8")));
    const report = await runEval(dataset, {
      model: config.model.name, reasoning: config.model.reasoning, modelOptions: config.model.options,
      promptPath: arguments_.prompt ? resolve(arguments_.prompt) : config.agent.systemPrompt, promptContent: basePrompt,
      skills, tools: tools.entries(), secretValues: Object.values(config.mcpServers).flatMap((server) => Object.values(server.env ?? {})),
      createAgent: (tracer) => new Agent({ model: new OllamaProvider({ baseUrl: config.model.baseUrl, model: config.model.name }), tools, systemPrompt: buildSystemPrompt(basePrompt, skills), reasoning: config.model.reasoning, modelOptions: config.model.options, maxSteps: arguments_["max-steps"] ?? config.agent.maxSteps, tracer }),
    });
    const json = JSON.stringify(report, null, 2);
    if (arguments_.output) await writeFile(resolve(arguments_.output), `${json}\n`, "utf8");
    console.log(json);
    return report.summary.failed === 0;
  } finally {
    await mcp.close();
  }
}

function parseReasoningOption(value: "default" | "off" | "on" | "low" | "medium" | "high" | "max"): ReasoningConfig {
  if (value === "default") return { mode: "provider-default" };
  if (value === "off") return { mode: "disabled" };
  if (value === "on") return { mode: "enabled" };
  return { mode: "effort", effort: value };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!await runEvalCli()) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    console.error(`agent-eval: ${message}`);
    process.exitCode = error instanceof ConfigError ? 2 : 1;
  }
}
