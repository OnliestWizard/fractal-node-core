import { describe, it, expect } from 'vitest'
import { validateGraph } from '../core/validator'
import type { SerializedGraph } from '../core/serializer'
import researchData   from '../node/graphs/ResearchAgent.graph.json'
import refineData     from '../node/graphs/RefineLoop.graph.json'
import memFetchData   from '../node/graphs/MemoryOrFetch.graph.json'
import toolAgentData  from '../node/graphs/ToolAgent.graph.json'

// ── Helpers ───────────────────────────────────────────────────────────────

function minimalGraph(): SerializedGraph {
  return {
    nodes: [
      { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
      { id: 'leaf',    inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'y', type: 'string' }] },
      { id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] },
    ],
    edges: [
      { from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'leaf',    portId: 'x' } },
      { from: { nodeId: 'leaf',   portId: 'y' }, to: { nodeId: '$output', portId: 'y' } },
    ],
  }
}

function errorTypes(graph: SerializedGraph) {
  return validateGraph(graph).map(e => e.type)
}

// ── Valid graphs produce no errors ────────────────────────────────────────

describe('valid graphs', () => {
  it('minimal graph passes', () => {
    expect(validateGraph(minimalGraph())).toHaveLength(0)
  })

  it('ResearchAgent graph passes', () => {
    expect(validateGraph(researchData as SerializedGraph)).toHaveLength(0)
  })

  it('RefineLoop graph passes', () => {
    expect(validateGraph(refineData as SerializedGraph)).toHaveLength(0)
  })

  it('MemoryOrFetch graph passes', () => {
    expect(validateGraph(memFetchData as SerializedGraph)).toHaveLength(0)
  })

  it('ToolAgent graph passes', () => {
    expect(validateGraph(toolAgentData as SerializedGraph)).toHaveLength(0)
  })
})

// ── unknown_node_ref ──────────────────────────────────────────────────────

describe('unknown_node_ref', () => {
  it('detects edge from a missing node', () => {
    const g = minimalGraph()
    g.edges.push({ from: { nodeId: 'ghost', portId: 'x' }, to: { nodeId: '$output', portId: 'y' } })
    const errs = validateGraph(g)
    expect(errs.some(e => e.type === 'unknown_node_ref' && (e as any).nodeId === 'ghost')).toBe(true)
  })

  it('detects edge to a missing node', () => {
    const g = minimalGraph()
    g.edges.push({ from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'nowhere', portId: 'x' } })
    const errs = validateGraph(g)
    expect(errs.some(e => e.type === 'unknown_node_ref' && (e as any).nodeId === 'nowhere')).toBe(true)
  })
})

// ── unknown_port_ref ──────────────────────────────────────────────────────

describe('unknown_port_ref', () => {
  it('detects edge from a nonexistent output port', () => {
    const g = minimalGraph()
    g.edges[0] = { from: { nodeId: '$input', portId: 'NOPE' }, to: { nodeId: 'leaf', portId: 'x' } }
    expect(errorTypes(g)).toContain('unknown_port_ref')
  })

  it('detects edge to a nonexistent input port', () => {
    const g = minimalGraph()
    g.edges[0] = { from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'leaf', portId: 'NOPE' } }
    expect(errorTypes(g)).toContain('unknown_port_ref')
  })
})

// ── type_mismatch ─────────────────────────────────────────────────────────

describe('type_mismatch', () => {
  it('detects string → number mismatch', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
        { id: 'sink',    inputs: [{ id: 'x', type: 'number' }], outputs: [] },
      ],
      edges: [{ from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'sink', portId: 'x' } }],
    }
    expect(errorTypes(g)).toContain('type_mismatch')
  })

  it('any source is compatible with any destination type', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: '$input', inputs: [], outputs: [{ id: 'x', type: 'any' }] },
        { id: 'sink',   inputs: [{ id: 'x', type: 'number' }], outputs: [] },
      ],
      edges: [{ from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'sink', portId: 'x' } }],
    }
    expect(errorTypes(g)).not.toContain('type_mismatch')
  })

  it('typed source compatible with any destination', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: '$input', inputs: [], outputs: [{ id: 'x', type: 'string' }] },
        { id: 'sink',   inputs: [{ id: 'x', type: 'any' }], outputs: [] },
      ],
      edges: [{ from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'sink', portId: 'x' } }],
    }
    expect(errorTypes(g)).not.toContain('type_mismatch')
  })
})

// ── disconnected_input ────────────────────────────────────────────────────

describe('disconnected_input', () => {
  it('detects a required input with no incoming edge', () => {
    const g = minimalGraph()
    g.edges = g.edges.filter(e => e.to.nodeId !== 'leaf')  // disconnect leaf's input
    expect(errorTypes(g)).toContain('disconnected_input')
  })

  it('optional inputs are not reported as disconnected', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
        { id: 'leaf',    inputs: [{ id: 'x', type: 'string' }, { id: 'opt', type: 'string', optional: true }], outputs: [{ id: 'y', type: 'string' }] },
        { id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] },
      ],
      edges: [
        { from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'leaf',    portId: 'x' } },
        { from: { nodeId: 'leaf',   portId: 'y' }, to: { nodeId: '$output', portId: 'y' } },
      ],
    }
    expect(errorTypes(g)).not.toContain('disconnected_input')
  })

  it('$input node inputs are not checked', () => {
    // $input has no inputs by convention — validator should not report disconnected on it
    expect(errorTypes(minimalGraph())).not.toContain('disconnected_input')
  })
})

// ── multiple_inputs ───────────────────────────────────────────────────────

describe('multiple_inputs', () => {
  it('detects two edges targeting the same input port', () => {
    const g = minimalGraph()
    // Add a second edge into leaf:x
    g.nodes[0].outputs.push({ id: 'x2', type: 'string' })
    g.edges.push({ from: { nodeId: '$input', portId: 'x2' }, to: { nodeId: 'leaf', portId: 'x' } })
    // Also add x2 to $input outputs (already done above) and mark leaf:x input
    // leaf already has x as input, so we have two edges → leaf:x
    expect(errorTypes(g)).toContain('multiple_inputs')
  })
})

// ── cycle ─────────────────────────────────────────────────────────────────

describe('cycle', () => {
  it('detects a direct self-loop', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: 'a', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'x', type: 'string' }] },
      ],
      edges: [{ from: { nodeId: 'a', portId: 'x' }, to: { nodeId: 'a', portId: 'x' } }],
    }
    expect(errorTypes(g)).toContain('cycle')
  })

  it('detects a two-node cycle', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: 'a', inputs: [{ id: 'i', type: 'string' }], outputs: [{ id: 'o', type: 'string' }] },
        { id: 'b', inputs: [{ id: 'i', type: 'string' }], outputs: [{ id: 'o', type: 'string' }] },
      ],
      edges: [
        { from: { nodeId: 'a', portId: 'o' }, to: { nodeId: 'b', portId: 'i' } },
        { from: { nodeId: 'b', portId: 'o' }, to: { nodeId: 'a', portId: 'i' } },
      ],
    }
    const errs = validateGraph(g)
    expect(errs.some(e => e.type === 'cycle')).toBe(true)
    const cycleErr = errs.find(e => e.type === 'cycle') as Extract<typeof errs[number], { type: 'cycle' }>
    expect(cycleErr.nodeIds).toContain('a')
    expect(cycleErr.nodeIds).toContain('b')
  })

  it('a valid DAG produces no cycle error', () => {
    expect(errorTypes(minimalGraph())).not.toContain('cycle')
  })
})

// ── recursive validation ──────────────────────────────────────────────────

describe('recursive validation', () => {
  it('reports errors inside a subgraph', () => {
    const g: SerializedGraph = {
      nodes: [
        { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
        {
          id: 'wrapper',
          inputs:  [{ id: 'x', type: 'string' }],
          outputs: [{ id: 'y', type: 'string' }],
          subgraph: {
            nodes: [
              { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
              { id: 'inner',   inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'y', type: 'string' }] },
              { id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] },
            ],
            // Missing edge from inner:y → $output:y — disconnected_input on $output
            edges: [
              { from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'inner', portId: 'x' } },
            ],
          },
        },
        { id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] },
      ],
      edges: [
        { from: { nodeId: '$input',  portId: 'x' }, to: { nodeId: 'wrapper', portId: 'x' } },
        { from: { nodeId: 'wrapper', portId: 'y' }, to: { nodeId: '$output', portId: 'y' } },
      ],
    }
    expect(errorTypes(g)).toContain('disconnected_input')
  })
})

// ── model field ───────────────────────────────────────────────────────────

describe('model field', () => {
  it('ToolAgent graph carries model field on tool_agent node', () => {
    const agentNode = (toolAgentData as SerializedGraph).nodes.find(n => n.id === 'tool_agent')!
    expect((agentNode as any).model).toBe('gpt-4o')
  })
})
