import { NodeDefinition, Edge } from './types'

export class ExecutionGraph {
  nodes = new Map<string, NodeDefinition>()
  edges: Edge[] = []

  addNode(node: NodeDefinition) {
    if (this.nodes.has(node.id)) {
      throw new Error(`Duplicate node: ${node.id}`)
    }
    this.nodes.set(node.id, node)
  }

  addEdge(edge: Edge) {
    const fromNode = this.nodes.get(edge.from.nodeId)
    const toNode   = this.nodes.get(edge.to.nodeId)

    if (!fromNode || !toNode) {
      throw new Error('Invalid edge node reference')
    }

    const outPort = fromNode.outputs.find(p => p.id === edge.from.portId)
    const inPort  = toNode.inputs.find(p => p.id === edge.to.portId)

    if (!outPort || !inPort) {
      throw new Error('Invalid port reference')
    }

    if (outPort.type !== inPort.type && inPort.type !== 'any') {
      throw new Error(`Type mismatch: ${outPort.type} → ${inPort.type}`)
    }

    this.edges.push(edge)
  }
}
