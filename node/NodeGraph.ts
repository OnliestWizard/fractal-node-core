export type NodeRef = {
  nodeId: string
}

export type Edge = {
  from: { nodeId: string; output: string }
  to: { nodeId: string; input: string }
}

export type NodeGraph = {
  graphId: string
  nodes: NodeRef[]
  edges: Edge[]
}
