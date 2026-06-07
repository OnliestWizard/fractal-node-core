export interface Port {
  id: string
  type: string
  optional?: boolean
}

export interface SerializedNode {
  id: string
  description?: string
  inputs: Port[]
  outputs: Port[]
  sideEffects?: string[]
  loop?: boolean
  router?: boolean
  agent?: boolean
  subgraph?: SerializedGraph
  branches?: Record<string, SerializedGraph>
  tools?: SerializedNode[]
}

export interface FractalEdge {
  from: { nodeId: string; portId: string }
  to:   { nodeId: string; portId: string }
}

export interface SerializedGraph {
  nodes: SerializedNode[]
  edges: FractalEdge[]
}

export type NodeStatus = 'idle' | 'running' | 'complete' | 'error'
