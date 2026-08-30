import { createHash } from "node:crypto";

import { z } from "zod";

import { Agent } from "../agent/agent.js";
import type { ReasoningConfig } from "../model/types.js";
import type { Skill } from "../skills/loader.js";
import { TraceRecorder, type JsonTrace } from "../trace/trace.js";
import type { AgentTool } from "../tools/types.js";

const evalCaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  expect: z.object({
    requiredTools: z.array(z.string().min(1)),
    forbiddenTools: z.array(z.string().min(1)),
    maxToolCalls: z.number().int().nonnegative(),
    outputIncludes: z.array(z.string()),
  }),
});

const evalDatasetSchema = z.array(evalCaseSchema).min(1);

export type EvalCase = z.infer<typeof evalCaseSchema>;

export interface EvalRuntime {
  model: string;
  reasoning: ReasoningConfig;
  modelOptions: Record<string, unknown>;
  promptPath: string;
  promptContent: string;
  skills: Skill[];
  tools: AgentTool[];
  secretValues?: string[];
  createAgent(tracer: TraceRecorder): Agent;
}

export interface EvalCaseResult {
  id: string;
  prompt: { sha256: string };
  status: "completed" | "error";
  error?: string;
  assertions: {
    completed: boolean;
    requiredTools: Record<string, boolean>;
    forbiddenTools: Record<string, boolean>;
    maxToolCalls: { limit: number; actual: number; passed: boolean };
    outputIncludes: Record<string, boolean>;
    noToolErrors: boolean;
    passed: boolean;
  };
  trace: JsonTrace;
}

export interface EvalReport {
  schemaVersion: 1;
  startedAt: string;
  completedAt: string;
  model: string;
  reasoningConfig: ReasoningConfig;
  cases: EvalCaseResult[];
  summary: { total: number; passed: number; failed: number };
}

export function parseEvalDataset(value: unknown): EvalCase[] {
  const parsed = evalDatasetSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid eval dataset: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }
  const ids = new Set<string>();
  for (const entry of parsed.data) {
    if (ids.has(entry.id)) throw new Error(`Invalid eval dataset: duplicate case id '${entry.id}'.`);
    ids.add(entry.id);
  }
  return parsed.data;
}

export async function runEval(dataset: EvalCase[], runtime: EvalRuntime): Promise<EvalReport> {
  const startedAt = new Date().toISOString();
  const cases: EvalCaseResult[] = [];

  for (const evalCase of dataset) {
    const tracer = new TraceRecorder({
      model: runtime.model,
      reasoning: runtime.reasoning,
      modelOptions: runtime.modelOptions,
      promptPath: runtime.promptPath,
      promptContent: runtime.promptContent,
      skills: runtime.skills,
      tools: runtime.tools,
      showThinking: false,
      secretValues: runtime.secretValues,
    });
    let status: EvalCaseResult["status"] = "completed";
    let error: string | undefined;
    try {
      await runtime.createAgent(tracer).run(evalCase.prompt);
    } catch (caught) {
      status = "error";
      error = caught instanceof Error ? caught.message : "Unexpected error.";
      tracer.fail(caught);
    }
    const trace = tracer.toJson();
    cases.push({
      id: evalCase.id,
      prompt: { sha256: hash(evalCase.prompt) },
      status,
      ...(error === undefined ? {} : { error }),
      assertions: evaluateAssertions(evalCase, trace),
      trace,
    });
  }

  const passed = cases.filter((entry) => entry.assertions.passed).length;
  return {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    model: runtime.model,
    reasoningConfig: runtime.reasoning,
    cases,
    summary: { total: cases.length, passed, failed: cases.length - passed },
  };
}

function evaluateAssertions(evalCase: EvalCase, trace: JsonTrace): EvalCaseResult["assertions"] {
  const toolCalls = trace.steps.filter((event) => event.type === "tool.call").map((event) => String(event.tool));
  const toolErrors = trace.steps.some((event) => event.type === "tool.result" && event.ok === false);
  const requiredTools = Object.fromEntries(evalCase.expect.requiredTools.map((name) => [name, toolCalls.includes(name)]));
  const forbiddenTools = Object.fromEntries(evalCase.expect.forbiddenTools.map((name) => [name, !toolCalls.includes(name)]));
  const outputIncludes = Object.fromEntries(evalCase.expect.outputIncludes.map((text) => [text, trace.finalAnswer?.includes(text) ?? false]));
  const maxToolCalls = { limit: evalCase.expect.maxToolCalls, actual: toolCalls.length, passed: toolCalls.length <= evalCase.expect.maxToolCalls };
  const completed = trace.status === "completed";
  const noToolErrors = !toolErrors;
  const passed = completed && noToolErrors && maxToolCalls.passed
    && Object.values(requiredTools).every(Boolean)
    && Object.values(forbiddenTools).every(Boolean)
    && Object.values(outputIncludes).every(Boolean);
  return { completed, requiredTools, forbiddenTools, maxToolCalls, outputIncludes, noToolErrors, passed };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
