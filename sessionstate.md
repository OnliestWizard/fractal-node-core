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
