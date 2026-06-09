# Session State — fractal-node-core

## What this project is
A graph-based execution engine where nodes are connected by typed edges and graphs can be embedded as nodes — the fractal part. Define logic once, emit to any platform (JS, Kotlin, etc.) natively. No runtime bridges.

**Core insight:** `NodeDefinition.subgraph` is an `IExecutionGraph` — the same type it lives inside. A node IS a graph, recursively, at any depth.

---

## Current state: WORKING — 135 tests passing, 16 test files

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
npm test                                                  # vitest run (135 tests, 16 files)
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

**Self-improvement loop** — plant this prompt with `run_plant.ts`:
```
Given a programming problem in 'problem', write code using draft_writer, have quality_judge
evaluate it, loop until judge approves (continue=false), return final code.
```
Test inputs: `code_improve_inputs.json` (flatten function problem).

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

## Known issues
- `flaky_op` counter is module-level; resets only on server restart
