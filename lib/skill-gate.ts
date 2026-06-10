// Save a graph into the library through the engine's contract-test gate —
// the programmatic equivalent of a name_const → save_graph wrapper graph.
// Returns what save_graph outputs; throws (via error event) is reported as
// saved: false with the refusal message.

import { executeSubgraph, type NodeEvent } from './execute-engine'
import type { McpPool } from './mcp-pool'
import type { SerializedGraph } from '../core/serializer'

export interface GateResult {
  saved: boolean
  version?: string
  tested?: number
  refusal?: string
}

export async function saveSkillThroughGate(
  name: string,
  graph: SerializedGraph,
  pool: McpPool,
): Promise<GateResult> {
  const wrapper: SerializedGraph = {
    nodes: [
      { id: '$input', inputs: [], outputs: [{ id: 'graph', type: 'object' }] },
      { id: 'name_const', inputs: [], outputs: [{ id: 'value', type: 'string' }], constraints: { literal: name } },
      { id: 'save_graph', inputs: [{ id: 'name', type: 'string' }, { id: 'graph', type: 'object' }], outputs: [{ id: 'saved', type: 'boolean' }, { id: 'version', type: 'string' }, { id: 'tested', type: 'number' }] },
      { id: '$output', inputs: [{ id: 'saved', type: 'boolean' }, { id: 'version', type: 'string' }, { id: 'tested', type: 'number' }], outputs: [] },
    ],
    edges: [
      { from: { nodeId: 'name_const', portId: 'value' }, to: { nodeId: 'save_graph', portId: 'name' } },
      { from: { nodeId: '$input', portId: 'graph' }, to: { nodeId: 'save_graph', portId: 'graph' } },
      { from: { nodeId: 'save_graph', portId: 'saved' }, to: { nodeId: '$output', portId: 'saved' } },
      { from: { nodeId: 'save_graph', portId: 'version' }, to: { nodeId: '$output', portId: 'version' } },
      { from: { nodeId: 'save_graph', portId: 'tested' }, to: { nodeId: '$output', portId: 'tested' } },
    ],
  }
  const events: NodeEvent[] = []
  const out = await executeSubgraph(wrapper, { graph }, pool, e => events.push(e))
  if (out.saved === true) {
    return { saved: true, version: String(out.version), tested: Number(out.tested) }
  }
  const err = events.find(e => e.type === 'error')
  return { saved: false, refusal: err && 'error' in err ? err.error : 'unknown refusal' }
}
