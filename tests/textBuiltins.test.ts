import { describe, it, expect } from 'vitest'
import { executeSubgraph } from '../lib/execute-engine'
import type { SerializedGraph } from '../core/serializer'
import type { ValueType } from '../core/types'
import type { McpPool } from '../lib/mcp-pool'

// Minimal harness: one builtin node fed straight from $input
const single = (id: string, inputs: Array<[string, ValueType]>, outputs: Array<[string, ValueType]>): SerializedGraph => ({
  nodes: [
    { id: '$input', inputs: [], outputs: inputs.map(([pid, type]) => ({ id: pid, type })) },
    { id, inputs: inputs.map(([pid, type]) => ({ id: pid, type })), outputs: outputs.map(([pid, type]) => ({ id: pid, type })) },
    { id: '$output', inputs: outputs.map(([pid, type]) => ({ id: pid, type })), outputs: [] },
  ],
  edges: [
    ...inputs.map(([pid]) => ({ from: { nodeId: '$input', portId: pid }, to: { nodeId: id, portId: pid } })),
    ...outputs.map(([pid]) => ({ from: { nodeId: id, portId: pid }, to: { nodeId: '$output', portId: pid } })),
  ],
})

const pool = {} as McpPool

describe('template builtin', () => {
  const graph = single('template', [['template', 'string'], ['values', 'object']], [['text', 'string']])

  it('fills placeholders from the values object', async () => {
    const out = await executeSubgraph(graph, {
      template: 'Delivered to `{path}` — allPassed={allPassed}',
      values: { path: 'planted/x.js', allPassed: true },
    }, pool)
    expect(out.text).toBe('Delivered to `planted/x.js` — allPassed=true')
  })

  it('leaves unknown placeholders visible instead of blanking them', async () => {
    const out = await executeSubgraph(graph, { template: 'hi {nobody}', values: {} }, pool)
    expect(out.text).toBe('hi {nobody}')
  })

  it('repeats a placeholder wherever it appears', async () => {
    const out = await executeSubgraph(graph, { template: '{a}+{a}', values: { a: 1 } }, pool)
    expect(out.text).toBe('1+1')
  })
})

describe('extract_json_block builtin', () => {
  const graph = single('extract_json_block', [['text', 'string']], [['value', 'object'], ['found', 'boolean']])

  it('parses the first fenced json block', async () => {
    const out = await executeSubgraph(graph, {
      text: 'Requesting work.\n\n```json\n{ "problem": "p", "tests": [1, 2] }\n```\n\nThanks.',
    }, pool)
    expect(out.found).toBe(true)
    expect(out.value).toEqual({ problem: 'p', tests: [1, 2] })
  })

  it('reports found=false when there is no block', async () => {
    const out = await executeSubgraph(graph, { text: 'no spec here' }, pool)
    expect(out.found).toBe(false)
    expect(out.value).toEqual({})
  })

  it('reports found=false for an invalid block instead of throwing', async () => {
    const out = await executeSubgraph(graph, { text: '```json\n{ not json\n```' }, pool)
    expect(out.found).toBe(false)
  })
})
