import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import { replayTrace } from '../lib/replay'
import { executeSubgraph } from '../lib/execute-engine'
import type { NodeEvent } from '../lib/execute-engine'
import type { SerializedGraph } from '../core/serializer'
import type { McpPool } from '../lib/mcp-pool'
import { createApp } from '../server'

const ev = (partial: Partial<NodeEvent> & { type: NodeEvent['type']; nodeId: string }): NodeEvent =>
  ({ depth: 0, ...partial }) as NodeEvent

const sampleEvents: NodeEvent[] = [
  ev({ type: 'start', nodeId: 'a', t: 0 }),
  ev({ type: 'complete', nodeId: 'a', durationMs: 5, t: 5 }),
  ev({ type: 'start', nodeId: 'b', t: 5 }),
  ev({ type: 'error', nodeId: 'b', error: 'boom', durationMs: 3, t: 8 }),
]

describe('replayTrace', () => {
  it('re-emits every event in recorded order', async () => {
    const seen: NodeEvent[] = []
    await replayTrace(sampleEvents, e => seen.push(e))
    expect(seen).toEqual(sampleEvents)
  })

  it('summarizes completes, errors, and recorded span', async () => {
    const summary = await replayTrace(sampleEvents, () => {})
    expect(summary).toEqual({ eventCount: 4, nodeCount: 1, errorCount: 1, durationMs: 8 })
  })

  it('replays instantly by default even when timestamps span a long run', async () => {
    const slow: NodeEvent[] = [
      ev({ type: 'start', nodeId: 'a', t: 0 }),
      ev({ type: 'complete', nodeId: 'a', durationMs: 5000, t: 5000 }),
    ]
    const t0 = performance.now()
    await replayTrace(slow, () => {})
    expect(performance.now() - t0).toBeLessThan(100)
  })

  it('paces playback from timestamps when speed > 0', async () => {
    const paced: NodeEvent[] = [
      ev({ type: 'start', nodeId: 'a', t: 0 }),
      ev({ type: 'complete', nodeId: 'a', durationMs: 60, t: 60 }),
    ]
    const t0 = performance.now()
    await replayTrace(paced, () => {}, 1)
    expect(performance.now() - t0).toBeGreaterThanOrEqual(50)

    const t1 = performance.now()
    await replayTrace(paced, () => {}, 4) // 4x speed → ~15ms
    const elapsed = performance.now() - t1
    expect(elapsed).toBeGreaterThanOrEqual(10)
    expect(elapsed).toBeLessThan(50)
  })

  it('handles untimestamped events (older traces) without pacing', async () => {
    const legacy: NodeEvent[] = [
      ev({ type: 'start', nodeId: 'a' }),
      ev({ type: 'complete', nodeId: 'a', durationMs: 9999 }),
    ]
    const seen: NodeEvent[] = []
    const summary = await replayTrace(legacy, e => seen.push(e), 1)
    expect(seen.length).toBe(2)
    expect(summary.durationMs).toBe(0)
  })
})

describe('engine event timestamps', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('stamps every emitted event with a non-decreasing t', async () => {
    const graph: SerializedGraph = {
      nodes: [
        { id: '$input', inputs: [], outputs: [{ id: 'value', type: 'any' }] },
        { id: 'passthrough', inputs: [{ id: 'value', type: 'any' }], outputs: [{ id: 'value', type: 'any' }] },
        { id: '$output', inputs: [{ id: 'value', type: 'any' }], outputs: [] },
      ],
      edges: [
        { from: { nodeId: '$input', portId: 'value' }, to: { nodeId: 'passthrough', portId: 'value' } },
        { from: { nodeId: 'passthrough', portId: 'value' }, to: { nodeId: '$output', portId: 'value' } },
      ],
    }
    const events: NodeEvent[] = []
    await executeSubgraph(graph, { value: 1 }, {} as McpPool, e => events.push(e))
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) expect(typeof e.t).toBe('number')
    for (let i = 1; i < events.length; i++) expect(events[i].t!).toBeGreaterThanOrEqual(events[i - 1].t!)
  })
})

describe('POST /replay', () => {
  let base: string
  let server: ReturnType<ReturnType<typeof createApp>['listen']>

  beforeAll(async () => {
    const app = createApp()
    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
    base = `http://localhost:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => { server.close() })

  it('streams the recorded events and a done summary over SSE', async () => {
    const res = await fetch(`${base}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: sampleEvents }),
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const messages: Array<{ event: string; data: any }> = []
    let event = '', data = ''
    for (const line of text.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7)
      else if (line.startsWith('data: ')) data = line.slice(6)
      else if (line === '' && event && data) {
        messages.push({ event, data: JSON.parse(data) })
        event = ''; data = ''
      }
    }

    const nodeEvents = messages.filter(m => m.event === 'node')
    expect(nodeEvents.length).toBe(4)
    expect(nodeEvents.map(m => m.data.nodeId)).toEqual(['a', 'a', 'b', 'b'])

    const done = messages.at(-1)
    expect(done?.event).toBe('done')
    expect(done?.data.summary).toEqual({ eventCount: 4, nodeCount: 1, errorCount: 1, durationMs: 8 })
  })

  it('returns 400 JSON when events are missing', async () => {
    const res = await fetch(`${base}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing events')
  })
})
