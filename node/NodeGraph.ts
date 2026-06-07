import type { NodeId, Edge } from '../core/types'

export type NodeRef = { nodeId: NodeId }

export type NodeGraph = {
  graphId: string
  nodes: NodeRef[]
  edges: Edge[]
}
