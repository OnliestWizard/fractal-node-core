import { ExecutionGraph } from './graph'

export async function runGraph(
  graph: ExecutionGraph,
  overrides: Record<string, Function> = {}
) {
  const values = new Map<string, any>()
  const executed = new Set<string>()

  const topo = topologicalSort(graph)

  for (const nodeId of topo) {
    const node = graph.nodes.get(nodeId)!
    const inputs: Record<string, any> = {}

    graph.edges
      .filter(e => e.to.nodeId === nodeId)
      .forEach(e => {
        const key = `${e.from.nodeId}:${e.from.portId}`
        inputs[e.to.portId] = values.get(key)
      })

    const fn = overrides[nodeId] || node.run
    if (!fn) throw new Error(`No runtime for node ${nodeId}`)

    const output = await fn(inputs)

    node.outputs.forEach(port => {
      values.set(`${nodeId}:${port.id}`, output)
    })

    executed.add(nodeId)
  }

  return values
}
