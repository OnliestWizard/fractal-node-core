// Execution replay — feeds saved trace events back as synthetic onEvent calls,
// so anything that consumes live NodeEvents (tracer, editor canvas, SSE) can
// re-watch a past run without re-executing it.

import type { NodeEvent } from './execute-engine'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface ReplaySummary {
  eventCount: number
  nodeCount: number // completes
  errorCount: number
  durationMs: number // recorded span, from event timestamps
}

// speed: 0 = instant (default), 1 = recorded pace, 2 = twice as fast, etc.
// Events without timestamps (older traces) replay instantly.
export async function replayTrace(
  events: NodeEvent[],
  onEvent: (e: NodeEvent) => void,
  speed = 0,
): Promise<ReplaySummary> {
  let prevT: number | undefined

  for (const e of events) {
    if (speed > 0 && e.t !== undefined && prevT !== undefined && e.t > prevT) {
      await sleep((e.t - prevT) / speed)
    }
    if (e.t !== undefined) prevT = e.t
    onEvent(e)
  }

  const stamped = events.filter(e => e.t !== undefined)
  const durationMs = stamped.length >= 2
    ? Math.round(stamped[stamped.length - 1].t! - stamped[0].t!)
    : 0

  return {
    eventCount: events.length,
    nodeCount: events.filter(e => e.type === 'complete').length,
    errorCount: events.filter(e => e.type === 'error').length,
    durationMs,
  }
}
