# Session State — fractal-node-core

## What this project is
A graph-based execution engine where nodes are connected by typed edges and graphs can be embedded as nodes — the fractal part. Define logic once, emit to any platform (JS, Kotlin, etc.) natively. No runtime bridges.

**Core insight:** `NodeDefinition.subgraph` is an `IExecutionGraph` — the same type it lives inside. A node IS a graph, recursively, at any depth.

---

## Current state: WORKING — first agent graph built, 18 tests passing

```
npx tsx run.ts       # 3-level demo with execution tracing
npx tsx emit.ts      # emits JS + Kotlin from CaptureAndTranscribe.graph.json
npm test             # vitest run (18 tests, 6 files)
npx tsc --noEmit     # type check (zero errors in project code)
```

---

## Type system (single source of truth: `core/types.ts`)

| Type | Purpose |
|---|---|
| `ValueType` | All allowed port value types (`string`, `number`, `boolean`, `object`, `audio`, `image`, `void`, `any`) |
| `SideEffect` | Platform capabilities a node requires (`microphone`, `camera`, `network_access`, `filesystem_write`, `hardware_access`, `llm`) |
| `Port` | `{ id, type, optional? }` |
| `Edge` | `{ from: { nodeId, portId }, to: { nodeId, portId } }` |
| `IExecutionGraph` | Interface for graph (avoids circular import with `NodeDefinition`) |
| `NodeDefinition` | Full node: identity + ports + sideEffects + constraints + runtime (`run` or `subgraph`) |
| `NodeContract` | `Omit<NodeDefinition, 'run' \| 'subgraph'>` — stable, serialisable promise |

`NodeContract.ts` and `NodeSchema.ts` are thin re-exports — no duplicate definitions.

---

## Subgraph boundary convention
- `$input` — boundary node, no incoming edges; output ports pre-seeded by executor with parent node's inputs
- `$output` — sink node; edges flowing into it define what the subgraph exposes as outputs

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
- `validateRegistry(data, registry)` — returns IDs of leaf nodes missing from registry (skips boundary + subgraph nodes recursively); exported for explicit pre-flight checks
- `deserialize` calls `validateRegistry` automatically and `console.warn`s missing IDs at load time, not execution time
- Topology (graph JSON) and implementations (registry) are separate. Graph files are portable; registry wires in platform-specific code.
- Round-trip verified: `"[clean] hello world"` matches after full JSON cycle across 3 levels.

---

## Tests (`npm test`)
| File | What it covers |
|---|---|
| `tests/graphExecution.test.ts` | `emitGraphJS` preserves topo order in output |
| `tests/roundTrip.test.ts` | graph emits to both JS and Kotlin |
| `tests/registry.test.ts` | `validateRegistry` returns correct missing IDs; `deserialize` warns / stays silent |
| `tests/llm.test.ts` | `llm_reason` returns text, passes/omits system prompt, handles empty content |
| `tests/loop.test.ts` | loop iterates correctly, stops on `continue: false`, respects `maxIterations`, non-loop subgraph unaffected |
| `tests/refineLoop.test.ts` | registry finds `refine_draft` as only leaf; deserialization preserves loop metadata; JS/Kotlin emit for-loop structure |

---

## LoopNode

- **`loop?: boolean`** on `NodeDefinition` — flows through `NodeContract` → `SerializedNode` automatically
- **`maxIterations?: number`** on `constraints` — safety ceiling, default 10
- **Executor**: loop branch runs subgraph in a `for` loop; feeds `$output` back into `$input` each iteration; stops when `$output.continue === false` or ceiling hit; strips `continue` from final output
- **JS emitter**: `emitLoopBody` emits `for` loop with `_state` feedback object; `emitModule` detects `node.loop` and routes to it
- **Kotlin emitter**: same pattern using `toMutableMap()` / `filterKeys`
- **Convention**: subgraph must include a `continue: boolean` port on `$output`; anything else on `$output` is fed back as `$input` on the next iteration

---

## First agent graph (`RefineLoop`)

- **`node/graphs/RefineLoop.graph.json`** — top-level graph: `$input(prompt, system?)` → `refine` (loop node) → `$output(response)`
- **`node/nodes/RefineDraft.node.json`** — contract for `refine_draft`: takes `{ prompt, system?, response? }`, outputs `{ response, continue }`
- **`node/capabilities/refine_draft.ts`** — implementation: calls `claude-opus-4-8`; on first iteration writes a draft; on subsequent iterations improves the previous draft; appends `[DONE]` or `[CONTINUE]` which the node parses to set the `continue` boolean; marker is stripped from the returned `response`
- **Loop mechanics**: `refine` loop node (maxIterations: 5) feeds `$output.response` back into `$input.response` each iteration; the initial `prompt` persists unchanged
- **Emitted output**: JS emits `refine.js` with a `for` loop and `_state` object; Kotlin emits `Refine.kt` with a `for (_i in 0 until N)` loop

---

## LLM node (`llm_reason`)
- **Contract**: `node/nodes/LLMReason.node.json` — inputs: `prompt` (string), `system` (string, optional); output: `response` (string); sideEffects: `["llm", "network_access"]`
- **Implementation**: `node/capabilities/llm.ts` — wraps Anthropic SDK, adaptive thinking, streaming via `.stream().finalMessage()`
- **JS emitter**: `sideEffects: ["llm"]` branch in `emitGraphJS.ts` emits Anthropic streaming call inline
- **Kotlin emitter**: same branch in `emitKotlin.ts` emits `AnthropicOkHttpClient` call
- **Direction**: this is the foundation for agent capabilities — next step is wiring `llm_reason` into a graph and building agent loop primitives (see `Gpt.md`)

---

## Known issues
- none
