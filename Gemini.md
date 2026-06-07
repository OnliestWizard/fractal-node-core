### Project Status: fractal-node-core (Graph-Based Multi-Target Agent Compiler)
`fractal-node-core` is a fully validated, platform-agnostic, recursive engine that compiles AI agent logic directly into pure, native target code (JS/ESM, Kotlin, Swift) without runtime bridges or wrappers. The project features a true fractal architecture where a node can recursively encapsulate a subgraph (`NodeDefinition.subgraph` shares the `IExecutionGraph` interface).

#### 1. CURRENT CURRENT WORKING STATE (100% Tested)
* **Robust Test Suite:** 98 passing vitest tests across 13 files covering parallel execution, routing, agent loops, serialization, and cross-platform emitters.
* **Air-Tight Static Validation (`core/validator.ts`):** Pre-execution pass detecting `unknown_node_ref`, `unknown_port_ref`, `type_mismatch` (with `any` fallback), `disconnected_input`, `multiple_inputs`, and full DFS recursive loop/cycle detection returning exact node path lists.
* **Mutually Exclusive Execution Modes:**
  * `run`: Stateful/stateless leaf capability implementations mapped at runtime via a decoupled `RuntimeRegistry`.
  * `subgraph` (+ `loop: true`): Sequentially loops an inner graph tracking feedback ports and halting safely via `$output.continue === false` or a structural `constraints.maxIterations` ceiling.
  * `branches` (+ `router: true`): Dynamically resolves and evaluates conditional subgraphs by mapping runtime inputs to stringified keys (e.g., `"true"`/`"false"` or named branches).
  * `tools` (+ `agent: true`): Native multi-turn autonomous LLM loop. Compiles `NodeDefinition[]` tool arrays dynamically into OpenAI schema tools, executes tool calls in parallel using dependency resolution, tracks state up to `maxTurns`, and exposes a string-based `model` parameter mapping directly from the serialization boundary.
* **Verified End-to-End CLI Agents:** * `RefineLoop`: Writer/Judge autonomous self-correction loop (converges successfully in live runs).
  * `MemoryOrFetch`: Router-based cache agent that dynamically selects a fast local read branch vs. a live web-scrape-and-write branch based on storage state.
  * `ToolAgent`: Full tool-calling executor exposing `http_fetch`, `memory_read`, and `memory_write` to an LLM.

#### 2. EMISSION MODEL & IMPLEMENTATION DETAIL
The engine functions similarly to an LLVM infrastructure: Graph JSON acts as the Intermediary Representation (IR), and emitters behave like platform-specific backends. Subgraphs and branches emit into a clean modular file directory hierarchy matching the architecture, while leaf nodes are gracefully inlined. 
* **JS Target:** Outputs clean modern ES Modules utilizing native `fetch` and `localStorage`.
* **Kotlin Target:** Outputs idiomatic structured concurrency via `suspend fun` using `OkHttp` and file-based state serialization.
* **Swift Target:** Outputs modern iOS/macOS code utilizing `async throws`, standard `URLSession`, and `UserDefaults` storage.
Loops are emitted using flat, highly performant variable-tracking conditional scopes to completely isolate memory allocation footprints on mobile targets.

#### 3. STRATEGIC VISION & IMMEDIATE ROADMAP
The long-term objective is to establish the industry-standard "Compiler Infrastructure for Cross-Platform AI Agents," decoupling orchestration design from physical deployment constraints. To scale this prototype into a full production eco-system, development will focus on four explicit phases:
* **Compiler-as-a-Service Execution Server:** A high-throughput API exposing `POST /validate` and `POST /emit/:platform` endpoints, featuring cloud-level request-throttling/queueing layers to mitigate provider rate limits (like HTTP 429 errors encountered during dense parallel tool calls), and returning a structured multi-file payload manifest.
* **Strict Binary/Data Serialization Layer:** Implementing a unified cross-platform serialization standard (such as Protocol Buffers or a rigid schema-mapping protocol) to pass complex binary objects like `audio` or `image` streams seamlessly over native target boundaries without a bridge layer.
* **Cross-Platform Telemetry/Tracing Protocol:** Standardizing a universal execution telemetry contract (`onNodeStart`, `onNodeError`) emitted directly into target files to allow real-time debugging and visual instrumentation of native mobile apps from an external host.
* **Fractal Visual Editor (Infinite Zoom UI):** A local-first, reactive editor built on an abstraction like React Flow. Leverages the recursive nature of the engine to allow an "infinite portal zoom" into nested subgraphs, bounding internal workspaces visually with immutable left-column `$input` and right-column `$output` anchor blocks, while executing background validations dynamically on every canvas edge-mutation.
