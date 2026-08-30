import type { AgentTool } from "./types.js";

const stringInputSchema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};

export function createTestTools(currentValue = "phase-2-current-test-value"): AgentTool[] {
  return [
    {
      name: "echo",
      description: "Returns the supplied value exactly.",
      inputSchema: stringInputSchema,
      async execute(arguments_) {
        if (typeof arguments_.value !== "string") {
          throw new Error("echo requires a string value.");
        }
        return { value: arguments_.value };
      },
    },
    {
      name: "get_current_test_value",
      description: "Returns the current deterministic test value.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { value: currentValue };
      },
    },
  ];
}
