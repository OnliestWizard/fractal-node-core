# Session State — fractal-node-core

## What this project is
A graph-based execution engine where nodes are connected by typed edges and graphs can be embedded as nodes — the fractal part. Define logic once, emit to any platform (JS, Kotlin, etc.) natively. No runtime bridges.

**Core insight:** `NodeDefinition.subgraph` is an `IExecutionGraph` — the same type it lives inside. A node IS a graph, recursively, at any depth.

---

## Current state: WORKING — 125 tests passing, 15 test files

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
npm test                                                  # vitest run (113 tests, 14 files)
npx tsc --noEmit                                          # type check (zero errors in project code)
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
| `/run` | POST | `{ graph, inputs? }` → `{ outputs }` — validates, checks registry, deserializes, executes |

`/run` error codes: 400 (missing body), 422 (validation failure or missing registry leaf), 500 (runtime error).

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

---

## Known issues
- none
