import { describe, it, expect, vi } from 'vitest'
import { ExecutionGraph } from '../core/graph'
import { runGraph, type NodeEvent } from '../core/executor'
import { collectEvents } from '../node/tracer'

function makeLinearGraph() {
  const g = new ExecutionGraph()
  g.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] })
  g.addNode({ id: 'upper',   inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'y', type: 'string' }],
    run: async ({ x }) => ({ y: String(x).toUpperCase() }) })
  g.addNode({ id: 'bang',    inputs: [{ id: 'y', type: 'string' }], outputs: [{ id: 'z', type: 'string' }],
    run: async ({ y }) => ({ z: `${y}!` }) })
  g.addNode({ id: '$output', inputs: [{ id: 'z', type: 'string' }], outputs: [] })
  g.addEdge({ from: { nodeId: '$input', portId: 'x'  }, to: { nodeId: 'upper',   portId: 'x' } })
  g.addEdge({ from: { nodeId: 'upper',  portId: 'y'  }, to: { nodeId: 'bang',    portId: 'y' } })
  g.addEdge({ from: { nodeId: 'bang',   portId: 'z'  }, to: { nodeId: '$output', portId: 'z' } })
  return g
}

function makeParallelGraph() {
  const g = new ExecutionGraph()
  g.addNode({ id: '$input', inputs: [], outputs: [{ id: 'x', type: 'string' }] })
  g.addNode({ id: 'a', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'out', type: 'string' }],
    run: async ({ x }) => ({ out: `a:${x}` }) })
  g.addNode({ id: 'b', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'out', type: 'string' }],
    run: async ({ x }) => ({ out: `b:${x}` }) })
  g.addNode({ id: '$output', inputs: [{ id: 'a', type: 'string' }, { id: 'b', type: 'string' }], outputs: [] })
  g.addEdge({ from: { nodeId: '$input', portId: 'x'   }, to: { nodeId: 'a',       portId: 'x' } })
  g.addEdge({ from: { nodeId: '$input', portId: 'x'   }, to: { nodeId: 'b',       portId: 'x' } })
  g.addEdge({ from: { nodeId: 'a',      portId: 'out' }, to: { nodeId: '$output', portId: 'a' } })
  g.addEdge({ from: { nodeId: 'b',      portId: 'out' }, to: { nodeId: '$output', portId: 'b' } })
  return g
}

function makeFailingGraph() {
  const g = new ExecutionGraph()
  g.addNode({ id: '$input',  inputs: [], outputs: [] })
  g.addNode({ id: 'boom',    inputs: [], outputs: [{ id: 'x', type: 'string' }],
    run: async () => { throw new Error('intentional failure') } })
  g.addNode({ id: '$output', inputs: [{ id: 'x', type: 'string' }], outputs: [] })
  g.addEdge({ from: { nodeId: 'boom', portId: 'x' }, to: { nodeId: '$output', portId: 'x' } })
  return g
}

// ── event types ───────────────────────────────────────────────────────────────

describe('event types', () => {
  it('fires start then complete for each node', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeLinearGraph(), {}, hook, { x: 'hello' })

    const nodeIds = ['upper', 'bang']
    for (const id of nodeIds) {
      const start    = events.find(e => e.type === 'start'    && e.nodeId === id)
      const complete = events.find(e => e.type === 'complete' && e.nodeId === id)
      expect(start).toBeDefined()
      expect(complete).toBeDefined()
    }
  })

  it('start event arrives before complete for the same node', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeLinearGraph(), {}, hook, { x: 'hello' })

    const startIdx    = events.findIndex(e => e.type === 'start'    && e.nodeId === 'upper')
    const completeIdx = events.findIndex(e => e.type === 'complete' && e.nodeId === 'upper')
    expect(startIdx).toBeLessThan(completeIdx)
  })

  it('complete event carries correct inputs and outputs', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeLinearGraph(), {}, hook, { x: 'hello' })

    const ev = events.find(e => e.type === 'complete' && e.nodeId === 'upper') as Extract<NodeEvent, { type: 'complete' }>
    expect(ev.inputs).toEqual({ x: 'hello' })
    expect(ev.outputs).toEqual({ y: 'HELLO' })
  })

  it('complete event carries durationMs >= 0', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeLinearGraph(), {}, hook, { x: 'hi' })

    for (const ev of events.filter(e => e.type === 'complete')) {
      expect((ev as Extract<NodeEvent, { type: 'complete' }>).durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('fires error event on node failure and rethrows', async () => {
    const { hook, events } = collectEvents()
    await expect(runGraph(makeFailingGraph(), {}, hook)).rejects.toThrow('intentional failure')

    const errEv = events.find(e => e.type === 'error' && e.nodeId === 'boom') as Extract<NodeEvent, { type: 'error' }>
    expect(errEv).toBeDefined()
    expect(errEv.error.message).toBe('intentional failure')
    expect(errEv.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does not fire complete after error', async () => {
    const { hook, events } = collectEvents()
    await expect(runGraph(makeFailingGraph(), {}, hook)).rejects.toThrow()

    const completes = events.filter(e => e.type === 'complete' && e.nodeId === 'boom')
    expect(completes).toHaveLength(0)
  })
})

// ── depth ─────────────────────────────────────────────────────────────────────

describe('depth tracking', () => {
  it('top-level nodes have depth 0', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeLinearGraph(), {}, hook, { x: 'hi' })

    for (const ev of events) {
      expect(ev.depth).toBe(0)
    }
  })

  it('subgraph nodes have depth 1', async () => {
    const inner = new ExecutionGraph()
    inner.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] })
    inner.addNode({ id: 'inner_a', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'y', type: 'string' }],
      run: async ({ x }) => ({ y: String(x) }) })
    inner.addNode({ id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] })
    inner.addEdge({ from: { nodeId: '$input',  portId: 'x' }, to: { nodeId: 'inner_a',  portId: 'x' } })
    inner.addEdge({ from: { nodeId: 'inner_a', portId: 'y' }, to: { nodeId: '$output', portId: 'y' } })

    const outer = new ExecutionGraph()
    outer.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] })
    outer.addNode({ id: 'wrapper', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'y', type: 'string' }], subgraph: inner })
    outer.addNode({ id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] })
    outer.addEdge({ from: { nodeId: '$input',  portId: 'x' }, to: { nodeId: 'wrapper',  portId: 'x' } })
    outer.addEdge({ from: { nodeId: 'wrapper', portId: 'y' }, to: { nodeId: '$output', portId: 'y' } })

    const { hook, events } = collectEvents()
    await runGraph(outer, {}, hook, { x: 'test' })

    const outerEvents = events.filter(e => e.nodeId === 'wrapper')
    const innerEvents = events.filter(e => e.nodeId === 'inner_a')

    expect(outerEvents.every(e => e.depth === 0)).toBe(true)
    expect(innerEvents.every(e => e.depth === 1)).toBe(true)
  })
})

// ── ordering ──────────────────────────────────────────────────────────────────

describe('event ordering', () => {
  it('all start events for parallel nodes arrive before either completes (timing)', async () => {
    const slowGraph = new ExecutionGraph()
    slowGraph.addNode({ id: '$input', inputs: [], outputs: [{ id: 'x', type: 'string' }] })
    slowGraph.addNode({ id: 'slow_a', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'out', type: 'string' }],
      run: async ({ x }) => { await new Promise(r => setTimeout(r, 40)); return { out: `a:${x}` } } })
    slowGraph.addNode({ id: 'slow_b', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'out', type: 'string' }],
      run: async ({ x }) => { await new Promise(r => setTimeout(r, 40)); return { out: `b:${x}` } } })
    slowGraph.addNode({ id: '$output', inputs: [{ id: 'a', type: 'string' }, { id: 'b', type: 'string' }], outputs: [] })
    slowGraph.addEdge({ from: { nodeId: '$input', portId: 'x'   }, to: { nodeId: 'slow_a',  portId: 'x'   } })
    slowGraph.addEdge({ from: { nodeId: '$input', portId: 'x'   }, to: { nodeId: 'slow_b',  portId: 'x'   } })
    slowGraph.addEdge({ from: { nodeId: 'slow_a', portId: 'out' }, to: { nodeId: '$output', portId: 'a'   } })
    slowGraph.addEdge({ from: { nodeId: 'slow_b', portId: 'out' }, to: { nodeId: '$output', portId: 'b'   } })

    const { hook, events } = collectEvents()
    await runGraph(slowGraph, {}, hook, { x: 'hi' })

    // Both starts arrive before any complete because they're parallel
    const startA    = events.findIndex(e => e.type === 'start'    && e.nodeId === 'slow_a')
    const startB    = events.findIndex(e => e.type === 'start'    && e.nodeId === 'slow_b')
    const completeA = events.findIndex(e => e.type === 'complete' && e.nodeId === 'slow_a')
    const completeB = events.findIndex(e => e.type === 'complete' && e.nodeId === 'slow_b')

    expect(startA).toBeLessThan(completeA)
    expect(startB).toBeLessThan(completeB)
    // both starts fire before either complete (parallel fan-out)
    expect(Math.max(startA, startB)).toBeLessThan(Math.min(completeA, completeB))
  })

  it('total event count is 2 per node (start + complete)', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeLinearGraph(), {}, hook, { x: 'x' })
    // 2 nodes × 2 events each
    expect(events).toHaveLength(4)
  })
})

// ── collectEvents utility ─────────────────────────────────────────────────────

describe('collectEvents', () => {
  it('returns all events in order', async () => {
    const { hook, events } = collectEvents()
    await runGraph(makeParallelGraph(), {}, hook, { x: 'z' })
    expect(events.some(e => e.nodeId === 'a')).toBe(true)
    expect(events.some(e => e.nodeId === 'b')).toBe(true)
  })

  it('can be used multiple times independently', async () => {
    const first  = collectEvents()
    const second = collectEvents()
    await runGraph(makeLinearGraph(), {}, first.hook,  { x: '1' })
    await runGraph(makeLinearGraph(), {}, second.hook, { x: '2' })
    expect(first.events).not.toHaveLength(0)
    expect(second.events).not.toHaveLength(0)
    expect(first.events).not.toBe(second.events)
  })
})
