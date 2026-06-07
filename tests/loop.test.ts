import { test, expect } from 'vitest'
import { ExecutionGraph } from '../core/graph'
import { runGraph } from '../core/executor'

function makeIncrementSubgraph(stopAt: number): ExecutionGraph {
  const g = new ExecutionGraph()
  g.addNode({ id: '$input', inputs: [], outputs: [{ id: 'value', type: 'number' }] })
  g.addNode({
    id: 'inc',
    inputs:  [{ id: 'value', type: 'number' }],
    outputs: [{ id: 'value', type: 'number' }, { id: 'continue', type: 'boolean' }],
    run: async (inputs: Record<string, any>) => ({ value: inputs.value + 1, continue: inputs.value + 1 < stopAt }),
  })
  g.addNode({
    id: '$output',
    inputs:  [{ id: 'value', type: 'number' }, { id: 'continue', type: 'boolean' }],
    outputs: [],
  })
  g.addEdge({ from: { nodeId: '$input', portId: 'value' }, to: { nodeId: 'inc', portId: 'value' } })
  g.addEdge({ from: { nodeId: 'inc', portId: 'value'    }, to: { nodeId: '$output', portId: 'value'    } })
  g.addEdge({ from: { nodeId: 'inc', portId: 'continue' }, to: { nodeId: '$output', portId: 'continue' } })
  return g
}

function wrapInLoopGraph(subgraph: ExecutionGraph, constraints?: { maxIterations?: number }): ExecutionGraph {
  const g = new ExecutionGraph()
  g.addNode({ id: 'src', inputs: [], outputs: [{ id: 'value', type: 'number' }] })
  g.addNode({
    id: 'loop',
    loop: true,
    inputs:      [{ id: 'value', type: 'number' }],
    outputs:     [{ id: 'value', type: 'number' }],
    constraints: constraints ?? {},
    subgraph,
  })
  g.addNode({ id: '$output', inputs: [{ id: 'value', type: 'number' }], outputs: [] })
  g.addEdge({ from: { nodeId: 'src',  portId: 'value' }, to: { nodeId: 'loop',    portId: 'value' } })
  g.addEdge({ from: { nodeId: 'loop', portId: 'value' }, to: { nodeId: '$output', portId: 'value' } })
  return g
}

test('loop increments until continue is false', async () => {
  const graph = wrapInLoopGraph(makeIncrementSubgraph(5))
  const values = await runGraph(graph, { src: async () => ({ value: 0 }) })
  expect(values.get('loop:value')).toBe(5)
})

test('loop output does not contain continue', async () => {
  const graph = wrapInLoopGraph(makeIncrementSubgraph(3))
  const values = await runGraph(graph, { src: async () => ({ value: 0 }) })
  expect(values.has('loop:continue')).toBe(false)
})

test('loop respects maxIterations ceiling', async () => {
  // subgraph always returns continue: true — only maxIterations stops it
  const sub = new ExecutionGraph()
  sub.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'value', type: 'number' }] })
  sub.addNode({
    id: 'inc',
    inputs:  [{ id: 'value', type: 'number' }],
    outputs: [{ id: 'value', type: 'number' }, { id: 'continue', type: 'boolean' }],
    run: async (inputs: Record<string, any>) => ({ value: inputs.value + 1, continue: true }),
  })
  sub.addNode({
    id: '$output',
    inputs:  [{ id: 'value', type: 'number' }, { id: 'continue', type: 'boolean' }],
    outputs: [],
  })
  sub.addEdge({ from: { nodeId: '$input', portId: 'value'    }, to: { nodeId: 'inc',     portId: 'value'    } })
  sub.addEdge({ from: { nodeId: 'inc',    portId: 'value'    }, to: { nodeId: '$output', portId: 'value'    } })
  sub.addEdge({ from: { nodeId: 'inc',    portId: 'continue' }, to: { nodeId: '$output', portId: 'continue' } })

  const graph = wrapInLoopGraph(sub, { maxIterations: 4 })
  const values = await runGraph(graph, { src: async () => ({ value: 0 }) })
  expect(values.get('loop:value')).toBe(4)
})

test('non-loop subgraph node is unaffected', async () => {
  const sub = new ExecutionGraph()
  sub.addNode({ id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'number' }] })
  sub.addNode({
    id: 'double',
    inputs:  [{ id: 'x', type: 'number' }],
    outputs: [{ id: 'x', type: 'number' }],
    run: async (inputs: Record<string, any>) => ({ x: inputs.x * 2 }),
  })
  sub.addNode({ id: '$output', inputs: [{ id: 'x', type: 'number' }], outputs: [] })
  sub.addEdge({ from: { nodeId: '$input', portId: 'x' }, to: { nodeId: 'double',  portId: 'x' } })
  sub.addEdge({ from: { nodeId: 'double', portId: 'x' }, to: { nodeId: '$output', portId: 'x' } })

  const g = new ExecutionGraph()
  g.addNode({ id: 'src', inputs: [], outputs: [{ id: 'x', type: 'number' }] })
  g.addNode({ id: 'wrap', inputs: [{ id: 'x', type: 'number' }], outputs: [{ id: 'x', type: 'number' }], subgraph: sub })
  g.addNode({ id: '$output', inputs: [{ id: 'x', type: 'number' }], outputs: [] })
  g.addEdge({ from: { nodeId: 'src',  portId: 'x' }, to: { nodeId: 'wrap',    portId: 'x' } })
  g.addEdge({ from: { nodeId: 'wrap', portId: 'x' }, to: { nodeId: '$output', portId: 'x' } })

  const values = await runGraph(g, { src: async () => ({ x: 7 }) })
  expect(values.get('wrap:x')).toBe(14)
})
