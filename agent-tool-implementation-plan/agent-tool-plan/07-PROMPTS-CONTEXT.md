# System Prompts and Context Construction

## Goal

Make prompt/context behavior explicit and testable.

The runtime should make it easy to answer:

- Which system prompt was used?
- Which skills were injected?
- Which tools were available?
- How large was the context?
- Did changing only the prompt change behavior?

## Prompt Files

Store prompts as Markdown:

```text
prompts/
├── minimal.md
└── investigative.md
```

Do not embed a giant system prompt in TypeScript.

## Initial Minimal Prompt

The first prompt should be deliberately small and behavior-oriented.

It should cover principles such as:

- answer the user's request accurately
- prefer authoritative tools for retrievable facts
- do not fabricate information available through tools
- inspect tool results before answering
- continue with another tool call when evidence is incomplete
- apply relevant loaded skills
- clearly distinguish assumptions from retrieved facts

Do not over-engineer persona or prose style.

## Investigative Prompt

A second prompt should explicitly instruct the agent to:

1. determine what information is needed
2. identify relevant tools/skills
3. make targeted calls
4. inspect results
5. reformulate or call another tool if evidence is incomplete
6. reconcile conflicts
7. answer only after enough evidence is available

The eval framework should compare `minimal.md` against `investigative.md` using the same model/tools.

## Context Builder

V1 can use a simple function rather than a dedicated framework:

```ts
buildSystemPrompt({
  basePrompt,
  skills,
})
```

Keep the produced prompt inspectable in verbose trace mode.

## Context Ordering

Recommended order:

```text
BASE SYSTEM INSTRUCTIONS

LOADED SKILLS

OPTIONAL RUNTIME INFORMATION
```

Tool definitions remain in the model's tool/function field rather than copied into prose unless the provider requires otherwise.

## Conversation Context

Initial CLI mode is single-turn from the user's perspective, but the agent loop creates multiple internal messages:

```text
system
user
assistant(tool call)
tool(result)
assistant(tool call)
tool(result)
assistant(final)
```

Do not implement persistent cross-run conversation memory in V1.

## Context Growth

Track approximate context growth when provider usage metadata permits.

Useful trace fields:

- message count
- loaded skill characters/tokens if measurable
- number of tool definitions
- tool schema bytes
- tool result bytes
- input/output token usage from provider

This is important for later experiments with many tools/skills.

## Prompt Versioning

Record prompt filename and optionally a content hash in JSON traces/eval results.

This prevents comparisons where the prompt changed silently.

## Prompt Experiments

Useful controlled comparisons:

### Experiment A — Minimal vs investigative

Same model, tools, skills, question.

### Experiment B — No skill vs skill

Same model, prompt, tools, question.

### Experiment C — Tool description quality

Same everything else, altered description text.

### Experiment D — All tools vs filtered tools

Measure whether a large catalog harms selection.

### Experiment E — Local vs frontier model

Only after the rest of the harness is controlled.
