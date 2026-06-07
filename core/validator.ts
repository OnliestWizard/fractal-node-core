import type { SerializedGraph } from './serializer'
import type { Edge } from './types'

export type ValidationError =
  | { type: 'unknown_node_ref';    side: 'from' | 'to'; edgeIndex: number; nodeId: string }
  | { type: 'unknown_port_ref';    side: 'from' | 'to'; edgeIndex: number; nodeId: string; portId: string }
  | { type: 'type_mismatch';       fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string; fromType: string; toType: string }
  | { type: 'disconnected_input';  nodeId: string; portId: string }
  | { type: 'multiple_inputs';     nodeId: string; portId: string }
  | { type: 'cycle';               nodeIds: string[] }

function findCycle(nodeIds: string[], edges: Edge[]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const id of nodeIds) adj.set(id, [])
  for (const e of edges) {
    const list = adj.get(e.from.nodeId)
    if (list) list.push(e.to.nodeId)
  }

  const state = new Map<string, 'unvisited' | 'visiting' | 'visited'>()
  for (const id of nodeIds) state.set(id, 'unvisited')

  const path: string[] = []

  function dfs(id: string): string[] | null {
    state.set(id, 'visiting')
    path.push(id)
    for (const neighbor of adj.get(id) ?? []) {
      if (state.get(neighbor) === 'visiting') {
        return path.slice(path.indexOf(neighbor))
      }
      if (state.get(neighbor) === 'unvisited') {
        const result = dfs(neighbor)
        if (result) return result
      }
    }
    path.pop()
    state.set(id, 'visited')
    return null
  }

  for (const id of nodeIds) {
    if (state.get(id) === 'unvisited') {
      const result = dfs(id)
      if (result) return result
    }
  }
  return null
}

export function validateGraph(graph: SerializedGraph): ValidationError[] {
  const errors: ValidationError[] = []
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))

  // Track how many edges arrive at each input port
  const inputCount = new Map<string, { nodeId: string; portId: string; count: number }>()

  // ── 1. Edge reference checks ─────────────────────────────────────────────
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]

    const fromNode = nodeMap.get(edge.from.nodeId)
    if (!fromNode) {
      errors.push({ type: 'unknown_node_ref', side: 'from', edgeIndex: i, nodeId: edge.from.nodeId })
    } else if (!fromNode.outputs.find(p => p.id === edge.from.portId)) {
      errors.push({ type: 'unknown_port_ref', side: 'from', edgeIndex: i, nodeId: edge.from.nodeId, portId: edge.from.portId })
    }

    const toNode = nodeMap.get(edge.to.nodeId)
    if (!toNode) {
      errors.push({ type: 'unknown_node_ref', side: 'to', edgeIndex: i, nodeId: edge.to.nodeId })
    } else if (!toNode.inputs.find(p => p.id === edge.to.portId)) {
      errors.push({ type: 'unknown_port_ref', side: 'to', edgeIndex: i, nodeId: edge.to.nodeId, portId: edge.to.portId })
    }

    // Count arrivals per input port
    const toKey = `${edge.to.nodeId}\0${edge.to.portId}`
    const entry = inputCount.get(toKey)
    if (entry) entry.count++
    else inputCount.set(toKey, { nodeId: edge.to.nodeId, portId: edge.to.portId, count: 1 })
  }

  // ── 2. Type compatibility ─────────────────────────────────────────────────
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]
    const fromNode = nodeMap.get(edge.from.nodeId)
    const toNode   = nodeMap.get(edge.to.nodeId)
    if (!fromNode || !toNode) continue

    const fromPort = fromNode.outputs.find(p => p.id === edge.from.portId)
    const toPort   = toNode.inputs.find(p => p.id === edge.to.portId)
    if (!fromPort || !toPort) continue

    if (fromPort.type !== 'any' && toPort.type !== 'any' && fromPort.type !== toPort.type) {
      errors.push({
        type: 'type_mismatch',
        fromNodeId: edge.from.nodeId, fromPortId: edge.from.portId,
        toNodeId:   edge.to.nodeId,   toPortId:   edge.to.portId,
        fromType: fromPort.type, toType: toPort.type,
      })
    }
  }

  // ── 3. Multiple inputs to same port ───────────────────────────────────────
  for (const { nodeId, portId, count } of inputCount.values()) {
    if (count > 1) errors.push({ type: 'multiple_inputs', nodeId, portId })
  }

  // ── 4. Disconnected required inputs ───────────────────────────────────────
  // $input has no inputs and is seeded externally — skip it.
  for (const node of graph.nodes) {
    if (node.id === '$input') continue
    for (const port of node.inputs) {
      if (port.optional) continue
      const key = `${node.id}\0${port.id}`
      if (!inputCount.has(key)) {
        errors.push({ type: 'disconnected_input', nodeId: node.id, portId: port.id })
      }
    }
  }

  // ── 5. Cycle detection ────────────────────────────────────────────────────
  const cycle = findCycle(graph.nodes.map(n => n.id), graph.edges)
  if (cycle) errors.push({ type: 'cycle', nodeIds: cycle })

  // ── 6. Recurse into subgraphs and router branches ─────────────────────────
  for (const node of graph.nodes) {
    if (node.subgraph) errors.push(...validateGraph(node.subgraph))
    if (node.branches) {
      for (const branch of Object.values(node.branches)) {
        errors.push(...validateGraph(branch))
      }
    }
  }

  return errors
}
