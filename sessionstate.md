# Session State — fractal-node-core

## What this project is
A graph-based execution engine where nodes are connected by typed edges and graphs can be embedded as nodes — the fractal part. Define logic once, emit to any platform (JS, Kotlin, etc.) natively. No runtime bridges.

**Core insight:** `NodeDefinition.subgraph` is an `IExecutionGraph` — the same type it lives inside. A node IS a graph, recursively, at any depth.

---

## Current state: WORKING — test suite live, registry validation in

```
npx tsx run.ts       # 3-level demo with execution tracing
npx tsx emit.ts      # emits JS + Kotlin from CaptureAndTranscribe.graph.json
npm test             # vitest run (5 tests, 3 files)
npx tsc --noEmit     # type check (zero errors)
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

---

## Known issues
- none
