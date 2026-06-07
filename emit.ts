import { ExecutionGraph } from './core/graph'
import { serialize } from './core/serializer'
import { emitGraphJS }     from './emitters/web/emitGraphJS'
import { emitGraphKotlin } from './emitters/android/emitKotlin'

// ── Build the 3-level graph and serialize it ─────────────────────────────────

const sanitizeGraph = new ExecutionGraph()
sanitizeGraph.addNode({ id: '$input',    inputs: [], outputs: [{ id: 'raw', type: 'string' }] })
sanitizeGraph.addNode({ id: 'trim',      inputs: [{ id: 'text', type: 'string' }], outputs: [{ id: 'trimmed', type: 'string' }] })
sanitizeGraph.addNode({ id: 'lowercase', inputs: [{ id: 'text', type: 'string' }], outputs: [{ id: 'result',  type: 'string' }] })
sanitizeGraph.addNode({ id: '$output',   inputs: [{ id: 'text', type: 'string' }], outputs: [] })
sanitizeGraph.addEdge({ from: { nodeId: '$input',    portId: 'raw'     }, to: { nodeId: 'trim',      portId: 'text'   } })
sanitizeGraph.addEdge({ from: { nodeId: 'trim',      portId: 'trimmed' }, to: { nodeId: 'lowercase', portId: 'text'   } })
sanitizeGraph.addEdge({ from: { nodeId: 'lowercase', portId: 'result'  }, to: { nodeId: '$output',   portId: 'text'   } })

const enrichGraph = new ExecutionGraph()
enrichGraph.addNode({ id: '$input',   inputs: [], outputs: [{ id: 'raw', type: 'string' }] })
enrichGraph.addNode({ id: 'sanitize', inputs: [{ id: 'raw',  type: 'string' }], outputs: [{ id: 'text',   type: 'string' }], subgraph: sanitizeGraph })
enrichGraph.addNode({ id: 'tag',      inputs: [{ id: 'text', type: 'string' }], outputs: [{ id: 'tagged', type: 'string' }] })
enrichGraph.addNode({ id: '$output',  inputs: [{ id: 'result', type: 'string' }], outputs: [] })
enrichGraph.addEdge({ from: { nodeId: '$input',   portId: 'raw'    }, to: { nodeId: 'sanitize', portId: 'raw'    } })
enrichGraph.addEdge({ from: { nodeId: 'sanitize', portId: 'text'   }, to: { nodeId: 'tag',      portId: 'text'   } })
enrichGraph.addEdge({ from: { nodeId: 'tag',      portId: 'tagged' }, to: { nodeId: '$output',  portId: 'result' } })

const graph = new ExecutionGraph()
graph.addNode({ id: 'source',   inputs: [], outputs: [{ id: 'raw', type: 'string' }] })
graph.addNode({ id: 'pipeline', inputs: [{ id: 'raw', type: 'string' }], outputs: [{ id: 'result', type: 'string' }], subgraph: enrichGraph })
graph.addEdge({ from: { nodeId: 'source', portId: 'raw' }, to: { nodeId: 'pipeline', portId: 'raw' } })

const serialized = serialize(graph)

// ── Emit and print ───────────────────────────────────────────────────────────

function printFiles(files: Record<string, string>, platform: string): void {
  const names = Object.keys(files).sort()
  console.log(`\n${'═'.repeat(52)}`)
  console.log(`  ${platform}  —  ${names.length} file${names.length !== 1 ? 's' : ''}: ${names.join(', ')}`)
  console.log(`${'═'.repeat(52)}`)
  for (const [filename, content] of Object.entries(files).sort()) {
    console.log(`\n── ${filename} ${'─'.repeat(48 - filename.length)}`)
    console.log(content)
  }
}

printFiles(emitGraphJS(serialized),     'Web (JavaScript)')
printFiles(emitGraphKotlin(serialized), 'Android (Kotlin)')
