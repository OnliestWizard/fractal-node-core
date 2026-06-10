# Session State — fractal-node-core

## Graph CI — contract tests gate versioning ✓ (2026-06-10, after the demo)

probability003.md written (the evolution thesis: "every skill has a contract")
and the first piece built + live-confirmed. 221 tests (20 files), typecheck clean.

- **Spec** (`core/serializer.ts`): `SerializedGraph.tests?: GraphTestCase[]`
  — `{ name?, inputs, expect?: [{ port, equals?|contains?|exists? }], expectError? }`.
  `port` takes dot-paths; JSON-string values are parsed mid-walk so
  `result.content.path` reaches into MCP results. Also `specVersion?: string`
  + `SPEC_VERSION = '1'`, stamped by saveGraph (probability002's cheap insurance).
- **Runner** (`runGraphTests` in `lib/execute-engine.ts` — lives there to avoid
  an import cycle; pure assertion helpers + report types in `lib/graph-tests.ts`):
  executes a deep copy per case with throwOnError; expectError inverts; inherited
  allowedTools apply to test runs; no tests = vacuous pass (total 0).
- **The gate**: `save_graph` moved out of runBuiltin into an executeSubgraph
  special case (needs the pool). If the graph carries tests, they run before
  versioning — failure throws `version refused` (normal error isolation), no
  file written, no version recorded. Optional `skipTests` port bypasses
  (must be WIRED — caller inputs alone don't reach it). New `tested` output.
- **New builtin `test_graph`**: graph in → `passed, summary, results` without
  saving. Both in Plant's catalog with the test-case format documented.
- **Live-confirmed against Plant_Playground**: contract test attached to
  `playground_writer` ("writes to the requested path"), good save → test ran
  (wrote planted/contract-probe.md), version recorded tested=1. Sabotaged copy
  (hardcoded README.md path, same edit as the demo) → save REFUSED, 0 new
  versions, library copy clean. The demo's beat-4 damage is now *preventable*.
- **Sharp edge to remember**: contract tests on side-effectful graphs RUN the
  side effects — the sabotaged graph's test run itself clobbered README.md
  (restored via API after). Tests should target probe paths; sandboxes earn
  their keep here.
- `tests/graphTests.test.ts` (22 tests): path walking, expectations, runner
  semantics, gate refusal/bypass/no-tests, specVersion stamp, test_graph,
  allowedTools inheritance. graphStore tests updated for the specVersion stamp.
- **Next**: upgrade demo_real_stakes.ts beat 4 (gate refuses the sabotage,
  then skipTests force-save keeps the damage/rollback/replay beats); then the
  compounding chain demo (task B composes tested skill A, lineage across).

## Post-crash session (2026-06-10): real PATs live, work committed ✓

Laptop crashed mid-session; recovery + token swap completed:

- **Real fine-grained PATs in `.env.local` and verified.** Pasted with
  surrounding double quotes — dotenv strips them but raw shell use doesn't;
  quotes removed, file kept BOM-less. Old `GITHUB_TOKEN` /
  `GITHUB_PERSONAL_ACCESS_TOKEN` lines deleted (env file is now just
  `OPENAI_API_KEY` + the two PATs).
- **Token scopes API-probed**: READ authenticates, sees all repos, write
  attempt → 403. WRITE sees ONLY Plant_Playground, posted a comment on
  issue #1. Split behaves exactly as designed.
- **In-flight work committed and pushed**: `e99f359` "scallions" —
  dispatchId fix + regression test, mcp-pool `${VAR}` expansion, two-server
  mcp.json (secret-free), probability002.md. `playground_*` scratch
  graph/inputs/trace files added to .gitignore (matching meta_saver /
  rollback precedent). 199 tests + typecheck clean before commit.
- **Scoped graph re-run end-to-end with the real tokens** → issue #3
  (https://github.com/OnliestWizard/Plant_Playground/issues/3). Full path
  confirmed: .env.local → dotenv → `${VAR}` expansion → per-server child
  env → server-github authenticated write via `playground__create_issue`.
  (`playground_scoped_inputs.json` body rewritten first — old text claimed
  tokens were still classic placeholders.)

- **Contents write also verified**: WRITE token committed
  `probes/write-probe.md` directly via the contents API (commit 2886d2bc);
  READ token attempt → 403. So Plant can create/update files in
  Plant_Playground via `playground__create_or_update_file` /
  `playground__push_files` / branch+PR tools — full repo write surface,
  not just issues.

- **Plant file write end-to-end ✓**: Plant designed the graph pass 1/5
  (`playground_file_graph.json` — literals + 6-pair pack →
  `playground__create_or_update_file`, MCP node renamed with `builtin`
  field = live exercise of the dispatchId fix). Run created
  `planted/hello-from-plant.md` on main (commit 3bbadeb). No graph JSON
  hand-authored. Scratch triplet (`playground_file_*`) gitignored.

- **REAL STAKES DEMO ✓ — `demo_real_stakes.ts`** (probability001 "Script it",
  one command: `npx tsx demo_real_stakes.ts`). Eight beats, all live against
  Plant_Playground: (1) Plant designs the writer tool from one sentence
  (pass 1/5); (2) smoke-test run writes planted/demo-smoke-test.md;
  (3) saved to library as `playground_writer` versioned + lineage id;
  (4) sabotaged v2 hardcodes path literal "README.md"; (5) innocent run of
  v2 clobbers the repo README (real damage, real commit); (6) rollback_graph
  one call → v1 current again; (7) bad-run trace replayed at recorded pace
  (26 events); (8) restored v1 tool repairs the README — verified
  content-equal. Final run clean end-to-end.
- **Gotcha found by the demo (cost 2 broken READMEs, both repaired):**
  server-github `get_file_contents` returns `content` ALREADY DECODED but
  leaves `encoding: "base64"` stale in the JSON — decoding again yields
  mojibake. Never trust the encoding field; use content as-is. Worth noting
  in Plant's catalog if graphs start reading files via GitHub MCP.
- Library version history for `playground_writer` carries entries from the
  two buggy demo runs — harmless, arguably good receipts.

Session end: everything committed and pushed to origin/main — `e99f359`
"scallions" (token split + dispatchId fix) and `96ee31d` "peaches"
(demo_real_stakes.ts + playground_writer library entry + these notes).
Working tree clean. Next session can start from the demo: it doubles as
the product-story regression test (probability001 implication #2).

## GitHub WRITE path confirmed ✓ (2026-06-10) — Plant_Playground issue #1

First real GitHub write by a Plant-authored graph:
https://github.com/OnliestWizard/Plant_Playground/issues/1
(`Plant_Playground` is the user's sandbox repo for real-stakes demos.)

Graph (`playground_issue_graph.json`, Plant pass 1/5):
`$input(title, body) + literals(owner, repo, 4 pack keys) → pack → github__create_issue → $output(issue)`
Run: `npx tsx run_execute.ts --graph playground_issue_graph.json --inputs-file playground_issue_inputs.json`

Two real bugs found and fixed on the way:

1. **Engine: renamed MCP nodes never reached the pool.** Plant renamed the node
   `github_create_issue` with `builtin: "github__create_issue"`, but the MCP
   routing check used `nodeId.includes('__')` — renamed nodes fell through to
   `runBuiltin` → `No builtin for node`. Fix: `dispatchId = node.builtin ?? nodeId`
   computed once in `executeSubgraph` and used for ALL id-based dispatch (plant,
   plant_with_prompt, observe, execute_graph, MCP `__` routing, builtins) and the
   permission checks. New regression test in executeEngine.test.ts (47 tests in
   file, 199 total).
2. **Auth: the GitHub PAT was never actually reaching the server.**
   `@modelcontextprotocol/server-github` reads `GITHUB_PERSONAL_ACCESS_TOKEN`;
   `.env.local` only had `GITHUB_TOKEN`. All "confirmed" GitHub runs on
   2026-06-09 were unauthenticated public reads (search API allows them) — writes
   401'd. Fix: added `GITHUB_PERSONAL_ACCESS_TOKEN` (same value) to `.env.local`.
   Gotcha hit in the process: the file had no trailing newline, so `Add-Content`
   glued the new line onto `GITHUB_TOKEN`'s value; repaired by rewriting lines.

## Read-wide / write-narrow GitHub split ✓ (2026-06-10) — issue #2

User's design: Plant reads from ALL repos (asset source) but writes only to
Plant_Playground. A single fine-grained PAT can't split permissions per repo,
so: **two tokens, two MCP server entries running the same server-github**.

- `github` server → `GITHUB_PAT_READ` (read-only, all repos) → tools `github__*`
- `playground` server → `GITHUB_PAT_WRITE` (read/write, only Plant_Playground) → tools `playground__*`

This makes the infra split expressible in graph permissions too:
`allowedTools: ["github__*", "playground__*"]` etc.

- `lib/mcp-pool.ts`: server.env values now expand `${NAME}` from process.env —
  mcp.json stays secret-free and committable.
- `mcp.json`: github + playground entries, each setting
  `GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT_READ|WRITE}"`.
- `.env.local`: `GITHUB_PAT_READ` / `GITHUB_PAT_WRITE` — **real fine-grained
  PATs in place and verified (2026-06-10, post laptop crash)**. Old
  `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN` lines deleted. Verified via
  direct API probes: READ authenticates, sees all repos, write attempt → 403;
  WRITE sees ONLY Plant_Playground and successfully posted a comment on
  issue #1. Gotcha: tokens were pasted with surrounding double quotes —
  dotenv strips them but raw shell use doesn't; quotes removed, file kept
  BOM-less.
- Plumbing live-confirmed: issue #2 created via `playground__create_issue`
  (https://github.com/OnliestWizard/Plant_Playground/issues/2),
  `playground_scoped_graph.json` (= issue graph with builtin retargeted).
- Re-confirmed end-to-end with the REAL fine-grained tokens: issue #3
  (https://github.com/OnliestWizard/Plant_Playground/issues/3) — all 3 MCP
  servers connected, write went through the playground channel.
- Gotcha: PS 5.1 `Out-File -Encoding utf8` writes a BOM that run_execute's
  JSON.parse rejects — write graph JSON BOM-less.
- Note: Plant's catalog now lists ~66 MCP tools (14 fs + 26 github + 26
  playground); the duplicate GitHub toolset is intentional (different scopes).

## Execution replay (2026-06-09 late) — COMPLETE ✓ (last substrate roadmap item)

Replay = feed saved trace events back as synthetic `onEvent` calls. Nothing re-executes.
198 tests passing (19 files), typecheck clean.

- **`NodeEvent.t?: number`** — monotonic ms timestamp stamped in the engine's `emit()`
  (only diffs are meaningful). Flows into trace files via run_execute automatically.
- **`lib/replay.ts`** — `replayTrace(events, onEvent, speed)` → `ReplaySummary`
  (eventCount, nodeCount, errorCount, durationMs). speed: 0 = instant (default),
  1 = recorded pace, N = N× faster. Untimestamped (legacy) traces replay instantly.
- **`run_replay.ts`** — `npx tsx run_replay.ts --trace trace.json [--speed 1]`
  Prints timeline (▶/✓/✗, durations, depth indent), summary, recorded outputs.
- **`POST /replay`** — `{ events, speed? }` → SSE stream identical in shape to
  /execute/stream (node events + done with summary), so the editor canvas can
  animate a past run with zero execution. 400 JSON if events missing.
- **Live confirmed**: legacy meta_saver_trace.json replayed instantly (plant's
  39.9s call visible in timeline — the Plant-debugging use case); fresh
  rollback_trace.json recorded with timestamps (22ms span) and replayed at
  recorded pace.
- `tests/replay.test.ts` (8 tests): order preservation, summary, instant default,
  speed pacing, legacy traces, engine t monotonicity, SSE endpoint + 400.

---

## Substrate features (2026-06-09 evening) — versioning, permissions, lineage ✓

All three roadmap items implemented, 190 tests passing (18 files), typecheck clean.

### LIVE CONFIRMED ✓ (planted graphs, real GPT-4o + MCP)

- **meta_saver_graph.json** (Plant pass 1/5): `$input(task) → plant → save_graph("planted_child") → $output(version, graph)`. Plant picked up the new `version` output port from the updated catalog on its own.
- **Lineage live**: planted child came out stamped `id: g_3b9a1da7`, `parentGraphId: g_<runtime id of meta graph>`; both persisted in `graphs/planted_child.json` via save_graph.
- **Versioning live**: two runs (haiku task, limerick task) → two version files in `graphs/.versions/planted_child/`. Hashes distinguish content.
- **rollback_graph.json** (Plant pass 1/5): `$input(name) → list_graph_versions + rollback_graph → $output(count, restored, version)`. Run 1: count=2, restored=true, current file verified = version-1 haiku content (matching hash). Run 2 (with exact allowlist): count=3, rolled forward-back to limerick — linear history works, 4 entries total.
- **Permissions live**: `run_execute.ts` gained `--allowed-tools tool1,tool2,prefix__*` flag. Blocked run: `--allowed-tools save_graph` → `✗ plant — tool "plant" blocked by allowedTools` (before any LLM call), save_graph + $output skipped via normal error isolation. Allowed run: exact list `list_graph_versions,rollback_graph` → clean pass.

**Known gap**: a graph's runtime-assigned `id` is only persisted if the graph passes through `save_graph` — run_execute does not write the id back to the input file, so a child's `parentGraphId` may reference an id that exists nowhere on disk. Fine for now; revisit if lineage queries become a feature.

Scratch files gitignored: `meta_saver_graph/inputs/trace.json`, `rollback_graph/inputs.json`, `graphs/.versions/`.

### Graph versioning + rollback (`lib/graph-store.ts`)

Every `saveGraph(name, graph)` writes the current file AND a version copy to
`graphs/.versions/<name>/<epochMs>_<sha256-8>.json`. Duplicate content (same hash
as latest) is not re-versioned. `saveGraph` now returns the version id.

- `listVersions(name)` → `{ version, hash, timestamp }[]`, newest first
- `loadGraph(name, version?)` — version accepts full id or bare hash
- `rollbackGraph(name, version?)` — no version = previous save; restores as
  current and records the restore as a new history entry (linear history)
- `FRACTAL_GRAPHS_DIR` env var overrides the store directory (used by tests)

New builtins (in engine + Plant catalog): `save_graph` outputs `version`,
`load_graph` takes optional `version`, `list_graph_versions`, `rollback_graph`.

### Capability permissions (`lib/execute-engine.ts`)

`node.allowedTools?: string[]` (on `NodeDefinition` → flows to SerializedNode).
Top-level entry: `executeSubgraph(..., allowedTools)` (8th param, flat list).

- Permissions thread as a **stack of sets** (`string[][]`) — a tool must pass
  EVERY set, so nesting only narrows, never widens
- Patterns: exact id, `*`, trailing wildcard (`filesystem__*`)
- Gated: builtins (by dispatch key, so renamed nodes check `builtin` field),
  MCP nodes (full `server__tool` id), `plant`, `plant_with_prompt`,
  `execute_graph`, and agent tool calls (tool list filtered + dispatch guarded)
- Not gated: $input/$output, literals, observe, container nodes themselves
- Violations throw `tool "x" blocked by allowedTools` → normal error isolation

### Graph lineage (`core/serializer.ts` + engine)

`SerializedGraph` gains `id?: string`, `parentGraphId?: string`.

- Executor assigns `graph.id = g_<8 hex>` on first execution if missing
- `plant` node: planted graph gets fresh id + `parentGraphId` = current graph
- `execute_graph`: child's `parentGraphId ??=` current graph id (existing
  lineage never overwritten)
- Lineage persists through `save_graph` since it lives in the JSON

### Tests

`tests/graphStore.test.ts` (new, 9 tests) — round-trip, version history,
dedupe, load-by-version/hash, rollback default/named/empty. Uses temp dir via
`FRACTAL_GRAPHS_DIR`.
`tests/executeEngine.test.ts` +9 — permission allow/block, renamed-builtin
dispatch key, MCP wildcards, container restriction, intersection narrowing,
execute_graph gating; lineage id assignment, parent stamping, no-overwrite.

---

## Executor decision (2026-06-09)

**`lib/execute-engine.ts` is the canonical executor.** All new node types, builtins,
and control-flow semantics go there. It powers run_execute.ts, /execute/stream,
/plant, the editor run path, MCP tools, and the meta nodes.

**`core/executor.ts` is legacy** — kept for the registry/emitter pipeline
(serialize/deserialize round-trips, /run and /run/stream, emit-parity tests for
JS/Kotlin/Swift). Frozen: no new execution semantics.

Both files carry header comments stating this. The duplicated router/agent
implementations in core/executor.ts are intentionally not maintained in parallel.

`tests/executeEngine.test.ts` (37 tests) covers the canonical engine: wiring,
builtins (literal/pack/pluck/split_lines/combine_results/run_js), builtin-field
dispatch, error isolation, MCP auto-boxing, forEach/while/retry/router, observe,
execute_graph, and event depth — all with stub builtins and a fake MCP pool,
no API keys needed.

## What this project is
A graph-based execution engine where nodes are connected by typed edges and graphs can be embedded as nodes — the fractal part. Define logic once, emit to any platform (JS, Kotlin, etc.) natively. No runtime bridges.

**Core insight:** `NodeDefinition.subgraph` is an `IExecutionGraph` — the same type it lives inside. A node IS a graph, recursively, at any depth.

---

## Current state: WORKING — 172 tests passing, 17 test files

```
npx tsx run.ts                                            # 3-level demo with execution tracing
npx tsx emit.ts                                           # emits JS + Kotlin from CaptureAndTranscribe.graph.json
npx tsx run_agent.ts "your prompt"                        # RefineLoop write/judge agent (needs OPENAI_API_KEY)
npx tsx run_research.ts "https://..." "your question"     # ResearchAgent: fetch URL → answer question
npx tsx run_memory.ts write "https://..." "question"      # ResearchAndRemember: fetch + store answer
npx tsx run_memory.ts read "https://..."                  # Recall: read stored answer by key
npx tsx run_tool_agent.ts "your prompt"                   # ToolAgent: LLM-driven tool-calling loop
npx tsx run_memory_or_fetch.ts "https://..." "question"   # MemoryOrFetch: cache-hit/miss router demo
npm run server                                            # start execution server on port 3000
npm test                                                  # vitest run (172 tests, 17 files)
npm run typecheck                                         # tsc --noEmit (zero errors)
```

## Confirmed live runs
- **RefineLoop**: converged in 2 passes — judge caught unmet requirement on pass 1, writer addressed it on pass 2, DONE
- **run_memory.ts write/read**: fetched Wikipedia Memoization article, answered in one sentence, stored under URL key, recalled correctly on next run
- **run_tool_agent.ts**: hit OpenAI rate limit before completing (gpt-4o, high call volume) — switch to gpt-4o-mini for testing
- **run_memory_or_fetch.ts (hit branch)**: Memoization URL already cached from prior run — router correctly picked `"true"` branch (passthrough), returned answer instantly with no network or LLM call
- **run_memory_or_fetch.ts (miss branch)**: Dynamic Programming URL not cached — router correctly picked `"false"` branch (http_fetch → research_answer → memory_write), hit OpenAI rate limit mid-call; router branch selection itself confirmed working

---

## Graph validation (`core/validator.ts`)

`validateGraph(graph: SerializedGraph): ValidationError[]` — returns typed errors, zero errors on all real graphs.

| Error type | What it catches |
|---|---|
| `unknown_node_ref` | Edge references a node ID not in the graph |
| `unknown_port_ref` | Edge references a port ID not on the node |
| `type_mismatch` | Incompatible port types on an edge (`any` is always compatible) |
| `disconnected_input` | Required input port has no incoming edge |
| `multiple_inputs` | Two or more edges targeting the same input port |
| `cycle` | DFS cycle detection — returns the exact node IDs forming the cycle |

Recurses into subgraphs and router branches. Tools are leaf nodes (no inner graph to recurse into).

---

## `model` field

`NodeDefinition.model?: string` — flows through `NodeContract` automatically (not omitted). Lets graph JSON declare which LLM model each agent/LLM node uses. Executor uses `node.model ?? 'gpt-4o'` as fallback. `ToolAgent.graph.json` declares `"model": "gpt-4o"`.

---

## Swift emitter (`emitters/swift/emitSwift.ts`)

Third platform target (alongside JS and Kotlin). `emitGraphSwift(graph): EmittedFiles`.

| sideEffect | Swift output |
|---|---|
| `network_access` | `URLSession.shared.data(from:)` → `{ body, status }` |
| `filesystem_write` | `UserDefaults.standard.set(_:forKey:)` |
| `filesystem_read` | `UserDefaults.standard.dictionary(forKey:)` → `{ value, found }` |
| `microphone` | `AudioCapture.record()` stub |
| `camera` | `CameraCapture.captureFrame()` stub |
| `llm` | `NSError` throw stub |
| `agent` | `NSError` throw stub |

- File naming: `run` → `Main.swift`, subgraph/branch nodes → PascalCase `.swift`
- All functions: `private func name(inputs: [String: Any?] = [:]) async throws -> [String: Any?]`
- Loop: `for _ in 0..<N` with `_state.merge` feedback and `filterKeys`
- Router: `if inputs["condition"] as? String == "name"` dispatch chain
- Node calls: `try await`

---

## Type system (single source of truth: `core/types.ts`)

| Type | Purpose |
|---|---|
| `ValueType` | All allowed port value types (`string`, `number`, `boolean`, `object`, `audio`, `image`, `void`, `any`) |
| `SideEffect` | Platform capabilities a node requires (`microphone`, `camera`, `network_access`, `filesystem_write`, `filesystem_read`, `hardware_access`, `llm`) |
| `Port` | `{ id, type, optional? }` |
| `Edge` | `{ from: { nodeId, portId }, to: { nodeId, portId } }` |
| `IExecutionGraph` | Interface for graph (avoids circular import with `NodeDefinition`) |
| `NodeDefinition` | Full node: identity + ports + sideEffects + constraints + runtime (`run`, `subgraph`, `branches`, or `tools`) |
| `NodeContract` | `Omit<NodeDefinition, 'run' \| 'subgraph' \| 'branches' \| 'tools'>` — stable, serialisable promise |

---

## Node execution modes (mutually exclusive runtime fields)

| Field | Flag | Description |
|---|---|---|
| `run` | — | Leaf node — plain async function, wired from registry |
| `subgraph` | `loop?: true` | Subgraph node — runs inner graph once, or in a loop until `$output.continue === false` |
| `branches` | `router: true` | Router node — executes `branches[String(inputs.condition)]` |
| `tools` | `agent: true` | Agent node — LLM-driven tool-calling loop; tools are `NodeDefinition[]` |

---

## Subgraph boundary convention
- `$input` — boundary node, no incoming edges; output ports pre-seeded by executor with parent node's inputs
- `$output` — sink node; edges flowing into it define what the subgraph exposes as outputs

---

## Parallel execution (`core/executor.ts`)
Each node is now a Promise that awaits only its direct predecessors (`Promise.all` on predecessor promises). Nodes with no shared data dependency run concurrently — independent branches fan out automatically. Loop iterations remain sequential by design. Verified with timing tests: 3 × 50ms nodes finish in ~50ms total.

---

## Router node (`router: true`)
- **`branches`** on `NodeDefinition`: `Record<string, IExecutionGraph>` — branch name → subgraph
- **Condition**: `inputs.condition` (any type — coerced to string via `String()`). Boolean `true`/`false` maps to branch keys `"true"`/`"false"`.
- **Executor**: picks `branches[String(inputs.condition)]`, seeds its `$input` with all non-condition inputs, executes it, returns its `$output`
- **Serializer**: `SerializedNode.branches?: Record<string, SerializedGraph>`; `collectLeafIds` recurses into branches; `serialize`/`deserialize` handle branches
- **Emitters**: each branch → its own module file; router wrapper emits `if (inputs.condition === "name")` dispatch chain
- **Demo**: `node/graphs/MemoryOrFetch.graph.json` — checks memory first (`memory_read`), routes `true` (return cached) / `false` (fetch + store)

---

## Agent node (`agent: true`)
- **`tools`** on `NodeDefinition`: `NodeDefinition[]` — tool definitions available to the LLM
- **Ports**: `inputs: [prompt, system?]`, `outputs: [response]`
- **`constraints.maxTurns`**: safety ceiling for LLM turns, default 10
- **Executor loop**:
  1. Build OpenAI tool schemas from `node.tools` (port types → JSON schema)
  2. Call `gpt-4o` with `tool_choice: 'auto'`
  3. If final message → `output = { response }`
  4. If tool calls → execute all in parallel (`Promise.all`), append results, continue
  5. Repeat up to `maxTurns`
- **Serializer**: `SerializedNode.tools?: NodeContract[]` (strips `run`); `collectLeafIds` collects tool IDs; `deserialize` wires `run: registry[tool.id]` onto each tool
- **`NodeContract`** now omits `tools` (it references `NodeDefinition[]` which contains `run`)
- **Overrides**: `overrides[toolId]` takes precedence over `tool.run`, same as top-level nodes
- **Emitters**: both JS and Kotlin emit a `throw` stub — agent nodes require the fractal executor
- **Demo**: `node/graphs/ToolAgent.graph.json` + `run_tool_agent.ts` — agent with `http_fetch`, `memory_read`, `memory_write` as tools

---

## Emission design (hybrid)
Subgraph nodes → separate module/file. Leaf nodes → inline in their parent file. Import graph mirrors the node graph. Leaves are `private` in Kotlin.

JS output (3-level graph → 3 files):
- `sanitize.js` — `trim` + `lowercase` inline, exports `sanitize()`
- `pipeline.js` — imports `sanitize`, `tag` inline, exports `pipeline()`
- `index.js` — imports `pipeline`, `source` inline, exports `run()`

Kotlin: `Sanitize.kt`, `Pipeline.kt`, `Main.kt` — same structure, same package.

---

## Serialisation
- `core/serializer.ts` — `SerializedGraph` (pure JSON, no Maps/functions), `RuntimeRegistry` (leaf implementations), `serialize` / `deserialize` / `toJSON` / `fromJSON`
- `validateRegistry(data, registry)` — returns IDs of leaf nodes missing from registry (recurses into subgraphs, branches, and tool lists)
- `deserialize` calls `validateRegistry` automatically and `console.warn`s missing IDs at load time
- Topology (graph JSON) and implementations (registry) are separate. Graph files are portable; registry wires in platform-specific code.

---

## Tests (`npm test`)
| File | What it covers |
|---|---|
| `tests/graphExecution.test.ts` | `emitGraphJS` preserves topo order in output |
| `tests/roundTrip.test.ts` | graph emits to both JS and Kotlin |
| `tests/registry.test.ts` | `validateRegistry` returns correct missing IDs; `deserialize` warns / stays silent |
| `tests/llm.test.ts` | `llm_reason` returns text, passes/omits system prompt, handles empty content |
| `tests/loop.test.ts` | loop iterates correctly, stops on `continue: false`, respects `maxIterations`, non-loop subgraph unaffected |
| `tests/refineLoop.test.ts` | registry finds leaves; deserialization preserves loop metadata; JS/Kotlin emit for-loop structure |
| `tests/researchAgent.test.ts` | registry, execution order, body piping, JS emit, Kotlin emit |
| `tests/memory.test.ts` | memory_write/read logic, registry validation for ResearchAndRemember + Recall, JS/Kotlin emitter branches |
| `tests/parallel.test.ts` | independent nodes run concurrently (timing), dependent nodes stay ordered, diamond merge, error propagation |
| `tests/router.test.ts` | routes true/false/named branches, unknown branch throws, serialize round-trip, emitter dispatch |
| `tests/agent.test.ts` | single-turn, tool call + final answer, parallel multi-tool, maxTurns ceiling, overrides, unknown tool throws, serialization round-trip, registry validation, emitter stubs |
| `tests/validator.test.ts` | all 6 error types, optional ports, $input exemption, cycle detection with node list, recursive subgraph validation, all real graphs pass clean |
| `tests/swift.test.ts` | file naming, URLSession, UserDefaults read/write, loop structure, router dispatch, agent stub, async throws signatures, serialize→emit round-trip |
| `tests/server.test.ts` | /health, /capabilities shape, /validate valid+invalid graphs, /emit js+kotlin+swift+unknown, /run success+invalid graph+missing leaf+missing body |
| `tests/telemetry.test.ts` | start/complete/error events, durationMs, depth tracking for subgraphs, parallel fan-out ordering, collectEvents utility |
| `tests/stream.test.ts` | SSE content-type header, pre-stream 400/422 JSON errors, node events over wire, done event with outputs |

---

## Memory nodes

- **`node/capabilities/memory_write.ts`** — reads `.fractal_memory.json`, merges new key, writes back; inputs `{ key, value }`, outputs `{ key }`; sideEffects: `filesystem_write`
- **`node/capabilities/memory_read.ts`** — reads `.fractal_memory.json`; inputs `{ key }`, outputs `{ value, found }`; sideEffects: `filesystem_read`
- **`node/graphs/ResearchAndRemember.graph.json`** — `$input(url, question)` → `http_fetch` → `research_answer` → `memory_write(key=url)` → `$output(key)`
- **`node/graphs/Recall.graph.json`** — `$input(key)` → `memory_read` → `$output(value, found)`
- **`run_memory.ts`** — subcommands: `write <url> [question]` and `read <key>`
- **Emitters**: JS uses `localStorage.setItem/getItem`; Kotlin uses `fractal_memory.json` + `JSONObject`

---

## ResearchAgent (`http_fetch` + `research_answer`)

- **`node/capabilities/http_fetch.ts`** — wraps Node 22 built-in `fetch`; inputs `{ url, method? }`, outputs `{ body: string, status: number }`
- **`node/capabilities/research_answer_openai.ts`** — `gpt-4o-mini` streaming; takes `{ content, question }`, answers using only fetched content
- **`node/graphs/ResearchAgent.graph.json`** — `$input(url, question)` → `http_fetch` → `research_answer` → `$output(response)`
- **`run_research.ts`** — CLI runner; accepts URL and question as argv

---

## Two-agent write/judge loop (`RefineLoop`)

- **Architecture**: two nodes — `draft_writer` (gpt-4o-mini, generates) and `quality_judge` (gpt-4o, evaluates). Separation prevents self-rationalization.
- **Feedback port**: `quality_judge` outputs `{ response, continue, feedback }`. Feedback flows back to writer each iteration.
- **`node/graphs/RefineLoop.graph.json`** — top-level: `$input(prompt, system?)` → `refine` (loop, maxIter 5) → `$output(response)`
- **`run_agent.ts`** — CLI runner; streams each draft iteration with pass number and judge decision
- **Confirmed live**: converged in 4 passes with gpt-4o judge

---

## LLM node (`llm_reason`)
- **Contract**: `node/nodes/LLMReason.node.json` — inputs: `prompt`, `system?`; output: `response`; sideEffects: `["llm", "network_access"]`
- **Implementation**: `node/capabilities/llm.ts` — wraps Anthropic SDK, adaptive thinking, streaming

---

## Execution server (`server.ts`)

`createApp()` returns an Express app; `npm run server` starts it on port 3000.

| Route | Method | What it does |
|---|---|---|
| `/health` | GET | `{ ok: true }` |
| `/capabilities` | GET | Returns `CATALOG` — array of `NodeContract` for all built-in nodes |
| `/validate` | POST | `{ graph }` → `{ valid, errors }` — runs `validateGraph`, 400 if no graph |
| `/emit/:platform` | POST | `{ graph }` → `{ files }` — `js`/`kotlin`/`swift`; 400 for unknown platform |
| `/run` | POST | `{ graph, inputs?, trace? }` → `{ outputs, events? }` — validates, checks registry, deserializes, executes; `trace: true` includes full event log |
| `/run/stream` | POST | `{ graph, inputs? }` → SSE stream of `NodeEvent` objects + final `done` event |

`/run` error codes: 400 (missing body), 422 (validation failure or missing registry leaf), 500 (runtime error).
`/run/stream` pre-stream errors return plain JSON 400/422; mid-execution errors emit an SSE `error` event.

Built-in registry: `http_fetch`, `research_answer`, `draft_writer`, `quality_judge`, `memory_read`, `memory_write`, `passthrough`.

All OpenAI capability files use lazy init (`let _client; const client = () => (_client ??= new OpenAI())`) — no crash on import without API key, safe for test environments.

---

## Telemetry protocol (`core/executor.ts` + `node/tracer.ts`)

`NodeEvent` discriminated union — three event types fired by `runGraph` via the `onNode` hook:

| Event type | Fields | When |
|---|---|---|
| `start` | `nodeId, inputs, depth` | Immediately before node executes (after predecessors resolve) |
| `complete` | `nodeId, inputs, outputs, durationMs, depth` | After node succeeds |
| `error` | `nodeId, inputs, error, durationMs, depth` | On node failure (error re-thrown after event fires) |

`depth` increments for each subgraph/branch/loop level — top-level nodes are depth 0.

Two utilities in `node/tracer.ts`:
- `createTracer(label?)` — pretty-prints events to stdout with indentation by depth and timing. Used by CLI runners.
- `collectEvents()` — returns `{ hook, events[] }` for capturing all events programmatically. Used by `/run?trace=true` server endpoint and tests.

`POST /run` accepts `trace: true` in the request body → returns `{ outputs, events }` with the full event log.

`POST /run/stream` — SSE endpoint. Same body as `/run` (no `trace` flag needed). Streams `NodeEvent` objects as named SSE events in real time, then a final `done` event with outputs. Pre-execution errors (missing graph, invalid graph, missing registry) return plain JSON 400/422 before the stream opens. Mid-execution errors emit an SSE `error` event and close the stream.

```
event: node
data: {"type":"start","nodeId":"memory_read","inputs":{"key":"test"},"depth":0}

event: node
data: {"type":"complete","nodeId":"memory_read","outputs":{"value":"","found":false},"durationMs":7,"depth":0}

event: done
data: {"outputs":{"value":"","found":false}}
```

---

## Visual editor (`editor/`)

Separate Vite + React + TypeScript app. Run independently from the execution server.

```
cd editor && npm install && npm run dev   # starts on http://localhost:5173
```

Requires the execution server running on port 3000 (`npm run server` from root).

**Features:**
- Graph dropdown loaded from `GET /graphs` (6 built-in graphs)
- **✦ plant** text input — type a task, press Enter → `POST /plant` → graph renders in canvas
- Auto-layout: topological depth → left-to-right columns, nodes centered vertically per column
- Custom `FractalNode` component: input handles (left), output handles (right), port type color coding, badges: `while` / `forEach` / `retry` / `route` / `agent` / `graph`
- `▶ run` button → `POST /execute/stream` SSE → nodes animate in real time
  - `start` event → node turns yellow
  - `complete` event → node turns green
  - `error` event → node turns red
- Output panel at bottom shows graph outputs after run completes
- MiniMap, zoom controls, dark theme throughout
- All graphs (catalog + planted) run through the unified execute-engine

**Server addition:** `GET /graphs` endpoint returns all 6 built-in graph JSONs for the editor dropdown.

---

## Plant / Execute pipeline (`run_plant.ts` + `run_execute.ts`)

A separate LLM-driven pipeline that designs and runs graphs from natural language — no manual graph authoring required.

```
npx tsx run_plant.ts "describe the graph" --out graph.json
npx tsx run_execute.ts --graph graph.json --inputs-file inputs.json --out trace.json
```

### run_plant.ts — Graph Compiler

- GPT-4o designs a `SerializedGraph` from a natural-language task description
- Self-correcting loop: up to 5 passes, feeds `validateGraph` errors back to the LLM
- MCP tools loaded from `mcp.json` at startup, merged with builtins into the system prompt
- `--out` saves graph JSON for the executor

### run_execute.ts — Executor

- `--inputs-file` instead of `--inputs` (PowerShell 5.1 mangles JSON in CLI args)
- MCP connection pool: connects once, keeps alive, closes at end (60s per-call timeout)
- Topological execution via `core/topo.ts`
- Wire state: `Map<"nodeId:portId", value>` propagated along edges
- Error isolation: failed nodes skip dependents with ⚠ warning
- Full trace: nodeId, inputs, outputs, durationMs, error per node → written to JSON
- Recursive via `executeSubgraph(graph, inputs, pool, trace, depth)` — supports nested subgraphs

**Auto-boxing** for MCP `params: object` ports:
1. Already object → pass directly
2. Valid JSON string → JSON.parse
3. Newline-separated file paths → `{ paths: [...] }`
4. Anything else → `{ value: x }`

### lib/mcp-pool.ts

`callTool(serverId, toolName, args)` with 60s timeout. One pool instance per executor run.

### lib/mcp-catalog.ts

Loads MCP tools dynamically from `mcp.json`. Lossy entries: `params: object` in, `result: any` out. Node IDs: `servername__toolname`.

### mcp.json

`@modelcontextprotocol/server-filesystem` → `C:/Users/Kadie/Documents`. 14 tools.
- Documents root search times out (too large). Use specific subdirectory.
- `C:/Users/Kadie/Documents/GitHub/fractal-node-core` works (~20s for search_files).

### Builtin catalog nodes

`http_fetch`, `research_answer`, `draft_writer`, `quality_judge`, `memory_read`, `memory_write`, `passthrough`

**split_lines** — splits newline text into `{paths:[...]}` object; connects directly to MCP `params` port.

### Loop nodes (run_execute.ts) — ALL CONFIRMED WORKING ✓

**ForEach** (`forEach: true` + `subgraph`):
- Input: `items: object` (array, `{paths:[...]}`, or `{items:[...]}`)
- Subgraph `$input` must expose `item: any`; parent context inputs forwarded automatically
- Output: `results: object` (array of per-item result objects)
- **Confirmed** — Plant designed valid graph first pass; 3 items through `draft_writer`, results collected

**While** (`loop: true` + `subgraph`):
- Runs until `$output.continue === false`
- Non-`continue` outputs feed back as next iteration's `$input`
- `constraints.maxIterations` caps the loop (default 10)
- **Confirmed** — lipogram test forced 2 iterations; feedback + draft carried forward correctly; exited on judge approval
- Port naming rule: subgraph `$output` must use the same port names as subgraph `$input` for values that feed back (e.g. output `draft` not `response` if the next iteration reads `draft`)
- `continue` must NOT appear in the outer node's outputs — `runWhile` strips it before returning

**Retry** (`retry: true` + `subgraph`):
- Retries subgraph on exception up to `constraints.maxRetries` times (default 3)
- Throws if all attempts fail
- **Confirmed** — `flaky_op` failed twice, succeeded on attempt 3; exhaustion path throws correctly
- Key fix: `executeSubgraph` takes `throwOnError = false`; Retry passes `true` so node errors propagate instead of being swallowed by error isolation

### flaky_op builtin (test only)

Module-level call counter; throws `Error("flaky failure #N of M")` for first `failTimes` calls, then returns `{ result: "succeeded on attempt N" }`. Used to exercise Retry without external dependencies.

### Confirmed Working Graphs

**Search → Read → Summarize (MCP):**
```
$input(searchParams, summaryPrompt)
  → filesystem__search_files
  → filesystem__read_multiple_files   (auto-boxed: string paths → {paths:[...]})
  → draft_writer
  → $output(summary)
```

**ForEach (builtins only):**
```
$input(items: ["quantum computing", "machine learning", "blockchain"])
  → process_each (forEach)
      subgraph: $input(item) → draft_writer → $output(result)
  → $output(results: [...3 responses...])
```

### Shared execution library (`lib/execute-engine.ts`)

Extracted from `run_execute.ts` into a shared module used by both the CLI and the server.

- Export: `executeSubgraph(graph, inputs, pool, onEvent?, depth?, throwOnError?)`
- Export: `NodeEvent` type (`start` | `complete` | `error`, with nodeId + durationMs + depth)
- `onEvent` callback drives SSE streaming in `POST /execute/stream`
- `throwOnError = true` used internally by `runRetry` so node exceptions propagate

`run_execute.ts` and `run_plant.ts` are now thin CLI wrappers around `lib/execute-engine.ts` and `lib/plant.ts`.

### Shared plant library (`lib/plant.ts`)

Extracted compiler logic. Export: `plantGraph(task, maxPasses?) → Promise<SerializedGraph>`.
Used by `run_plant.ts` (CLI) and `POST /plant` (server).

### Meta-execution builtins (`plant` + `execute_graph`) — ADDED ✓

Two new builtin nodes that make the engine self-referential:

**`plant`**
- Input: `task: string`
- Output: `graph: object` (a `SerializedGraph`)
- Calls `plantGraph()` at runtime — a node that designs a graph on the fly using GPT-4o

**`execute_graph`**
- Inputs: `graph: object`, `inputs: object` (optional)
- Output: `outputs: object` (all outputs of the executed graph)
- Calls `executeSubgraph()` recursively — runs a graph as a value

Both are handled as special cases before the MCP `__` check in `executeSubgraph`, since `execute_graph` needs access to `pool` and `onEvent`. Both appear in `BUILTIN_CATALOG` in `lib/plant.ts` so Plant can design graphs that use them.

**Meta-graph pattern** (`meta_graph.json`):
```
$input(task, inputs?) → plant → execute_graph → $output(outputs)
```
At runtime: executor pauses, GPT-4o designs a new graph from `task`, executor resumes and runs that graph. Graphs that grow graphs.

**Self-improvement loop** — `code_improve_graph.json` — CONFIRMED WORKING ✓

```
npx tsx run_execute.ts --graph code_improve_graph.json --inputs-file code_improve_inputs.json --out code_improve_trace.json
```

Graph: `$input(problem, system) → while_loop → $output(code)`

While subgraph per iteration:
```
$input(problem, system, draft?, feedback?)
  → draft_writer(prompt=problem, system, draft?, feedback?)
  → quality_judge(prompt=problem, draft=response)
  → $output(draft=writer.response, feedback=judge.feedback, continue)
```

Plant generated this on pass 5/5. Three bugs were hand-fixed post-plant:
1. Outer graph had wrong edge `$input.system → while_loop.draft` (system seeded as draft)
2. Subgraph wired `quality_judge.response → $output.draft` instead of `draft_writer.response`
3. Feedback port never wired — judge critique never reached writer next iteration

Confirmed run: flatten problem, 1 iteration (gpt-4o-mini wrote it correctly first try, gpt-4o approved).
Multi-iteration path not yet exercised — flatten was too easy.

**Notes:**
- draft_writer outputs prose + code by default; add "Return only the function, no explanation." to system prompt to get raw code
- Trace captures timing events only, not intermediate port values (feedback text not visible between iterations)

### run_js builtin — ADDED ✓

Executes LLM-generated code against real test cases inside a Node.js `vm` sandbox.

```
id: run_js
inputs:  [code: string, tests: object]
outputs: [results: object, allPassed: boolean, summary: string]
```

- Strips markdown code fences from `code` before eval
- Auto-detects function name via regex (handles `function name()` and `const name =`)
- Each test: `{ args: unknown[], expected: unknown }` — calls `fn(...args)`, compares via `JSON.stringify`
- `expectError: true` on a test case — passes if the call throws, fails if it doesn't
- 5s timeout per test via `vm.runInNewContext`
- `summary` string fed to `quality_judge.testResults` — judge cannot approve code that fails tests

`quality_judge` updated: accepts optional `testResults: string` input. If present, appended to judge prompt with instruction "if all tests pass, set continue=false unless critical issue."

`code_improve_graph.json` updated: `draft_writer → run_js → quality_judge` in subgraph. `tests` threaded from outer `$input` through `while_loop` to subgraph.

**Confirmed runs:**
- flatten (7 tests): 1 pass — code was correct first try, judge approved citing test results
- chunk (8 tests incl. 2 expectError): 8 passes — writer kept fumbling the `size < 1 || !Number.isInteger(size)` validation, run_js caught every failure, judge pushed back each time until correct

### Iteration logging — ADDED ✓

`runWhile` in `lib/execute-engine.ts` now logs each pass with feedback:
```
  ── pass 1
    ✓ draft_writer
    ✓ quality_judge
  ── pass 1 done  continue=true  feedback: <first 200 chars of judge critique>
  ── pass 2
    ...
  ── pass 2 done  continue=false
```

### Multi-iteration confirmed working ✓

`deepClone` problem (3 passes):
- Pass 1: judge flagged missing Map/Set check
- Pass 2: judge flagged Map/Set check placed after generic object check — needs to be first
- Pass 3: approved — Map/Set check moved before Date/Array/Object checks, `new Date(value.getTime())` used

Confirmed: feedback flows correctly from judge → next iteration's draft_writer.

### Server endpoints (added)

| Route | Method | What it does |
|---|---|---|
| `/plant` | POST | `{ task }` → runs GPT-4o compiler, returns `{ graph }` |
| `/execute/stream` | POST | `{ graph, inputs? }` → SSE stream via execute-engine + persistent McpPool |

### Persistent MCP pool — FIXED ✓

`createApp(sharedPool?: McpPool)` — accepts an optional pre-connected pool.
`main()` creates and connects one pool at startup, passes it to `createApp(pool)`.
`/execute/stream` uses it directly — no connect/close per request.
Graceful shutdown: `SIGINT`/`SIGTERM` → `server.close()` + `pool.close()`.
Fallback: `createApp()` (no pool) creates a per-request pool — keeps tests working.

### gitignored runtime files

`.env.local`, `inputs.json`, `graph.json`, `trace.json`, `memory-store.json`
`meta_graph.json`, `meta_inputs.json`, `code_improve_inputs.json` (test/scratch files)

---

## Graph library — COMPLETE ✓

`lib/graph-store.ts` — `saveGraph(name, graph)`, `loadGraph(name)`, `listGraphs()`
- Graphs saved to `graphs/{name}.json`
- Plant lists available graphs at startup: `[plant] graph library: name1, name2`
- Plant system prompt appends library section + library section appended at end of system prompt

### New builtins (all confirmed working)

| Node | Inputs | Outputs | Purpose |
|---|---|---|---|
| `save_graph` | `name, graph` | `name, saved` | Persist graph to `graphs/` |
| `load_graph` | `name` | `graph, found` | Load graph by name |
| `pluck` | `object, key` | `value` | Extract field from object (use after execute_graph) |
| `pack` | `key1/value1..key4/value4` | `object` | Build object from named port values (use to construct execute_graph.inputs) |
| `literal` | (none) | `value` | Constant value — any node with `constraints.literal` outputs it. No builtin case needed; handled in executor before builtin dispatch. |

### Literal node pattern

```json
{ "id": "name_const", "inputs": [], "outputs": [{"id":"value","type":"string"}], "constraints": {"literal": "code_improve"} }
```

Plant now uses literal nodes for hardcoded strings (graph names, pack keys, pluck keys). Added to system prompt with examples.

### Confirmed end-to-end

Planted + executed: `name_const → load_graph → pack(key1_const, key2_const, problem, system) → execute_graph(code_improve) → pluck(key_pluck_const) → $output(code)`
- Plant produced valid graph on pass 1/5
- Executor ran literal nodes, loaded code_improve, packed inputs, ran the while loop inside, plucked result
- `add(a, b)` problem: 1 pass, judge approved

## Known issues
- `flaky_op` counter is module-level; resets only on server restart
- ~~Plant-generated while loops need manual review~~ — FIXED. Added concrete wiring example + 3 critical rules to system prompt. Re-plant of same task: pass 1/1 valid, all 3 bugs absent.

---

## Sprint — 2026-06-07 to 2026-06-09

All of the following confirmed working end-to-end.

### New builtins

| Node | Inputs | Outputs | Notes |
|---|---|---|---|
| `combine_results` | `valid: boolean, passes: number` | `combined: string` | Formats plant_with_prompt output for quality_judge |
| `observe` | `trigger?: any` | `summary, nodeCount, errorCount, events` | Snapshot of execution trace mid-run; reads `localEvents` from executor scope |
| `plant_with_prompt` | `task: string, systemPrompt: string` | `valid: boolean, passes: number` | Tests a candidate system prompt by compiling a task with it |

### `builtin` field dispatch

Plant sometimes renames builtin nodes (e.g. `pack` → `params_pack`, `observe` → `observation`). Fix: if `node.builtin` is set, executor uses that as the dispatch key instead of `node.id`. System prompt instructs Plant to set `"builtin": "<catalog-id>"` when renaming.

### Observe node

`observe` reads `localEvents` accumulated by the executor in the current subgraph scope. Optional `trigger: any` port controls execution ordering — wire any upstream output to force `observe` to run after it. Events from nested subgraphs bubble up via `parentEvents` parameter threaded through `runForEach` / `runWhile` / `runRetry`.

### Router node (execute-engine) — COMPLETE ✓

`node.router: true` + `node.branches: Record<string, SerializedGraph>`. Required input `condition: string` selects branch. Falls back to `"default"` key. All other inputs forwarded to selected branch's `$input`. `runRoute()` in `lib/execute-engine.ts`. Uses `⑂` in console.

Note: this is separate from the old `core/executor.ts` router — the execute-engine pipeline has its own parallel implementation.

### Agent node (execute-engine) — COMPLETE ✓

`node.agent: true`, optional `node.model` (default `gpt-4o-mini`), `constraints.maxTurns` (default 10). Required input `task: string`, optional `context: string`. Outputs `result: string` + `steps: object` (full tool call log). LLM function-calling loop until no tool_calls remain. Uses `◈` in console.

**Agent MCP tools** — `pool.listTools()` added to `McpPool`. At call time, `runAgent()` fetches all live MCP tool definitions and merges them with `AGENT_TOOLS` (builtins). Dispatch: if `toolName.includes('__')` → `pool.callTool()`; otherwise → `runBuiltin()`.

**Confirmed**: agent given task "Search GitHub for repos owned by OnliestWizard" → autonomously called `github__search_repositories` → summarized results. 2 turns, 0 graph wiring needed.

### GitHub MCP — WIRED ✓

`@modelcontextprotocol/server-github` added to `mcp.json`. `mcp-pool.ts` now passes `process.env` to all child processes — PAT inherited automatically from `.env.local`.

```
GITHUB_TOKEN=ghp_your_token   # add to .env.local (already gitignored)
```

40 tools live: 14 filesystem + 26 GitHub (`search_repositories`, `get_file_contents`, `create_issue`, `create_pull_request`, `list_commits`, `search_code`, `push_files`, etc.).

Note: `@modelcontextprotocol/server-github@2025.4.8` shows deprecation warning. Still works. Future swap: change `mcp.json` arg to `@github/github-mcp-server`.

**Confirmed**: `github_repos.json` graph (params_const → github__search_repositories → draft_writer → $output.summary) ran clean against real account. Found 2 repos, draft_writer summarized both.

### Plant self-improvement loop — WORKING ✓

`plant_improve_graph.json` — while loop: `draft_writer → plant_with_prompt → combine_results → quality_judge → loop`

**Critical fix**: `plant_with_prompt` must append `buildCatalogSection()` to the candidate prompt, otherwise Plant has no node catalog and fails every time. Fixed via `buildCatalogSection()` export from `lib/plant.ts`.

**Result**: 4 of 10 iterations achieved `valid=true, passes=1` (1-pass compile). Judge feedback carries to next iteration via `$output.feedback → $input.feedback → draft_writer.feedback`. Loop hits `maxIterations=10` — judge never fully approves, but prompt measurably improves.

### `buildCatalogSection()` export

`lib/plant.ts` exports `buildCatalogSection()` — returns the node catalog text without the full system template wrapper. Used by `plant_with_prompt` to append catalog to candidate prompts so they have tool knowledge.

### Substrate roadmap (curated)

**Worth building next:**
- **Graph versioning + rollback** — timestamp/hash in `save_graph`; rollback free once versioned
- **Capability permissions** — `node.allowedTools?: string[]` filter in `executeSubgraph`; important before multi-user exposure
- **Execution replay** — trace already emitted; replay = synthetic `onEvent` playback
- **Graph lineage** — thread `parentGraphId` when `execute_graph` or `plant` spawns a child

**Skip for now:** graph diffing (JSON diff is 80%), graph benchmarking (manual), graph provenance (derivable from git+trace), execution snapshots (`observe` covers this), agent sandboxing (not needed while graphs are internal).
