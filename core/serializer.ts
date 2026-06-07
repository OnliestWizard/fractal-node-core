import { ExecutionGraph } from './graph'
import type { IExecutionGraph, NodeContract, Edge } from './types'

export interface SerializedNode extends NodeContract {
  subgraph?: SerializedGraph
}

export interface SerializedGraph {
  nodes: SerializedNode[]
  edges: Edge[]
}

// Maps node IDs to their leaf implementations.
// Boundary nodes ($input, $output) and subgraph nodes do not need entries.
export type RuntimeRegistry = Record<string, (inputs: Record<string, any>) => any>

export function serialize(graph: IExecutionGraph): SerializedGraph {
  const nodes: SerializedNode[] = []

  for (const node of graph.nodes.values()) {
    const { run: _run, subgraph, ...contract } = node
    const serialized: SerializedNode = { ...contract }
    if (subgraph) serialized.subgraph = serialize(subgraph)
    nodes.push(serialized)
  }

  return { nodes, edges: graph.edges }
}

export function deserialize(data: SerializedGraph, registry: RuntimeRegistry): ExecutionGraph {
  const graph = new ExecutionGraph()

  for (const { subgraph, ...contract } of data.nodes) {
    graph.addNode(
      subgraph
        ? { ...contract, subgraph: deserialize(subgraph, registry) }
        : { ...contract, run: registry[contract.id] }
    )
  }

  for (const edge of data.edges) {
    graph.addEdge(edge)
  }

  return graph
}

export function toJSON(graph: IExecutionGraph): string {
  return JSON.stringify(serialize(graph), null, 2)
}

export function fromJSON(json: string, registry: RuntimeRegistry): ExecutionGraph {
  return deserialize(JSON.parse(json), registry)
}
