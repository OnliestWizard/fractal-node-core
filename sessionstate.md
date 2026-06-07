# Session State — fractal-node-core

## What this project is
A graph-based execution engine where nodes are connected by typed edges and graphs can be embedded as nodes — the fractal part. Define logic once, emit to any platform (JS, Kotlin, etc.) natively. No runtime bridges.

**Core insight:** `NodeDefinition.subgraph` is an `IExecutionGraph` — the same type it lives inside. A node IS a graph, recursively, at any depth.

---

## Current state: WORKING — type system unified, 3 levels deep confirmed

Command to run:
```
npx tsx run.ts
```

Type-check (zero errors):
```
npx tsc --noEmit
```

---

## Type system (single source of truth: `core/types.ts`)

| Type | Purpose |
|---|---|
| `ValueType` | All allowed port value types (`string`, `number`, `boolean`, `object`, `audio`, `image`, `void`, `any`) |
| `SideEffect` | Platform capabilities a node requires (`microphone`, `camera`, `network_access`, etc.) |
| `Port` | `{ id, type, optional? }` |
| `Edge` | `{ from: { nodeId, portId }, to: { nodeId, portId } }` |
| `IExecutionGraph` | Interface for graph (avoids circular import with `NodeDefinition`) |
| `NodeDefinition` | Full node: identity + ports + sideEffects + constraints + runtime (`run` or `subgraph`) |
| `NodeContract` | `Omit<NodeDefinition, 'run' \| 'subgraph'>` — the stable, serialisable promise. What you declare, not how you fulfill it. |

`NodeContract.ts` and `NodeSchema.ts` are now thin re-exports — no duplicate definitions.

---

## Graph structure in run.ts

```
source (L1)
  └─ pipeline [subgraph = enrichGraph] (L1)
       ├─ sanitize [subgraph = sanitizeGraph] (L2)
       │    ├─ trim (L3)
       │    └─ lowercase (L3)
       └─ tag (L2)
```

Input: `"  Hello World  "` → Final: `"[clean] hello world"`

---

## Subgraph boundary convention (locked in)
- `$input` — boundary node, no incoming edges; output ports pre-seeded by executor with parent node's inputs
- `$output` — sink node; edges flowing into it define what the subgraph exposes as outputs

---

## What was done

### Session 1 — Core architecture + fractal feature
- `core/types.ts` — `IExecutionGraph` interface, `subgraph?` on `NodeDefinition`
- `core/graph.ts` — `ExecutionGraph implements IExecutionGraph`
- `core/executor.ts` — `topologicalSort` (Kahn's), recursive subgraph execution, `onNode` hook, port-keyed output storage
- `core/proofs/minimal_execution_graph.ts` — fixed imports, working subgraph example
- `package.json`, `tsconfig.json` — project setup (tsx, typescript)
- `run.ts` — 3-level demo runner with execution tracing

### Session 2 — Type system unification
- `core/types.ts` — single source of truth: added `SideEffect`, `optional?` on `Port`, `description`/`version`/`tags`/`sideEffects`/`constraints` on `NodeDefinition`, `NodeContract = Omit<NodeDefinition, 'run' | 'subgraph'>`
- `core/contracts/NodeContract.ts` — collapsed to re-export (`NodeContract`, `NodePort`, `PortType`, `SideEffect`)
- `node/NodeSchema.ts` — collapsed to re-export (`ExecutionNode` = `NodeDefinition`)
- `node/NodeGraph.ts` — unified `Edge` type (was using different field names `output`/`input` vs `portId`)
- `emitters/web/emitJS.ts`, `emitters/android/emitKotlin.ts` — fixed `sideEffects?.includes()` (now optional)
- `emitters/web/emitGraphJS.ts` — added proper parameter types
- `core/proofs/minimal_execution_graph.ts` — wrapped top-level await in IIFE
- `tsconfig.json` — excluded `tests/` (broken stubs, no test runner set up yet)

---

## Known issues
- `tests/` — stubs that reference missing files and have no test runner installed; excluded from tsconfig for now
- `emitters/web/emitGraphJS.ts` — still hardcoded output, doesn't actually traverse the graph
- `node/nodes/CaptureAudio.node.json` — uses old `NodeSchema` dict shape for inputs/outputs, not wired to executor

---

### Session 4 — Emitters
- `core/topo.ts` — extracted shared `topologicalSort(nodeIds, edges)` utility
- `core/executor.ts` — updated to use shared topo sort (no behaviour change)
- `node/nodes/CaptureAudio.node.json` — updated to unified `Port[]` format
- `node/nodes/TranscribeAudio.node.json` — updated to unified `Port[]` format
- `node/graphs/CaptureAndTranscribe.graph.json` — self-contained `SerializedGraph` (no separate NodeRef, edge format unified)
- `emitters/web/emitGraphJS.ts` — real emitter: topo sorts graph, emits one async function per node (body driven by `sideEffects`), emits `run()` that threads values between nodes. Recursive for subgraph nodes (inner functions get `__`-namespaced IDs)
- `emitters/android/emitKotlin.ts` — same structure, Kotlin `suspend fun` syntax
- `tsconfig.json` — added `resolveJsonModule: true`
- `emit.ts` — demo: loads `CaptureAndTranscribe.graph.json`, emits both JS and Kotlin

JS output (from graph JSON, no code written by hand):
```javascript
async function capture_audio(inputs) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const audio_blob = await recordAudio(stream)
  return { audio_blob }
}
async function transcribe_audio(inputs) {
  // TODO: implement transcribe_audio
  throw new Error('transcribe_audio: not implemented')
}
async function run(inputs = {}) {
  const capture_audio_out = await capture_audio({})
  const transcribe_audio_out = await transcribe_audio({ audio_blob: capture_audio_out.audio_blob })
  return transcribe_audio_out
}
```

**Key design (updated — hybrid emission):** Subgraph nodes → separate module/file. Leaf nodes → inline in their parent file. Import graph mirrors the node graph exactly. Leaves are `private` in Kotlin. The emitted code structure is navigable the same way the graph is navigable — zoom into `Pipeline.kt` and you see exactly what `pipeline` contains, nothing more.

JS output (3-level graph → 3 files):
- `sanitize.js` — `trim` + `lowercase` inline, exports `sanitize()`
- `pipeline.js` — imports `sanitize`, `tag` inline, exports `pipeline()`
- `index.js` — imports `pipeline`, `source` inline, exports `run()`

Kotlin output: `Sanitize.kt`, `Pipeline.kt`, `Main.kt` — same structure, same package (no imports needed between files).

### Session 3 — Serialisation
- `core/serializer.ts` — new file:
  - `SerializedNode` — `NodeContract` + optional recursive `subgraph?: SerializedGraph`
  - `SerializedGraph` — `{ nodes: SerializedNode[], edges: Edge[] }` — pure JSON, no Maps or functions
  - `RuntimeRegistry` — `Record<string, run fn>` — leaf implementations live here, separate from topology
  - `serialize(graph)` — strips `run` and recursively serialises subgraphs
  - `deserialize(data, registry)` — reconstructs `ExecutionGraph`, looks up leaf fns from registry
  - `toJSON` / `fromJSON` — string convenience wrappers
- `run.ts` — added round-trip section: serialise → print JSON → deserialise with registry → run → verify match

Round-trip verified: `"[clean] hello world"` matches after full JSON cycle across 3 levels of nesting.

**Key design decision:** topology (graph JSON) and implementations (registry) are separate. A graph file is portable data; the registry wires in the platform-specific code. This is the bridge to the emitter vision.

---

## Up next (ideas, not committed)
- [ ] Make emitters actually traverse the graph instead of hardcoding
- [ ] Wire up `CaptureAudio.node.json` to the unified type
- [ ] Set up a real test runner (jest or vitest) and fix the test stubs
- [ ] What does "emit" mean for a subgraph node — inline expansion or separate function?
- [ ] Registry validation — warn if a leaf node has no implementation before running
