# Skills Design

## Purpose

A skill is reusable task guidance. It teaches the agent how to approach a domain or workflow without implementing the action itself.

Examples:

- Maximo work-order analysis
- product documentation research
- incident triage
- SQL investigation conventions

A tool answers: **what can I do?**

A skill answers: **how should I approach this kind of task?**

## File Layout

```text
skills/
└── work-orders/
    └── SKILL.md
```

Recommended format:

```markdown
---
name: work-orders
description: Guidance for querying and interpreting work orders.
tags:
  - maximo
  - work-orders
---

# Work Orders

Use this skill when ...

## Procedure

1. ...
2. ...

## Domain Rules

- ...
```

Use YAML frontmatter only for compact metadata. The body is the instruction content presented to the model.

## Required Metadata

- `name`
- `description`

Optional:

- `tags`
- `version`

Avoid extensive skill manifests in V1.

## Loader Behavior

At startup:

1. recursively discover configured `SKILL.md` files
2. parse metadata/body
3. validate required fields
4. reject duplicate skill names
5. register skills

Malformed skill files should fail fast with filename and validation details.

## V1 Skill Selection

Support explicit CLI selection:

```bash
agent-tool --skill work-orders "..."
```

Support multiple skills:

```bash
agent-tool --skill work-orders --skill locations "..."
```

For small experiments, config may specify:

```json
{
  "skills": {
    "mode": "all"
  }
}
```

This is intentionally simple and useful for understanding how skill instructions affect behavior.

## Skill Injection

Keep skill boundaries visible in the constructed system prompt:

```text
<skill name="work-orders">
...
</skill>
```

or an equally obvious Markdown delimiter.

Do not concatenate skill bodies with no indication of source.

## Progressive Disclosure Experiment

After V1, compare with this approach:

```text
System prompt
  + compact skill catalog
  + tools including runtime.load_skill
```

When the model calls:

```json
{
  "name": "runtime.load_skill",
  "arguments": { "name": "work-orders" }
}
```

the runtime returns the full skill body and records that it is active for the run.

Questions to measure:

- Does the model pick the correct skill?
- Does it load unnecessary skills?
- Does reduced initial context improve tool selection?
- Does the model follow the skill after loading it?

## Skill Quality Guidelines

A useful skill should state:

- when it applies
- when it does not apply
- preferred authoritative sources/tools
- domain definitions that are easy to misinterpret
- ordered workflow when order matters
- verification expectations
- expected output characteristics

Avoid vague guidance such as "be accurate" when a concrete rule can be stated.

## Example Work-Order Skill Content

The eventual sample skill should demonstrate guidance such as:

- use tools rather than model knowledge for current work-order data
- determine what the location name maps to
- define or resolve "open"
- prefer count operations for count questions
- verify filters in the tool response
- report the interpretation used

The sample should not encode company-specific secrets or production endpoints.
