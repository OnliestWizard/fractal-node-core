// The Raindrop steal (probability004): a failed run becomes a contract test,
// so the library compounds lessons, not just skills. Drafts a GraphTestCase
// from a trace's recorded inputs and failure point. The draft is an OFFER —
// a human (or a downstream gate) decides whether it joins the graph's suite.

import type { GraphTestCase, SerializedGraph } from '../core/serializer'
import type { TraceFile } from './trace-markdown'

export interface DraftResult {
  drafted: boolean
  test?: GraphTestCase
  reason: string
}

export function draftTestFromTrace(
  trace: TraceFile,
  graph?: SerializedGraph,
  opts: { expectError?: boolean } = {},
): DraftResult {
  const errorEvent = (trace.events ?? []).find(e => e.type === 'error')
  if (!errorEvent || errorEvent.type !== 'error') {
    return { drafted: false, reason: 'trace records no failure — nothing to learn from it' }
  }
  if (!trace.inputs || Object.keys(trace.inputs).length === 0) {
    return { drafted: false, reason: 'trace has no recorded inputs to replay' }
  }

  const name = `regression: ${errorEvent.nodeId} failed — ${errorEvent.error.slice(0, 80)}`

  // The failure was correct behavior (e.g. validation): lock it in.
  if (opts.expectError) {
    return {
      drafted: true,
      reason: `locks in the failure at ${errorEvent.nodeId} as expected behavior`,
      test: { name, inputs: { ...trace.inputs }, expectError: true },
    }
  }

  // The failure was a bug: once fixed, these exact inputs must produce every
  // output the failure prevented. Ports come from the graph's $output; a
  // successful prior trace's output keys are the fallback.
  const ports = graph?.nodes.find(n => n.id === '$output')?.inputs?.map(p => p.id)
    ?? Object.keys(trace.outputs ?? {})
  if (ports.length === 0) {
    return { drafted: false, reason: 'no output ports known — pass the graph to draft expectations' }
  }
  return {
    drafted: true,
    reason: `replays the failing inputs and requires every output that ${errorEvent.nodeId}'s failure prevented`,
    test: { name, inputs: { ...trace.inputs }, expect: ports.map(port => ({ port, exists: true })) },
  }
}
