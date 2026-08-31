# Completion Status

This document tracks implementation progress against `agent-tool-implementation-plan/agent-tool-plan/03-IMPLEMENTATION-PHASES.md`.

## Phase 0 — Repository Bootstrap

**Status:** Complete and committed.

Delivered:

- Node 22+ ESM TypeScript/npm project setup
- `agent-tool` executable wiring and development scripts
- build, typecheck, and Vitest configuration
- initial README and placeholder CLI test

Verification completed:

```text
npm test
npm run typecheck
npm run build
npm run dev -- "hello"
```

## Phase 1 — Ollama Chat Without Agent Behavior

**Status:** Complete and live-verified.

Delivered:

- JSON configuration loader with model, Ollama URL, prompt, options, and reasoning settings
- environment and CLI overrides for model/URL/reasoning
- Markdown system-prompt loader
- provider-neutral model contracts
- native Ollama `/api/chat` adapter using built-in `fetch`
- reasoning configuration mapped to Ollama `think`
- opaque normalization and replay support for provider-exposed `message.thinking`
- one prompt → one model response CLI path

Deterministic verification completed:

```text
npm test          # 11 tests
npm run typecheck
npm run build
```

The tests cover malformed configuration, prompt loading, native request/response normalization, HTTP failures, all four reasoning mappings, and provider-exposed thinking replay.

Live verification used the configured remote server:

```bash
AGENT_OLLAMA_URL=http://192.168.11.10:11434
AGENT_MODEL=granite4.2:8b
```

The CLI successfully returned a final answer for `is react good for server code?` with `--reasoning on`. A direct non-streaming `/api/chat` diagnostic also returned distinct non-empty `message.content` and provider-exposed `message.thinking` fields with `done_reason: "stop"`. The CLI intentionally displays only the final content; thinking remains normalized internal state until Phase 5 trace support.

## Phase 2 — Core Tool-Calling Agent Loop With Local Test Tools

**Status:** Complete.

Delivered:

- provider-neutral tool definitions, tool calls, and ordered tool-result messages
- duplicate-safe in-process tool registry
- deterministic `echo` and `get_current_test_value` local tools
- Ollama tool-definition request formatting and native tool-call normalization
- sequential model → tool → model loop with configurable `maxSteps` (default: 10)
- safe normalized tool errors returned to the model for recovery
- complete assistant-turn preservation across tool turns, including content, calls, and opaque reasoning/state
- injectable structured trace events for model and tool sequence testing; Phase 5 CLI trace modes remain unimplemented

Deterministic verification completed:

```text
npm test          # 17 tests
npm run typecheck
npm run build
npm run dev -- --help
```

The deterministic fake-model tests prove the required sequence: a model requests `get_current_test_value`, the local tool executes, its ordered result message is replayed with the complete preceding assistant message (including opaque reasoning metadata), and a second model turn produces the final answer. They also cover tool definition/call normalization, safe unknown-tool recovery, duplicate registration rejection, and enforced step limits. Normal tests do not use Ollama or the network.

The CLI help demonstration shows the Phase 2 `--max-steps` control. No live Ollama tool-calling run was performed in this phase; that remains a manual optional verification separate from the deterministic acceptance coverage.

## Phase 3 — MCP Tool Integration

**Status:** Complete.

Delivered:

- official `@modelcontextprotocol/sdk` stdio client integration
- validated `mcpServers` JSON configuration with command, arguments, and optional environment values
- startup discovery and namespaced registration as `serverName.toolName`
- permissive-by-default allow/deny wildcard policy applied before MCP tool registration
- MCP description, object input schema, annotations, source-server metadata, text content, and structured content normalization
- execution routing from each registered tool to its originating MCP client
- connection cleanup after normal runs and partial-startup failures

Deterministic verification completed:

```text
npm test          # 21 tests
npm run typecheck
npm run build
```

The normal fake MCP-client tests require neither a network connection nor a production server. They cover discovery, colliding server tool names, normalized definitions and metadata, call routing, normalized MCP results, cleanup, malformed MCP schemas, and an agent model → namespaced MCP tool → final-answer sequence with the structured tool-call trace event. An opt-in real local stdio integration test is available with `AGENT_TEST_STDIO=1 npm run test:mcp-stdio`; it is excluded from normal tests because restricted sandboxes may close child-process pipes before the MCP handshake.

CLI demonstration completed:

```text
npm run dev -- --help
```

The help command is the relevant no-server CLI demonstration. A live MCP server run was not performed; it remains an optional manual check with a configured local stdio server. Normal CLI runs now connect configured servers, discover their tools, execute the agent, and close all MCP clients.

### Phase 3 Follow-up — Local Demo Server

Delivered after Phase 3 completion:

- compiled read-only demo stdio server at `dist/mcp/demo-server.js` with `get_demo_status` and `lookup_demo_record`
- `examples/demo-mcp.config.json` and README instructions for a live-model manual run
- optional real local-protocol test: `AGENT_TEST_STDIO=1 npm run test:mcp-stdio`
- `14-HTTP-MCP-SERVERS.md`, a planned Streamable HTTP transport design covering configuration, environment-backed headers, OAuth, security, and acceptance tests

The compiled demo server was directly verified for tool discovery and a `lookup_demo_record` call. A live-model tool-selection run remains intentionally unperformed and is left for manual testing with the configured Ollama model.

## Phase 4 — Skills, Simple Loading

**Status:** Complete and verified deterministically.

Delivered:

- recursive discovery of configured `skills/**/SKILL.md` files
- compact YAML-frontmatter parsing for required `name` and `description`, optional list-style or inline `tags`, and Markdown instruction bodies
- fail-fast skill validation for unreadable or malformed files, missing required metadata/body, duplicate names, and unknown explicit selections
- `skills.directories` and `skills.mode` (`all` or `none`) configuration, with `./skills` and `all` as defaults
- repeatable `--skill <name>` selection and `--skills all|none` CLI control
- visible selected-skill boundaries injected after the base system prompt, leaving the user prompt and the existing agent/MCP/tool flow unchanged
- a safe sample `skills/work-orders/SKILL.md`

Deterministic verification completed:

```text
npm test          # 25 tests passed; 1 opt-in stdio test skipped
npm run typecheck
npm run build
```

The new tests cover discovery, frontmatter/body parsing, optional tags, malformed files, duplicate names, all/none/explicit selection, unknown names, and exact system-context construction. Normal tests use no Ollama, network connection, or production MCP server.

CLI demonstration completed:

```text
npm run dev -- --help
```

The help output now advertises `--skill` and `--skills`. No live Ollama run was performed to observe a model changing its tool selection or final answer when a skill is enabled versus disabled; that remains an optional manual acceptance check. The existing opt-in local stdio MCP test remains separate from normal verification.

## Phase 5 — Trace Modes

**Status:** Complete and verified deterministically.

Delivered:

- `--trace` for concise human-readable run events on stderr
- `--trace-json` for one stable-schema JSON trace document on stderr
- `--show-thinking`, which includes only provider-exposed thinking text and only when tracing is enabled
- trace metadata for configured model, separate reasoning configuration, prompt path/content hash, selected skills, local/MCP tool catalog, ordered model/tool events, tool arguments/results, and completion
- central recursive redaction for common secret-like fields in trace values
- expanded agent trace events that remain observational; the agent still makes decisions only from structured tool calls

Deterministic verification completed:

```text
npm test          # 27 tests passed; 1 opt-in stdio test skipped
npm run typecheck
npm run build
```

The new deterministic tests verify ordered JSON trace events, human trace output, local tool catalog metadata, reasoning configuration metadata, secret-like field and configured-environment-value redaction, default hiding of provider-exposed thinking, and explicit inclusion of genuinely exposed thinking with `--show-thinking`. Normal tests use no Ollama, network connection, or production MCP server.

CLI demonstrations of both `--trace` and `--trace-json` were run against a local fake Ollama response, confirming that the trace is emitted on stderr while the final answer stays on stdout. No live Ollama run or real MCP tool-call trace was performed in Phase 5; those remain optional manual checks. `--show-thinking` was exercised deterministically, not against a live model.

## Phase 6 — Eval Runner

**Status:** Complete and verified deterministically.

Delivered:

- separate `agent-eval <dataset.json>` CLI with relevant configuration, skills, MCP, model, reasoning, and max-step controls
- JSON dataset validation and objective assertions for completion, required/forbidden tools, maximum calls, output text, and no tool errors
- structured JSON reports with prompt hashes, selected skills, available tools, complete observable model/tool trace events, completion/error state, assertion outcomes, model, and reasoning metadata
- optional `--output` report persistence for later comparison
- `examples/demo-evals.json` format example

Deterministic verification completed:

```text
npm test
npm run typecheck
npm run build
```

Fake-model tests cover passing cases, missing required tools, forbidden tools, call limits, output checks, safe tool errors, runtime failures, prompt hashing, and recorded controlled reasoning metadata. Normal tests use no Ollama, external network, production MCP server, or credentials.

The `agent-eval --help` CLI demonstration and the example dataset format can be exercised locally. A live Ollama eval, real MCP eval, and manual comparison of reasoning settings or skill impact were not performed; these are optional manual/live checks and are not claimed as deterministic acceptance.

## Regroup Point

Phase 6 is complete.

## Zen Support — Phase Z0: Baseline and branch

**Status:** Complete.

Delivered:

- pre-Zen baseline documentation at `docs/zen-z0-baseline.md`, covering the current Ollama-only CLI/eval behavior and normalized message/tool shapes
- a JSON eval fixture at `test/fixtures/ollama-tool-smoke-eval.json` that requires a `get_current_test_value` tool call
- a deterministic eval-CLI test that runs that fixture through the existing Ollama adapter, verifies the two-turn tool continuation, and checks the objective eval result

Verification completed:

```text
npm test          # 50 passed, 1 opt-in stdio test skipped
npm run typecheck
npm run build
node dist/cli.js --help
node dist/eval-cli.js --help
```

The documented remote Ollama smoke check completed successfully with `granite4.2:8b`: a direct `2 + 2` request returned `2 + 2 equals 4.` The first intentionally one-step request hit the expected `maxSteps` guard after the model chose a tool call, confirming that the limit remains enforced.

No provider refactor or Zen code was added. The repository remains on its existing `main` branch; Phase Z0 does not require creating a feature branch.

## Phase 7 — Progressive Skill Disclosure

**Status:** Complete and verified deterministically.

Delivered:

- opt-in `skills.mode: "progressive"` and `--skills progressive`, while `all` remains the eager default
- compact `<skill-catalog>` system context containing selected skill names and descriptions only
- runtime-owned `runtime.load_skill` tool that returns the full body of a selected skill as an ordered tool result
- per-run load tracking: repeat requests return `alreadyLoaded` without duplicating the skill body; unknown and unselected requests return safe normalized errors
- unified local, MCP, and runtime tool registration/trace metadata, including `runtime` as a trace source
- observable `skill.catalog` and `skill.load` events in human and JSON traces, with no provider thinking text exposed by default
- eval coverage for required `runtime.load_skill` usage

Deterministic verification completed:

```text
npm test          # 39 tests passed; 1 opt-in stdio test skipped
npm run typecheck
npm run build
node dist/cli.js --skills progressive --help
```

Fake-model tests verify the compact catalog before loading, ordered model → `runtime.load_skill` → next-model context flow, duplicate avoidance, safe unknown/unselected errors, JSON/human trace events, coexistence with local and normalized MCP tools, and an eval case requiring skill loading. Normal tests use no Ollama, network connection, production MCP server, or credentials.

The CLI help demonstration confirms the progressive option with only local deterministic components. No live Ollama progressive-skill run, real MCP progressive-skill run, or measured context-efficiency/tool-choice comparison has been performed; these remain optional manual/live checks. Stop here to regroup before Phase 8.

## Phase 8 — Dynamic Tool Discovery/Filtering

**Status:** Complete and verified deterministically.

Delivered:

- opt-in `tools.discovery` configuration with `mode: "disabled" | "search"` and wildcard-capable `initialAllow`; disabled remains the compatibility default
- runtime-owned `runtime.search_tools`, a compact deterministic keyword search over registered tool names and descriptions
- per-run tool catalog access control: only initial-allowlisted, runtime-owned, or search-discovered tools are supplied to the model and permitted to execute
- safe distinction between `ToolUnavailable` for known-but-not-discovered tools and `UnknownTool` for names not registered at all
- compatibility for local, namespaced MCP, and runtime-owned tools; progressive `runtime.load_skill` remains available when filtering is enabled
- observable `tool.catalog` and `tool.discovery` events in human and JSON traces, and preserved trace/eval recording
- a deterministic eval requiring `runtime.search_tools` followed by a discovered local tool

Deterministic verification completed:

```text
npm test          # 48 tests passed; 1 opt-in stdio test skipped
npm run typecheck
npm run build
```

Fake-model tests cover unchanged default all-tools behavior, filtered initial context, search → discovered tool → execution, unavailable-tool recovery, progressive-skill/runtime compatibility, local and namespaced MCP compatibility, human/JSON trace events, and eval behavior. Normal tests use no Ollama, network connection, production MCP server, or credentials.

CLI demonstration completed with a local fake Ollama-compatible server and `--trace-json` using `tools.discovery.mode: "search"`: the trace showed only `runtime.search_tools` initially, then a `tool.discovery` event, then execution of `get_current_test_value`. It is deterministic and does not verify a live model's tool-selection quality. A live Ollama discovery run, real MCP discovery run, large real-world catalog/context measurement, and measured comparison against the unfiltered configuration remain optional manual/live checks. Stop here to regroup before Phase 9.
