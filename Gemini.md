### 🧠 Strategic Architectural Analysis & Execution Plan

#### 🏗️ The Critical Diagnostic: Dynamic Loop Support (The Fork in the Road)
To prevent your Graph IR from breaking into chaotic, un-trackable cycles, **loops must remain strictly forbidden as structural edge cycles in the DAG, but supported completely via First-Class Flow Nodes.** * **The Architecture Rule:** The graph topology remains an absolutely acyclic, topologically sortable DAG. Iterative behavior (`ForEach`, `While`, `Retry`) is encapsulated *inside* the execution boundaries of a specific node definition. 
* **Why this is crucial for your 4GB RAM machine:** If loops are drawn as raw backward structural edges, your topological sorter (`Kahn's algorithm`) instantly breaks, execution state tracking overflows, and parallel dependency resolving becomes algorithmically impossible. By enforcing an acyclic top-level structure and handling iterations as scoped, state-isolated inner runner loops, the runtime maintains a predictable memory footprint and clean, deterministic event tracing.

#### 🎯 Missed Runtime Concepts (Fix Before Coding `run_execute.ts`)
1. **The Object Injection Bridge (Structural Type Coercion):** As Claude noted in item 4, primitive string types (like `directory_path`) will crash when hitting MCP schemas expecting structured objects. The runtime needs a lightweight, silent auto-boxing layer: if an incoming edge drops a primitive value into a port expecting an `object`, wrap it automatically as ` { value: X } ` or map it to the first top-level property of the tool's schema.
2. **Persistent STDIO Standard Stream Multiplexing:** If `run_execute.ts` spawns a new shell process for your MCP filesystem server every single time an individual node executes, it will leak memory and run incredibly slowly. Connected MCP child processes must be initialized *once* at runtime startup, held open in a stateful connection pool, multiplexed during execution, and cleanly terminated at the final `$output` boundary.
3. **Upstream Error Isolation & Cascading Halts:** If a file-read tool fails midway through a 5-node pipeline, how does the runtime react? You need to explicitly catch leaf failures, write a partial `error` event block to your trace log, and instantly abort downstream dependent nodes while avoiding a full engine crash.

#### 🖨️ Complete Blueprint for `run_execute.ts` Implementation
* **CLI Interface:** Accept parameters via flat strings, parsing inputs safely: `npx tsx run_execute.ts --graph ./graph.json --inputs '{"directory_path":"C:/Users"}' --out ./trace.json`
* **Isolated Wire State Map:** Track execution progress using a flat, immutable dictionary structure: `Record<string, any>` where the lookups map explicitly to `"nodeId:portId"`.
* **The Unified Dispatched Runner:**
  ```typescript
  // Core runtime execution dispatcher block inside run_execute.ts
  async function executeNode(node: SerializedNode, currentWireState: Map<string, any>, mcpPool: MCPProcessPool) {
    if (node.id.includes('__')) {
      const [serverName, toolName] = node.id.split('__');
      const rawInputs = gatherInputsForNode(node, currentWireState);
      const coercedInputs = typeof rawInputs !== 'object' ? { value: rawInputs } : rawInputs;
      
      const startTime = performance.now();
      try {
        const mcpResult = await mcpPool.getConnection(serverName).callTool(toolName, coercedInputs);
        return { result: mcpResult, duration: performance.now() - startTime, error: null };
      } catch (err) {
        return { result: null, duration: performance.now() - startTime, error: err.message };
      }
    }
    // Fall back to native primitive processing ($input, $output, passthrough)
  }
