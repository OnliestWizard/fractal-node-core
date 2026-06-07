import { describe, it, expect } from 'vitest'
import { ExecutionGraph } from '../core/graph'
import { runGraph } from '../core/executor'

function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms))
}

// Helper to build a leaf node
function leaf(
  id: string,
  inputs: string[],
  outputs: string[],
  run: (i: Record<string, any>) => any
) {
  return {
    id,
    inputs:  inputs.map(x => ({ id: x, type: 'any' as const })),
    outputs: outputs.map(x => ({ id: x, type: 'any' as const })),
    run,
  }
}

describe('parallel execution', () => {
  it('two independent nodes run concurrently (timing)', async () => {
    // a and b each take 50ms and have no data dependency — should finish in ~50ms total
    const g = new ExecutionGraph()
    g.addNode(leaf('a', [], ['v'], async () => { await delay(50); return { v: 'A' } }))
    g.addNode(leaf('b', [], ['v'], async () => { await delay(50); return { v: 'B' } }))
    g.addNode({ id: '$output', inputs: [{ id: 'a', type: 'any' }, { id: 'b', type: 'any' }], outputs: [] })
    g.addEdge({ from: { nodeId: 'a', portId: 'v' }, to: { nodeId: '$output', portId: 'a' } })
    g.addEdge({ from: { nodeId: 'b', portId: 'v' }, to: { nodeId: '$output', portId: 'b' } })

    const start = Date.now()
    const values = await runGraph(g)
    const elapsed = Date.now() - start

    expect(values.get('a:v')).toBe('A')
    expect(values.get('b:v')).toBe('B')
    // Parallel: ~50ms. Sequential would be ~100ms. Allow generous headroom for CI.
    expect(elapsed).toBeLessThan(90)
  })

  it('dependent nodes still execute in correct order', async () => {
    // a → b (b doubles a's output) — must be sequential
    const g = new ExecutionGraph()
    g.addNode(leaf('a', [], ['v'], async () => ({ v: 7 })))
    g.addNode(leaf('b', ['v'], ['v'], async (i) => ({ v: i.v * 2 })))
    g.addNode({ id: '$output', inputs: [{ id: 'v', type: 'any' }], outputs: [] })
    g.addEdge({ from: { nodeId: 'a', portId: 'v' }, to: { nodeId: 'b',       portId: 'v' } })
    g.addEdge({ from: { nodeId: 'b', portId: 'v' }, to: { nodeId: '$output', portId: 'v' } })

    const values = await runGraph(g)
    expect(values.get('b:v')).toBe(14)
  })

  it('diamond pattern: two parallel branches merge into one node', async () => {
    // src → left, src → right; merge(left, right) → $output
    // left and right have no dependency on each other
    const order: string[] = []
    const g = new ExecutionGraph()

    g.addNode(leaf('src',   [],           ['v'],    async () => ({ v: 10 })))
    g.addNode(leaf('left',  ['v'],        ['v'],    async (i) => { order.push('left');  return { v: i.v + 1 } }))
    g.addNode(leaf('right', ['v'],        ['v'],    async (i) => { order.push('right'); return { v: i.v * 2 } }))
    g.addNode(leaf('merge', ['l', 'r'],   ['sum'],  async (i) => { order.push('merge'); return { sum: i.l + i.r } }))
    g.addNode({ id: '$output', inputs: [{ id: 'sum', type: 'any' }], outputs: [] })

    g.addEdge({ from: { nodeId: 'src',   portId: 'v' }, to: { nodeId: 'left',    portId: 'v' } })
    g.addEdge({ from: { nodeId: 'src',   portId: 'v' }, to: { nodeId: 'right',   portId: 'v' } })
    g.addEdge({ from: { nodeId: 'left',  portId: 'v' }, to: { nodeId: 'merge',   portId: 'l' } })
    g.addEdge({ from: { nodeId: 'right', portId: 'v' }, to: { nodeId: 'merge',   portId: 'r' } })
    g.addEdge({ from: { nodeId: 'merge', portId: 'sum' }, to: { nodeId: '$output', portId: 'sum' } })

    const values = await runGraph(g)

    // left = 10+1 = 11, right = 10*2 = 20, sum = 31
    expect(values.get('merge:sum')).toBe(31)
    // merge must run after both branches
    expect(order.indexOf('merge')).toBeGreaterThan(order.indexOf('left'))
    expect(order.indexOf('merge')).toBeGreaterThan(order.indexOf('right'))
  })

  it('three independent nodes all run in parallel (timing)', async () => {
    const g = new ExecutionGraph()
    g.addNode(leaf('a', [], ['v'], async () => { await delay(50); return { v: 1 } }))
    g.addNode(leaf('b', [], ['v'], async () => { await delay(50); return { v: 2 } }))
    g.addNode(leaf('c', [], ['v'], async () => { await delay(50); return { v: 3 } }))
    g.addNode({ id: '$output', inputs: [{ id: 'a', type: 'any' }, { id: 'b', type: 'any' }, { id: 'c', type: 'any' }], outputs: [] })
    g.addEdge({ from: { nodeId: 'a', portId: 'v' }, to: { nodeId: '$output', portId: 'a' } })
    g.addEdge({ from: { nodeId: 'b', portId: 'v' }, to: { nodeId: '$output', portId: 'b' } })
    g.addEdge({ from: { nodeId: 'c', portId: 'v' }, to: { nodeId: '$output', portId: 'c' } })

    const start = Date.now()
    const values = await runGraph(g)
    const elapsed = Date.now() - start

    expect(values.get('a:v')).toBe(1)
    expect(values.get('b:v')).toBe(2)
    expect(values.get('c:v')).toBe(3)
    expect(elapsed).toBeLessThan(90)
  })

  it('errors in parallel nodes propagate correctly', async () => {
    const g = new ExecutionGraph()
    g.addNode(leaf('good', [], ['v'], async () => ({ v: 'ok' })))
    g.addNode(leaf('bad',  [], ['v'], async () => { throw new Error('boom') }))
    g.addNode({ id: '$output', inputs: [{ id: 'a', type: 'any' }, { id: 'b', type: 'any' }], outputs: [] })
    g.addEdge({ from: { nodeId: 'good', portId: 'v' }, to: { nodeId: '$output', portId: 'a' } })
    g.addEdge({ from: { nodeId: 'bad',  portId: 'v' }, to: { nodeId: '$output', portId: 'b' } })

    await expect(runGraph(g)).rejects.toThrow('boom')
  })
})
