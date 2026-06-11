import { describe, it, expect } from 'vitest'
import { draftTestFromTrace } from '../lib/test-draft'
import type { TraceFile } from '../lib/trace-markdown'
import type { NodeEvent } from '../lib/execute-engine'
import type { SerializedGraph } from '../core/serializer'

const ev = (partial: Partial<NodeEvent> & { type: NodeEvent['type']; nodeId: string }): NodeEvent =>
  ({ depth: 0, ...partial }) as NodeEvent

const failedTrace: TraceFile = {
  inputs: { url: 'http://localhost:9/unreachable' },
  outputs: {},
  events: [
    ev({ type: 'start', nodeId: 'http_fetch' }),
    ev({ type: 'error', nodeId: 'http_fetch', error: 'TypeError: fetch failed', durationMs: 12 }),
  ],
}

const graph: SerializedGraph = {
  nodes: [
    { id: '$input', inputs: [], outputs: [{ id: 'url', type: 'string' }] },
    { id: '$output', inputs: [{ id: 'summary', type: 'string' }, { id: 'status', type: 'number' }], outputs: [] },
  ],
  edges: [],
}

describe('draftTestFromTrace', () => {
  it('drafts a regression test from the failing inputs and the graph\'s output ports', () => {
    const { drafted, test, reason } = draftTestFromTrace(failedTrace, graph)
    expect(drafted).toBe(true)
    expect(test!.name).toContain('regression: http_fetch failed — TypeError: fetch failed')
    expect(test!.inputs).toEqual({ url: 'http://localhost:9/unreachable' })
    expect(test!.expect).toEqual([
      { port: 'summary', exists: true },
      { port: 'status', exists: true },
    ])
    expect(reason).toContain('http_fetch')
  })

  it('drafts an expectError test when the failure is correct behavior', () => {
    const { drafted, test } = draftTestFromTrace(failedTrace, graph, { expectError: true })
    expect(drafted).toBe(true)
    expect(test!.expectError).toBe(true)
    expect(test!.expect).toBeUndefined()
  })

  it('falls back to recorded output keys when no graph is given', () => {
    const withOutputs: TraceFile = { ...failedTrace, outputs: { summary: 'partial' } }
    const { drafted, test } = draftTestFromTrace(withOutputs)
    expect(drafted).toBe(true)
    expect(test!.expect).toEqual([{ port: 'summary', exists: true }])
  })

  it('declines a trace with no failure', () => {
    const clean: TraceFile = {
      inputs: { url: 'x' },
      events: [ev({ type: 'start', nodeId: 'a' }), ev({ type: 'complete', nodeId: 'a', durationMs: 1 })],
    }
    const { drafted, reason } = draftTestFromTrace(clean, graph)
    expect(drafted).toBe(false)
    expect(reason).toContain('no failure')
  })

  it('declines a trace with no recorded inputs', () => {
    const { drafted, reason } = draftTestFromTrace({ ...failedTrace, inputs: {} }, graph)
    expect(drafted).toBe(false)
    expect(reason).toContain('no recorded inputs')
  })

  it('declines when no output ports are knowable', () => {
    const { drafted, reason } = draftTestFromTrace(failedTrace)
    expect(drafted).toBe(false)
    expect(reason).toContain('pass the graph')
  })

  it('truncates very long error messages in the test name', () => {
    const longError: TraceFile = {
      ...failedTrace,
      events: [ev({ type: 'error', nodeId: 'x', error: 'e'.repeat(300), durationMs: 1 })],
    }
    const { test } = draftTestFromTrace(longError, graph)
    expect(test!.name!.length).toBeLessThan(120)
  })
})
