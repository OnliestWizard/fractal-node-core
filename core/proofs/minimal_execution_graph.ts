import { ExecutionGraph } from '../graph'
import { runGraph } from '../executor'

// ── Inner graph: normalize text (trim → lowercase) ──────────────────────────
// This is a full graph that will be embedded as a single node in the outer graph.
// $input / $output are the boundary convention.

const normalizeGraph = new ExecutionGraph()

normalizeGraph.addNode({ id: '$input', inputs: [], outputs: [{ id: 'raw', type: 'string' }] })
normalizeGraph.addNode({
  id: 'trim',
  inputs:  [{ id: 'text', type: 'string' }],
  outputs: [{ id: 'trimmed', type: 'string' }],
  run: async ({ text }) => ({ trimmed: (text as string).trim() })
})
normalizeGraph.addNode({
  id: 'lowercase',
  inputs:  [{ id: 'text', type: 'string' }],
  outputs: [{ id: 'result', type: 'string' }],
  run: async ({ text }) => ({ result: (text as string).toLowerCase() })
})
normalizeGraph.addNode({ id: '$output', inputs: [{ id: 'text', type: 'string' }], outputs: [] })

normalizeGraph.addEdge({ from: { nodeId: '$input',   portId: 'raw'     }, to: { nodeId: 'trim',      portId: 'text'    } })
normalizeGraph.addEdge({ from: { nodeId: 'trim',     portId: 'trimmed' }, to: { nodeId: 'lowercase', portId: 'text'    } })
normalizeGraph.addEdge({ from: { nodeId: 'lowercase', portId: 'result' }, to: { nodeId: '$output',   portId: 'text'    } })

// ── Outer graph: capture → normalize (subgraph node) ────────────────────────
// From here, normalizeGraph is just a node. Zoom in and it's a full graph.
// That's the fractal.

const graph = new ExecutionGraph()

graph.addNode({
  id: 'capture',
  inputs:  [],
  outputs: [{ id: 'raw', type: 'string' }],
  run: async () => ({ raw: '  HELLO WORLD  ' })
})

graph.addNode({
  id: 'normalize',
  inputs:  [{ id: 'raw', type: 'string' }],
  outputs: [{ id: 'text', type: 'string' }],
  subgraph: normalizeGraph               // ← a graph, not a function
})

graph.addEdge({ from: { nodeId: 'capture', portId: 'raw' }, to: { nodeId: 'normalize', portId: 'raw' } })

;(async () => {
  const values = await runGraph(graph)
  console.log(values.get('normalize:text'))  // 'hello world'
})()
