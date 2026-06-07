export type NodeId = string
export type PortId = string

export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'audio'
  | 'image'
  | 'void'
  | 'any'

export type SideEffect =
  | 'hardware_access'
  | 'filesystem_write'
  | 'network_access'
  | 'microphone'
  | 'camera'
  | 'llm'

export interface Port {
  id: PortId
  type: ValueType
  optional?: boolean
}

export interface Edge {
  from: { nodeId: NodeId; portId: PortId }
  to:   { nodeId: NodeId; portId: PortId }
}

// Minimal interface so NodeDefinition can reference a graph without a circular import
export interface IExecutionGraph {
  nodes: Map<string, NodeDefinition>
  edges: Edge[]
}

export interface NodeDefinition {
  // Identity & semantics
  id: NodeId
  description?: string
  version?: string
  tags?: string[]

  // Ports
  inputs: Port[]
  outputs: Port[]

  // Platform constraints — used by emitters to decide how to emit
  sideEffects?: SideEffect[]
  constraints?: {
    offlineCapable?: boolean
    realtime?: boolean
  }

  // Runtime — either a leaf function or a subgraph, never both
  run?: (inputs: Record<string, any>) => any
  subgraph?: IExecutionGraph
}

// The stable, serialisable part of a node — what you promise, not how you fulfill it
export type NodeContract = Omit<NodeDefinition, 'run' | 'subgraph'>
