Before writing any more code, I want to lock in the architecture.

Current state:

✓ Recursive graph execution works
✓ Graphs can contain graphs (NodeDefinition.subgraph)
✓ Serialization/deserialization works
✓ Registry validation works
✓ JS and Kotlin emitters work
✓ Planner agent can synthesize valid graphs
✓ Validator + self-correction loop can repair graphs
✓ MCP tool catalog is loading successfully

The project is no longer a graph library.

Treat it as an AGENT RUNTIME.

Core philosophy:

Repository
 ├─ Memory
 ├─ Tool Catalog
 ├─ Graph Definitions
 ├─ Agent Definitions
 ├─ Execution Traces
 └─ Runtime

Agents should be portable.

An agent should be able to enter a repository, discover capabilities, discover memory, discover graphs, and compose new graphs from available resources.

The repository provides context.
The agent provides reasoning.

Immediate task:

Build run_execute.ts.

Requirements:

1. Read generated graph JSON.
2. Topologically execute nodes.
3. Maintain wire state as:
   nodeId:portId -> value
4. Feed $input from CLI-provided inputs.
5. Execute MCP tools using their namespaced IDs.
6. Pass outputs through graph edges.
7. Capture full execution trace:
   - node
   - inputs
   - outputs
   - timing
   - errors
8. Write trace to disk.
9. Return final $output values.

Design goals:

- Execution must be inspectable.
- Every value flowing through the graph should be traceable.
- Runtime should not contain hardcoded tool logic.
- Tools are discovered from the catalog.
- Planner produces graphs.
- Runtime executes graphs.
- Validator protects runtime.

Open architecture question:

Should loops remain forbidden DAG violations, or should loops become first-class nodes (ForEach, While, Retry, Router) so execution graphs remain acyclic while still supporting iterative behavior?

Please analyze this architecture critically before implementing run_execute.ts and identify any missing runtime concepts.
