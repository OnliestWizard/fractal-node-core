import type { Node, Edge } from 'reactflow'
import type { SerializedGraph, SerializedNode, NodeStatus } from './types'

const NODE_W  = 210
const NODE_H  = 44   // header height; grows with ports
const PORT_H  = 24
const COL_GAP = 90
const ROW_GAP = 36

export function toReactFlow(
  graph: SerializedGraph,
  statuses: Record<string, NodeStatus> = {},
): { nodes: Node[]; edges: Edge[] } {
  const depths  = computeDepths(graph)
  const maxDepth = Math.max(0, ...Object.values(depths))

  // $output always rightmost
  depths['$output'] = maxDepth + 1

  // Group nodes by depth
  const byDepth = new Map<number, SerializedNode[]>()
  for (const node of graph.nodes) {
    const d = depths[node.id] ?? 0
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(node)
  }

  // Compute y positions within each column
  const positions: Record<string, { x: number; y: number }> = {}
  for (const [d, col] of byDepth) {
    const totalH = col.reduce((s, n) => s + nodeHeight(n) + ROW_GAP, 0) - ROW_GAP
    let y = -totalH / 2
    for (const node of col) {
      positions[node.id] = { x: d * (NODE_W + COL_GAP), y }
      y += nodeHeight(node) + ROW_GAP
    }
  }

  const rfNodes: Node[] = graph.nodes.map(node => ({
    id:       node.id,
    type:     'fractal',
    position: positions[node.id] ?? { x: 0, y: 0 },
    data:     { node, status: statuses[node.id] ?? 'idle' },
  }))

  const rfEdges: Edge[] = graph.edges.map((e, i) => ({
    id:           `e${i}-${e.from.nodeId}-${e.from.portId}`,
    source:       e.from.nodeId,
    sourceHandle: e.from.portId,
    target:       e.to.nodeId,
    targetHandle: e.to.portId,
    style:        { stroke: '#444', strokeWidth: 1.5 },
    animated:     statuses[e.from.nodeId] === 'running',
  }))

  return { nodes: rfNodes, edges: rfEdges }
}

function computeDepths(graph: SerializedGraph): Record<string, number> {
  const depth: Record<string, number> = { '$input': 0 }
  const queue = ['$input']

  while (queue.length) {
    const id = queue.shift()!
    for (const edge of graph.edges) {
      if (edge.from.nodeId !== id) continue
      const toId    = edge.to.nodeId
      const newDepth = (depth[id] ?? 0) + 1
      if (depth[toId] === undefined || depth[toId] < newDepth) {
        depth[toId] = newDepth
        queue.push(toId)
      }
    }
  }

  for (const node of graph.nodes) {
    if (depth[node.id] === undefined) depth[node.id] = 0
  }

  return depth
}

function nodeHeight(node: SerializedNode): number {
  const ports = Math.max(node.inputs.length, node.outputs.length, 1)
  return NODE_H + ports * PORT_H
}
