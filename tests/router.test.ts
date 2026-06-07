import { describe, it, expect } from 'vitest'
import { ExecutionGraph } from '../core/graph'
import { runGraph } from '../core/executor'
import { serialize, deserialize, validateRegistry } from '../core/serializer'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import { emitGraphKotlin } from '../emitters/android/emitKotlin'
import type { SerializedGraph } from '../core/serializer'
import memoryOrFetchData from '../node/graphs/MemoryOrFetch.graph.json'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRouterGraph(condition: string | boolean) {
  const hitGraph = new ExecutionGraph()
  hitGraph.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] })
  hitGraph.addNode({
    id: 'hit_node',
    inputs:  [{ id: 'x', type: 'string' }],
    outputs: [{ id: 'result', type: 'string' }],
    run: async (i: Record<string, any>) => ({ result: `hit:${i.x}` }),
  })
  hitGraph.addNode({ id: '$output', inputs: [{ id: 'result', type: 'string' }], outputs: [] })
  hitGraph.addEdge({ from: { nodeId: '$input',   portId: 'x'      }, to: { nodeId: 'hit_node', portId: 'x'      } })
  hitGraph.addEdge({ from: { nodeId: 'hit_node', portId: 'result' }, to: { nodeId: '$output',  portId: 'result' } })

  const missGraph = new ExecutionGraph()
  missGraph.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] })
  missGraph.addNode({
    id: 'miss_node',
    inputs:  [{ id: 'x', type: 'string' }],
    outputs: [{ id: 'result', type: 'string' }],
    run: async (i: Record<string, any>) => ({ result: `miss:${i.x}` }),
  })
  missGraph.addNode({ id: '$output', inputs: [{ id: 'result', type: 'string' }], outputs: [] })
  missGraph.addEdge({ from: { nodeId: '$input',    portId: 'x'      }, to: { nodeId: 'miss_node', portId: 'x'      } })
  missGraph.addEdge({ from: { nodeId: 'miss_node', portId: 'result' }, to: { nodeId: '$output',   portId: 'result' } })

  const g = new ExecutionGraph()
  g.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }, { id: 'cond', type: 'any' }] })
  g.addNode({
    id: 'router',
    router: true,
    inputs:  [{ id: 'condition', type: 'any' }, { id: 'x', type: 'string' }],
    outputs: [{ id: 'result', type: 'string' }],
    branches: { 'true': hitGraph, 'false': missGraph },
  })
  g.addNode({ id: '$output', inputs: [{ id: 'result', type: 'string' }], outputs: [] })
  g.addEdge({ from: { nodeId: '$input', portId: 'cond'   }, to: { nodeId: 'router',   portId: 'condition' } })
  g.addEdge({ from: { nodeId: '$input', portId: 'x'      }, to: { nodeId: 'router',   portId: 'x'         } })
  g.addEdge({ from: { nodeId: 'router', portId: 'result' }, to: { nodeId: '$output',  portId: 'result'    } })

  return g
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('router node execution', () => {
  it('routes to "true" branch when condition is true', async () => {
    const g = makeRouterGraph(true)
    const values = await runGraph(g, {}, undefined, { x: 'hello', cond: true })
    expect(values.get('router:result')).toBe('hit:hello')
  })

  it('routes to "false" branch when condition is false', async () => {
    const g = makeRouterGraph(false)
    const values = await runGraph(g, {}, undefined, { x: 'world', cond: false })
    expect(values.get('router:result')).toBe('miss:world')
  })

  it('routes to a named string branch', async () => {
    const branchA = new ExecutionGraph()
    branchA.addNode({ id: '$input',  inputs: [], outputs: [] })
    branchA.addNode({ id: 'n', inputs: [], outputs: [{ id: 'v', type: 'string' }], run: async () => ({ v: 'branch-A' }) })
    branchA.addNode({ id: '$output', inputs: [{ id: 'v', type: 'string' }], outputs: [] })
    branchA.addEdge({ from: { nodeId: 'n', portId: 'v' }, to: { nodeId: '$output', portId: 'v' } })

    const branchB = new ExecutionGraph()
    branchB.addNode({ id: '$input',  inputs: [], outputs: [] })
    branchB.addNode({ id: 'n', inputs: [], outputs: [{ id: 'v', type: 'string' }], run: async () => ({ v: 'branch-B' }) })
    branchB.addNode({ id: '$output', inputs: [{ id: 'v', type: 'string' }], outputs: [] })
    branchB.addEdge({ from: { nodeId: 'n', portId: 'v' }, to: { nodeId: '$output', portId: 'v' } })

    const g = new ExecutionGraph()
    g.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'condition', type: 'string' }] })
    g.addNode({ id: 'router', router: true,
      inputs:  [{ id: 'condition', type: 'string' }],
      outputs: [{ id: 'v', type: 'string' }],
      branches: { fast: branchA, slow: branchB },
    })
    g.addNode({ id: '$output', inputs: [{ id: 'v', type: 'string' }], outputs: [] })
    g.addEdge({ from: { nodeId: '$input',  portId: 'condition' }, to: { nodeId: 'router',   portId: 'condition' } })
    g.addEdge({ from: { nodeId: 'router',  portId: 'v'         }, to: { nodeId: '$output',  portId: 'v'         } })

    const values = await runGraph(g, {}, undefined, { condition: 'fast' })
    expect(values.get('router:v')).toBe('branch-A')

    const values2 = await runGraph(g, {}, undefined, { condition: 'slow' })
    expect(values2.get('router:v')).toBe('branch-B')
  })

  it('throws on unknown branch name', async () => {
    const g = makeRouterGraph('true')
    await expect(
      runGraph(g, {}, undefined, { x: 'x', cond: 'nope' })
    ).rejects.toThrow('no branch "nope"')
  })
})

describe('router serialization round-trip', () => {
  it('serialize → deserialize preserves router branches', async () => {
    const g = makeRouterGraph(true)
    const serialized = serialize(g)
    const routerNode = serialized.nodes.find(n => n.id === 'router')!
    expect(routerNode.router).toBe(true)
    expect(routerNode.branches).toBeDefined()
    expect(Object.keys(routerNode.branches!)).toEqual(['true', 'false'])

    const restored = deserialize(serialized, {
      hit_node:  async (i: Record<string, any>) => ({ result: `hit:${i.x}` }),
      miss_node: async (i: Record<string, any>) => ({ result: `miss:${i.x}` }),
    })
    const values = await runGraph(restored, {}, undefined, { x: 'abc', cond: false })
    expect(values.get('router:result')).toBe('miss:abc')
  })
})

describe('MemoryOrFetch graph registry', () => {
  it('requires passthrough, http_fetch, research_answer, memory_read, memory_write', () => {
    const missing = validateRegistry(memoryOrFetchData as SerializedGraph, {})
    expect(missing).toContain('passthrough')
    expect(missing).toContain('http_fetch')
    expect(missing).toContain('research_answer')
    expect(missing).toContain('memory_read')
    expect(missing).toContain('memory_write')
  })
})

describe('emitGraphJS – router', () => {
  it('emits if/else dispatch for router branches', () => {
    const g = makeRouterGraph(true)
    const serialized = serialize(g)
    const files = emitGraphJS(serialized)
    const src = Object.values(files).join('\n')
    expect(src).toContain('inputs.condition === "true"')
    expect(src).toContain('inputs.condition === "false"')
  })
})

describe('emitGraphKotlin – router', () => {
  it('emits if/else dispatch for router branches', () => {
    const g = makeRouterGraph(true)
    const serialized = serialize(g)
    const files = emitGraphKotlin(serialized)
    const src = Object.values(files).join('\n')
    expect(src).toContain('"true"')
    expect(src).toContain('"false"')
  })
})
