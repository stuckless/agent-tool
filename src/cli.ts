#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError, loadConfig } from "./config.js";
import { OllamaProvider } from "./model/ollama.js";
import { loadSystemPrompt } from "./prompts/loader.js";

export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const arguments_ = await yargs(argv)
    .scriptName("agent-tool")
    .usage("$0 <prompt>")
    .option("config", { type: "string", description: "Path to a JSON configuration file." })
    .option("model", { type: "string", description: "Override the configured Ollama model." })
    .option("prompt", { type: "string", description: "Override the configured system prompt path." })
    .demandCommand(1, "Provide a prompt.")
    .strict()
    .help()
    .parse();

  const prompt = arguments_._.map(String).join(" ");
  const config = await loadConfig({
    configPath: arguments_.config,
    modelName: arguments_.model,
  });
  const systemPrompt = await loadSystemPrompt(arguments_.prompt ? resolve(arguments_.prompt) : config.agent.systemPrompt);
  const model = new OllamaProvider({
    baseUrl: config.model.baseUrl,
    model: config.model.name,
  });
  const response = await model.chat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    options: config.model.options,
  });

  console.log(response.text);
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
