AGENT RUNTIME VISION

fractal-node-core becomes the execution engine for graph-defined agents.

Keep the core engine generic. Agent behavior comes from capabilities registered in the RuntimeRegistry (llm_reason, web_search, file_read, github_commit, etc.).

An agent is just a graph:

Goal
 ↓
Planner
 ↓
Research
 ↓
Evaluate
 ↓
Act
 ↓
Verify

Each step can itself be a subgraph, recursively:

Research
 ├─ Search
 ├─ Read
 └─ Summarize

Act
 ├─ Write File
 ├─ Open PR
 └─ Send Message

Because NodeDefinition.subgraph is IExecutionGraph, agents can decompose into smaller agents indefinitely while using the same execution model at every level.

The engine remains responsible only for:
- Execution
- Serialization
- Validation
- Emission
- Tracing

The runtime adds:
- LLM access
- Tool access
- Memory
- Permissions
- Retries
- Context

Result: agents become portable graph assets that can be stored in Git, versioned, serialized, emitted, shared, modified by other agents, and executed on any platform using the same fractal graph structure.


## Open Architectural Decision

Execution Model

Current:
- DAG only
- Topological execution

Options:
1. DAG only
2. DAG + explicit LoopNode
3. General cyclic graph

Current recommendation:
DAG + LoopNode

Reason:
Preserves deterministic execution, simple emitters, simple serialization, and supports agent refinement loops without abandoning topological execution.
