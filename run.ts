import { ExecutionGraph } from './core/graph'
import { runGraph } from './core/executor'

const INPUT = '  Hello World  '

// ── Level 3 (innermost): trim → lowercase ────────────────────────────────────

const sanitizeGraph = new ExecutionGraph()

sanitizeGraph.addNode({ id: '$input', inputs: [], outputs: [{ id: 'raw', type: 'string' }] })
sanitizeGraph.addNode({
  id: 'trim',
  inputs:  [{ id: 'text', type: 'string' }],
  outputs: [{ id: 'trimmed', type: 'string' }],
  run: async ({ text }) => ({ trimmed: (text as string).trim() })
})
sanitizeGraph.addNode({
  id: 'lowercase',
  inputs:  [{ id: 'text', type: 'string' }],
  outputs: [{ id: 'result', type: 'string' }],
  run: async ({ text }) => ({ result: (text as string).toLowerCase() })
})
sanitizeGraph.addNode({ id: '$output', inputs: [{ id: 'text', type: 'string' }], outputs: [] })

sanitizeGraph.addEdge({ from: { nodeId: '$input',    portId: 'raw'     }, to: { nodeId: 'trim',      portId: 'text'   } })
sanitizeGraph.addEdge({ from: { nodeId: 'trim',      portId: 'trimmed' }, to: { nodeId: 'lowercase', portId: 'text'   } })
sanitizeGraph.addEdge({ from: { nodeId: 'lowercase', portId: 'result'  }, to: { nodeId: '$output',   portId: 'text'   } })

// ── Level 2 (middle): sanitize (subgraph) → tag ──────────────────────────────

const enrichGraph = new ExecutionGraph()

enrichGraph.addNode({ id: '$input', inputs: [], outputs: [{ id: 'raw', type: 'string' }] })
enrichGraph.addNode({
  id: 'sanitize',
  inputs:  [{ id: 'raw', type: 'string' }],
  outputs: [{ id: 'text', type: 'string' }],
  subgraph: sanitizeGraph                    // ← level 3 lives here
})
enrichGraph.addNode({
  id: 'tag',
  inputs:  [{ id: 'text', type: 'string' }],
  outputs: [{ id: 'tagged', type: 'string' }],
  run: async ({ text }) => ({ tagged: `[clean] ${text}` })
})
enrichGraph.addNode({ id: '$output', inputs: [{ id: 'result', type: 'string' }], outputs: [] })

enrichGraph.addEdge({ from: { nodeId: '$input',   portId: 'raw'    }, to: { nodeId: 'sanitize', portId: 'raw'    } })
enrichGraph.addEdge({ from: { nodeId: 'sanitize', portId: 'text'   }, to: { nodeId: 'tag',      portId: 'text'   } })
enrichGraph.addEdge({ from: { nodeId: 'tag',      portId: 'tagged' }, to: { nodeId: '$output',  portId: 'result' } })

// ── Level 1 (outer): source → pipeline (subgraph) ────────────────────────────

const graph = new ExecutionGraph()

graph.addNode({
  id: 'source',
  inputs:  [],
  outputs: [{ id: 'raw', type: 'string' }],
  run: async () => ({ raw: INPUT })
})
graph.addNode({
  id: 'pipeline',
  inputs:  [{ id: 'raw', type: 'string' }],
  outputs: [{ id: 'result', type: 'string' }],
  subgraph: enrichGraph                      // ← level 2 lives here
})

graph.addEdge({ from: { nodeId: 'source', portId: 'raw' }, to: { nodeId: 'pipeline', portId: 'raw' } })

// ── Run ───────────────────────────────────────────────────────────────────────

const LABELS: Record<number, string> = { 0: 'L1', 1: 'L2', 2: 'L3' }
const pad = (depth: number) => '  '.repeat(depth)
const fmt = (v: Record<string, any>) =>
  Object.keys(v).length === 0 ? '(none)' : JSON.stringify(v)

;(async () => {
  let step = 0

  console.log('═══════════════════════════════════════════════')
  console.log('  FRACTAL NODE EXECUTION  —  3 levels deep')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Input: "${INPUT}"`)
  console.log()

  const values = await runGraph(graph, {}, (id, inputs, output, depth) => {
    step++
    const prefix = pad(depth)
    const label  = LABELS[depth] ? `[${LABELS[depth]}]` : `[L${depth + 1}]`
    const marker = depth > 0 ? '↳ ' : ''
    console.log(`${prefix}${label} [${step}] ${marker}${id}`)
    console.log(`${prefix}      in : ${fmt(inputs)}`)
    console.log(`${prefix}      out: ${fmt(output)}`)
    console.log()
  })

  console.log('═══════════════════════════════════════════════')
  console.log('  FINAL VALUES')
  console.log('═══════════════════════════════════════════════')
  for (const [key, val] of values) {
    console.log(`  ${key.padEnd(20)}  →  "${val}"`)
  }
})()
