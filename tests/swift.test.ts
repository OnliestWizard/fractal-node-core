import { describe, it, expect } from 'vitest'
import { emitGraphSwift } from '../emitters/swift/emitSwift'
import { serialize } from '../core/serializer'
import { ExecutionGraph } from '../core/graph'
import type { SerializedGraph } from '../core/serializer'
import researchData  from '../node/graphs/ResearchAgent.graph.json'
import refineData    from '../node/graphs/RefineLoop.graph.json'
import memFetchData  from '../node/graphs/MemoryOrFetch.graph.json'
import recallData    from '../node/graphs/Recall.graph.json'
import toolAgentData from '../node/graphs/ToolAgent.graph.json'

function src(graph: SerializedGraph): string {
  return Object.values(emitGraphSwift(graph)).join('\n')
}

// ── File structure ────────────────────────────────────────────────────────────

describe('Swift file naming', () => {
  it('top-level graph emits Main.swift', () => {
    const files = emitGraphSwift(researchData as SerializedGraph)
    expect(files['Main.swift']).toBeDefined()
  })

  it('subgraph node emits PascalCase .swift file', () => {
    const files = emitGraphSwift(refineData as SerializedGraph)
    expect(files['Refine.swift']).toBeDefined()
  })

  it('router branches each get their own .swift file', () => {
    const files = emitGraphSwift(memFetchData as SerializedGraph)
    expect(files['GateTrue.swift']).toBeDefined()
    expect(files['GateFalse.swift']).toBeDefined()
  })
})

// ── network_access (http_fetch) ───────────────────────────────────────────────

describe('network_access', () => {
  it('emits URLSession.shared.data call', () => {
    expect(src(researchData as SerializedGraph)).toContain('URLSession.shared.data')
  })

  it('emits body and status outputs', () => {
    const out = src(researchData as SerializedGraph)
    expect(out).toContain('"body"')
    expect(out).toContain('"status"')
  })
})

// ── filesystem_write / filesystem_read ────────────────────────────────────────

describe('filesystem_write', () => {
  it('emits UserDefaults.standard.set for memory_write', () => {
    expect(src(memFetchData as SerializedGraph)).toContain('UserDefaults.standard.set')
  })
})

describe('filesystem_read', () => {
  it('emits UserDefaults.standard.dictionary for memory_read', () => {
    expect(src(recallData as SerializedGraph)).toContain('UserDefaults.standard.dictionary')
  })

  it('emits found boolean', () => {
    expect(src(recallData as SerializedGraph)).toContain('"found"')
  })
})

// ── loop ──────────────────────────────────────────────────────────────────────

describe('loop node', () => {
  it('emits Swift for _ in 0..<N loop', () => {
    expect(src(refineData as SerializedGraph)).toContain('for _ in 0..<')
  })

  it('emits _state and _out variables', () => {
    const out = src(refineData as SerializedGraph)
    expect(out).toContain('var _state')
    expect(out).toContain('var _out')
  })

  it('emits continue break condition', () => {
    expect(src(refineData as SerializedGraph)).toContain('_out["continue"] as? Bool != true')
  })
})

// ── router ────────────────────────────────────────────────────────────────────

describe('router node', () => {
  it('emits if/else dispatch on condition', () => {
    const out = src(memFetchData as SerializedGraph)
    expect(out).toContain('inputs["condition"] as? String == "true"')
    expect(out).toContain('inputs["condition"] as? String == "false"')
  })
})

// ── agent stub ────────────────────────────────────────────────────────────────

describe('agent node', () => {
  it('emits throw stub for agent nodes', () => {
    expect(src(toolAgentData as SerializedGraph)).toContain('agent nodes must be run via the fractal executor')
  })
})

// ── async/throws signatures ───────────────────────────────────────────────────

describe('Swift function signatures', () => {
  it('wrapper functions are async throws', () => {
    const out = src(researchData as SerializedGraph)
    expect(out).toContain('async throws -> [String: Any?]')
  })

  it('leaf functions are private async throws', () => {
    const out = src(researchData as SerializedGraph)
    expect(out).toContain('private func')
    expect(out).toContain('async throws')
  })

  it('node calls use try await', () => {
    expect(src(researchData as SerializedGraph)).toContain('try await')
  })
})

// ── round-trip: serialize → emit ─────────────────────────────────────────────

describe('serialize → emitGraphSwift', () => {
  it('emits valid Swift from a programmatic graph', () => {
    const g = new ExecutionGraph()
    g.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'url', type: 'string' }] })
    g.addNode({ id: 'fetch',   inputs: [{ id: 'url', type: 'string' }], outputs: [{ id: 'body', type: 'string' }, { id: 'status', type: 'number' }], sideEffects: ['network_access'] })
    g.addNode({ id: '$output', inputs: [{ id: 'body', type: 'string' }], outputs: [] })
    g.addEdge({ from: { nodeId: '$input', portId: 'url'  }, to: { nodeId: 'fetch',   portId: 'url'  } })
    g.addEdge({ from: { nodeId: 'fetch',  portId: 'body' }, to: { nodeId: '$output', portId: 'body' } })

    const files = emitGraphSwift(serialize(g))
    expect(files['Main.swift']).toContain('URLSession.shared.data')
    expect(files['Main.swift']).toContain('func run(inputs: [String: Any?])')
  })
})
