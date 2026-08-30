#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function placeholderHandler(prompt: string): string {
  return prompt;
}

export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const arguments_ = await yargs(argv)
    .scriptName("agent-tool")
    .usage("$0 <prompt>")
    .demandCommand(1, "Provide a prompt.")
    .strict()
    .help()
    .parse();

  const prompt = arguments_._.map(String).join(" ");
  console.log(placeholderHandler(prompt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli();
}
