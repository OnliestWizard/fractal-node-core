



### Core Architecture & State Summary: `fractal-node-core`
`fractal-node-core` is a fully tested (135 passing tests), platform-agnostic, recursive agent compiler that treats visual workflows as an Intermediate Representation (IR), completely decoupling agent topology from execution. Instead of relying on heavy cloud runtime environments or sluggish JavaScript engines, it compiles complex agent behaviors (loops, parallel execution, tool utilization) directly into pure, native target primitives (`async/await` in modern JS/ESM, `suspend fun` in Kotlin via OkHttp, and `async throws` in Swift via URLSession) with zero runtime overhead—making it uniquely suited for low-overhead mobile apps, private offline on-device execution, and self-assembling autonomous agent networks.

#### ⚙️ Verified Working Capabilities
* **True Fractal Recursion:** A node's inner subgraph directly satisfies the top-level execution interface (`NodeDefinition.subgraph` shares the `IExecutionGraph` schema), allowing infinite nesting depths bounded by static `$input` and `$output` boundary nodes.
* **Mutually Exclusive Execution Engine:** Handles stateless leaf nodes via a `RuntimeRegistry`, looping subgraphs controlled by feedback tracking or max-iteration caps, dynamic string-coerced conditional branching routers (`MemoryOrFetch`), and multi-turn autonomous tool-calling loops (`ToolAgent`) mapping directly to OpenAI schema definitions.
* **Air-Tight Pre-Execution Validation (`core/validator.ts`):** Catches critical logical flaws before compilation, running an active DFS engine to check for `unknown_node_ref`, `unknown_port_ref`, `disconnected_input`, `multiple_inputs`, `type_mismatch` (with `any` fallbacks), and explicit structural cycles across recursive scopes.
* **Bi-Directional IDE Ecosystem:** Connects an ultra-lean Express server (port 3000) to a highly reactive, auto-layouting Vite + React Flow canvas (port 5173). Features live execution streaming over Server-Sent Events (SSE via `/run/stream`) that animates node debugging states (yellow for processing, green for success, red for failures) natively in the UI.

#### 🚀 Strategic Future Directions
1. **The Autonomous "Software Plant":** Giving coordinator LLMs access to the JSON schema and validation API so they can procedurally draft, statically verify, and compile their own optimized child-agent graphs on the fly to tackle sub-tasks safely without writing loose code scripts.
2. **Local-First & Edge Computing Play:** Utilizing the ultra-lean native code output to embed complex agent flows directly onto low-power hardware, mobile applications, or offline IoT devices executing local, privacy-centric language models entirely detached from the cloud.
3. **Interactive UI Canvas Builder:** Adding an active "Edit Mode" to the frontend that pulls from the server's `GET /capabilities` endpoint, allowing drag-and-drop node placement alongside real-time edge-mutation type validation.
