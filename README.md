# fractal-node-core

A graph execution engine for building AI agents that run natively on any platform.

Define agent logic once as a JSON graph. Emit working native code for web, Android, or iOS — no bridge layer, no runtime wrapper, no rewrite.

---

## The idea

Every node is a typed unit of work with declared inputs, outputs, and side-effects. Nodes can contain subgraphs, and subgraphs can contain nodes — recursively, at any depth. That's the fractal part.

The topology (the graph) is pure JSON. The implementations (the registry) are platform-specific functions. Keep them separate and the same agent logic runs anywhere.

---

## What's built

### Core engine

- **Graph executor** — runs a `SerializedGraph` against a `RuntimeRegistry`. Independent nodes execute in parallel automatically (`Promise.all` on predecessor promises). Dependent nodes stay ordered.
- **Loop nodes** (`loop: true`) — run a subgraph repeatedly until `$output.continue === false`. Feedback ports flow back into `$input` each iteration. Safety ceiling via `constraints.maxIterations`.
- **Router nodes** (`router: true`) — execute one of N named subgraph branches based on `inputs.condition`. Boolean `true`/`false` maps to branch keys `"true"`/`"false"`.
- **Agent nodes** (`agent: true`) — LLM-driven tool-calling loop. Declare `tools: NodeDefinition[]`, set `model` and `constraints.maxTurns`. The executor builds OpenAI tool schemas, handles parallel tool calls per turn, and loops until the model produces a final answer.
- **Graph validation** — `validateGraph(graph)` returns typed errors before execution: unknown node/port references, type mismatches on edges, disconnected required inputs, multiple edges to the same port, cycle detection with exact node list.

### Emitters

Same graph JSON → native code on three platforms:

| Platform | Target | Entry point |
|---|---|---|
| Web | JavaScript (ES modules) | `index.js` |
| Android | Kotlin (`suspend fun`) | `Main.kt` |
| iOS | Swift (`async throws`) | `Main.swift` |

Each platform handles its own I/O: `fetch` / `URLSession` / `OkHttp` for network, `localStorage` / `UserDefaults` / `SharedPreferences` for memory.

Subgraph nodes emit as separate files. Leaf nodes inline in their parent. The import graph mirrors the node graph.

### Built-in capabilities

| Node | What it does |
|---|---|
| `http_fetch` | Fetch a URL, return `{ body, status }` |
| `research_answer` | Answer a question from fetched content (gpt-4o-mini) |
| `draft_writer` | Generate a draft response (gpt-4o-mini) |
| `quality_judge` | Evaluate a draft against the original prompt (gpt-4o) |
| `memory_write` | Store a key/value to `.fractal_memory.json` |
| `memory_read` | Read a key from `.fractal_memory.json`, returns `{ value, found }` |
| `llm_reason` | Single-turn LLM call (Anthropic, adaptive thinking) |

### Agent graphs

| Graph | What it does |
|---|---|
| `RefineLoop` | Write/judge loop — draft_writer + quality_judge iterate until the judge says DONE |
| `ResearchAgent` | Fetch a URL, answer a question from the content |
| `ResearchAndRemember` | ResearchAgent + stores the answer in memory |
| `Recall` | Read a stored answer by key |
| `MemoryOrFetch` | Router — returns cached answer if found, otherwise fetches and stores |
| `ToolAgent` | LLM agent with http_fetch, memory_read, memory_write as callable tools |

---

## Running

Requires `OPENAI_API_KEY` in env for LLM runners.

```bash
# Tests (no API key needed)
npm test

# Research a URL
npx tsx run_research.ts "https://en.wikipedia.org/wiki/Memoization" "What is memoization?"

# Write/judge refinement loop
npx tsx run_agent.ts "Write a TypeScript debounce function with JSDoc, under 30 lines."

# Memory: store then recall
npx tsx run_memory.ts write "https://en.wikipedia.org/wiki/Memoization" "What is memoization?"
npx tsx run_memory.ts read "https://en.wikipedia.org/wiki/Memoization"

# Router: cache hit/miss
npx tsx run_memory_or_fetch.ts "https://en.wikipedia.org/wiki/Memoization" "What is memoization?"

# Tool-calling agent
npx tsx run_tool_agent.ts "Fetch https://en.wikipedia.org/wiki/Memoization, summarize it, then store it."
```

---

## Architecture

```
SerializedGraph (JSON)
      │
      ▼
  deserialize(graph, registry)
      │
      ▼
  ExecutionGraph  ──►  runGraph()  ──►  outputs
      │
      ├──► emitGraphJS()     →  index.js, subgraph.js, ...
      ├──► emitGraphKotlin() →  Main.kt, Subgraph.kt, ...
      └──► emitGraphSwift()  →  Main.swift, Subgraph.swift, ...
```

The registry maps leaf node IDs to platform-specific implementations. Swap the registry, keep the graph — different provider, same logic.

---

## What's next

- Execution server (`POST /run`, `POST /validate`, `POST /emit/:platform`)
- Node catalog (central registry of available node types for the editor)
- Visual editor — wire nodes in a UI, export native code
