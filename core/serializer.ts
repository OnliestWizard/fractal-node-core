import { ExecutionGraph } from './graph'
import type { IExecutionGraph, NodeContract, Edge } from './types'

export interface SerializedNode extends NodeContract {
  subgraph?: SerializedGraph
  branches?: Record<string, SerializedGraph>
  tools?: NodeContract[]
  /** Catalog ID to dispatch when the node is renamed (e.g. id "params_pack" → builtin "pack") */
  builtin?: string
}

// Bumped only on breaking changes to the graph JSON shape; saveGraph stamps
// it so persisted graphs can be migrated once the spec evolves.
export const SPEC_VERSION = '1'

/** One assertion against the outputs of a test execution. `port` is an output
 *  port name, optionally dot-pathed into the value (JSON-string values are
 *  parsed during the walk, so "result.content.path" reaches into MCP results). */
export interface GraphExpectation {
  port: string
  equals?: unknown
  contains?: string
  exists?: boolean
}

/** A contract test carried by the graph itself. save_graph runs all cases
 *  before versioning and refuses the save if any fail. */
export interface GraphTestCase {
  name?: string
  inputs: Record<string, unknown>
  expect?: GraphExpectation[]
  /** Pass if the graph throws; fail if it succeeds. */
  expectError?: boolean
}

export interface SerializedGraph {
  specVersion?: string
  // Lineage — assigned by the executor on first run; parentGraphId is set when
  // a graph is spawned by a `plant` or `execute_graph` node inside another graph
  id?: string
  parentGraphId?: string
  nodes: SerializedNode[]
  edges: Edge[]
  /** Contract tests — see GraphTestCase. Run by save_graph and test_graph. */
  tests?: GraphTestCase[]
}

// Maps node IDs to their leaf implementations.
// Boundary nodes ($input, $output) and subgraph nodes do not need entries.
export type RuntimeRegistry = Record<string, (inputs: Record<string, any>) => any>

function collectLeafIds(data: SerializedGraph): string[] {
  const ids: string[] = []
  for (const node of data.nodes) {
    if (node.id === '$input' || node.id === '$output') continue
    if (node.subgraph) {
      ids.push(...collectLeafIds(node.subgraph))
    } else if (node.branches) {
      for (const branch of Object.values(node.branches)) {
        ids.push(...collectLeafIds(branch))
      }
    } else if (node.tools) {
      for (const tool of node.tools) {
        ids.push(tool.id)
      }
    } else {
      ids.push(node.id)
    }
  }
  return ids
}

export function validateRegistry(data: SerializedGraph, registry: RuntimeRegistry): string[] {
  return collectLeafIds(data).filter(id => !registry[id])
}

export function serialize(graph: IExecutionGraph): SerializedGraph {
  const nodes: SerializedNode[] = []

  for (const node of graph.nodes.values()) {
    const { run: _run, subgraph, branches, tools, ...contract } = node
    const serialized: SerializedNode = { ...contract }
    if (subgraph)  serialized.subgraph  = serialize(subgraph)
    if (branches)  serialized.branches  = Object.fromEntries(
      Object.entries(branches).map(([k, v]) => [k, serialize(v)])
    )
    if (tools)     serialized.tools     = tools.map(
      ({ run: _r, subgraph: _s, branches: _b, tools: _t, ...tc }) => tc
    )
    nodes.push(serialized)
  }

  return { nodes, edges: graph.edges }
}

export function deserialize(data: SerializedGraph, registry: RuntimeRegistry): ExecutionGraph {
  const missing = validateRegistry(data, registry)
  if (missing.length) {
    console.warn(`[fractal] missing registry entries for leaf nodes: ${missing.join(', ')}`)
  }

  const graph = new ExecutionGraph()

  for (const { subgraph, branches, tools, ...contract } of data.nodes) {
    if (subgraph) {
      graph.addNode({ ...contract, subgraph: deserialize(subgraph, registry) })
    } else if (branches) {
      graph.addNode({
        ...contract,
        branches: Object.fromEntries(
          Object.entries(branches).map(([k, v]) => [k, deserialize(v, registry)])
        ),
      })
    } else if (tools) {
      graph.addNode({
        ...contract,
        tools: tools.map(tc => ({ ...tc, run: registry[tc.id] })),
      })
    } else {
      graph.addNode({ ...contract, run: registry[contract.id] })
    }
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
