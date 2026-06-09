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
  | 'filesystem_read'
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
    maxIterations?: number
    maxTurns?: number
    maxRetries?: number
    // When present, the node emits { value: literal } instead of running — constant node
    literal?: unknown
  }

  // When true, the subgraph runs repeatedly until $output.continue === false
  loop?: boolean

  // When true, runs the subgraph once per item in inputs.items; outputs { results: item_outputs[] }
  forEach?: boolean

  // When true, retries the subgraph up to constraints.maxRetries times on exception
  retry?: boolean

  // When true, branches[String(inputs.condition)] is executed; other inputs forwarded
  router?: boolean

  // When true, runs an LLM-driven tool-calling loop over the declared tools
  agent?: boolean

  // LLM model to use for agent/llm nodes (e.g. 'gpt-4o', 'gpt-4o-mini')
  model?: string

  // Capability permissions — tool/builtin IDs this node's subgraph or agent may
  // call. Supports exact IDs and trailing-* wildcards (e.g. "filesystem__*").
  // Nested restrictions intersect: a child can narrow but never widen its parent's set.
  allowedTools?: string[]

  // Runtime — leaf function, subgraph, router branches, or agent tools (mutually exclusive)
  run?: (inputs: Record<string, any>) => any
  subgraph?: IExecutionGraph
  branches?: Record<string, IExecutionGraph>
  tools?: NodeDefinition[]
}

// The stable, serialisable part of a node — what you promise, not how you fulfill it
export type NodeContract = Omit<NodeDefinition, 'run' | 'subgraph' | 'branches' | 'tools'>
