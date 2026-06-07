import { IExecutionGraph } from './types'

export type NodeHook = (
  id: string,
  inputs: Record<string, any>,
  output: Record<string, any>,
  depth: number
) => void

function topologicalSort(graph: IExecutionGraph): string[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const id of graph.nodes.keys()) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }

  for (const edge of graph.edges) {
    adj.get(edge.from.nodeId)!.push(edge.to.nodeId)
    inDegree.set(edge.to.nodeId, (inDegree.get(edge.to.nodeId) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const order: string[] = []
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    order.push(nodeId)
    for (const neighbor of adj.get(nodeId) ?? []) {
      const deg = inDegree.get(neighbor)! - 1
      inDegree.set(neighbor, deg)
      if (deg === 0) queue.push(neighbor)
    }
  }

  if (order.length !== graph.nodes.size) {
    throw new Error('Graph has a cycle')
  }

  return order
}

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

  for (const nodeId of topologicalSort(graph)) {
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
