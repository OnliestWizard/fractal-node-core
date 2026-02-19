export type NodeId = string
export type PortId = string

export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'void'
  | 'any'

export interface Port {
  id: PortId
  type: ValueType
}

export interface NodeDefinition {
  id: NodeId
  inputs: Port[]
  outputs: Port[]
  run?: (inputs: Record<string, any>) => any
}

export interface Edge {
  from: { nodeId: NodeId; portId: PortId }
  to:   { nodeId: NodeId; portId: PortId }
}
