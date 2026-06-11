import { describe, it, expect } from 'vitest'
import { renderTraceMarkdown, formatMs, type TraceFile } from '../lib/trace-markdown'
import type { NodeEvent } from '../lib/execute-engine'

const ev = (partial: Partial<NodeEvent> & { type: NodeEvent['type']; nodeId: string }): NodeEvent =>
  ({ depth: 0, ...partial }) as NodeEvent

const trace: TraceFile = {
  graph: 'demo_graph.json',
  inputs: { topic: 'receipts' },
  outputs: { haiku: 'lines fall like rain' },
  events: [
    ev({ type: 'start', nodeId: '$input', t: 0 }),
    ev({ type: 'complete', nodeId: '$input', durationMs: 1, t: 1 }),
    ev({ type: 'start', nodeId: 'writer', t: 2 }),
    ev({ type: 'start', nodeId: 'inner', depth: 1, t: 3 }),
    ev({ type: 'complete', nodeId: 'inner', durationMs: 4, depth: 1, t: 7 }),
    ev({ type: 'complete', nodeId: 'writer', durationMs: 845, t: 847 }),
  ],
}

describe('formatMs', () => {
  it('covers sub-ms, ms, and seconds', () => {
    expect(formatMs(0.3)).toBe('<1ms')
    expect(formatMs(847.3)).toBe('847ms')
    expect(formatMs(1350)).toBe('1.35s')
  })
})

describe('renderTraceMarkdown', () => {
  it('renders the console timeline with glyphs and depth indentation', () => {
    const md = renderTraceMarkdown(trace)
    expect(md).toContain('▶ $input')
    expect(md).toContain('✓ $input (1ms)')
    expect(md).toContain('  ▶ inner')
    expect(md).toContain('  ✓ inner (4ms)')
    expect(md).toContain('✓ writer (845ms)')
  })

  it('summarizes events, completes, errors, and recorded span in the header', () => {
    const md = renderTraceMarkdown(trace)
    expect(md).toContain('# Trace replay — demo_graph.json')
    expect(md).toContain('**6 events · 3 nodes completed · 0 errors · recorded span 847ms**')
  })

  it('surfaces error events in the timeline and an Errors section', () => {
    const md = renderTraceMarkdown({
      events: [
        ev({ type: 'start', nodeId: 'boom', t: 0 }),
        ev({ type: 'error', nodeId: 'boom', error: 'tool refused', durationMs: 3, t: 3 }),
      ],
    })
    expect(md).toContain('✗ boom (3ms) — tool refused')
    expect(md).toContain('## Errors')
    expect(md).toContain('- `boom` — tool refused')
    expect(md).toContain('· 1 error ·')
  })

  it('pretty-prints JSON-string outputs (how MCP results arrive)', () => {
    const md = renderTraceMarkdown({
      outputs: { issue: '{"number":7,"state":"open"}' },
      events: [],
    })
    expect(md).toContain('### `issue`')
    expect(md).toContain('"number": 7')
  })

  it('truncates oversized values and says how much was cut', () => {
    const md = renderTraceMarkdown(
      { outputs: { blob: 'x'.repeat(2000) }, events: [] },
      { maxValueChars: 100 },
    )
    expect(md).toContain('… (1900 chars truncated)')
    expect(md).not.toContain('x'.repeat(200))
  })

  it('widens the fence when content contains backticks', () => {
    const md = renderTraceMarkdown({
      outputs: { doc: 'a ```fenced``` block' },
      events: [],
    })
    expect(md).toContain('````\na ```fenced``` block\n````')
  })

  it('handles a trace with no events, inputs, or outputs', () => {
    const md = renderTraceMarkdown({})
    expect(md).toContain('# Trace replay — execution')
    expect(md).toContain('*no events recorded*')
    expect(md).not.toContain('## Inputs')
    expect(md).not.toContain('## Outputs')
  })

  it('names the source file in the footer when given', () => {
    const md = renderTraceMarkdown(trace, { source: 'demo_trace.json' })
    expect(md).toContain('from `demo_trace.json`')
  })
})
