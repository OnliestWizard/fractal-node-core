import { IExecutionGraph } from './types'
import { topologicalSort } from './topo'

export type NodeHook = (
  id: string,
  inputs: Record<string, any>,
  output: Record<string, any>,
  depth: number
) => void

function normaliseOutput(raw: any, portIds: string[]): Record<string, any> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw
  return { [portIds[0] ?? 'out']: raw }
}

async function executeGraph(
  graph: IExecutionGraph,
  seed: Map<string, any>,
  overrides: Record<string, Function>,
  onNode: NodeHook | undefined,
  depth: number
): Promise<Map<string, any>> {
  const values = new Map<string, any>(seed)

  for (const nodeId of topologicalSort([...graph.nodes.keys()], graph.edges)) {
    if (nodeId === '$input' || nodeId === '$output') continue

    const node = graph.nodes.get(nodeId)!

    const inputs: Record<string, any> = {}
    for (const edge of graph.edges) {
      if (edge.to.nodeId !== nodeId) continue
      inputs[edge.to.portId] = values.get(`${edge.from.nodeId}:${edge.from.portId}`)
    }

    let output: Record<string, any>

    if (node.subgraph) {
      const innerSeed = new Map<string, any>()
      for (const port of node.inputs) {
        innerSeed.set(`$input:${port.id}`, inputs[port.id])
      }

      const innerValues = await executeGraph(node.subgraph, innerSeed, overrides, onNode, depth + 1)

      output = {}
      for (const edge of node.subgraph.edges) {
        if (edge.to.nodeId !== '$output') continue
        output[edge.to.portId] = innerValues.get(`${edge.from.nodeId}:${edge.from.portId}`)
      }
    } else {
      const fn = overrides[nodeId] ?? node.run
      if (!fn) throw new Error(`No runtime for node: ${nodeId}`)
      const raw = await fn(inputs)
      output = normaliseOutput(raw, node.outputs.map(p => p.id))
    }

    onNode?.(nodeId, inputs, output, depth)

    for (const port of node.outputs) {
      values.set(`${nodeId}:${port.id}`, output[port.id])
    }
  }

  return values
}

export async function runGraph(
  graph: IExecutionGraph,
  overrides: Record<string, Function> = {},
  onNode?: NodeHook
): Promise<Map<string, any>> {
  return executeGraph(graph, new Map(), overrides, onNode, 0)
}
