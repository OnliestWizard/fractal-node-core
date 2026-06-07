import type { Edge } from './types'

export function topologicalSort(nodeIds: string[], edges: Edge[]): string[] {
  const inDegree = new Map<string, number>()
  const adj      = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }

  for (const edge of edges) {
    adj.get(edge.from.nodeId)?.push(edge.to.nodeId)
    inDegree.set(edge.to.nodeId, (inDegree.get(edge.to.nodeId) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const neighbor of adj.get(id) ?? []) {
      const deg = inDegree.get(neighbor)! - 1
      inDegree.set(neighbor, deg)
      if (deg === 0) queue.push(neighbor)
    }
  }

  if (order.length !== nodeIds.length) throw new Error('Graph has a cycle')

  return order
}
