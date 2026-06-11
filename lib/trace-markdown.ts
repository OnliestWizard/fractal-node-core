// Trace → markdown — renders a saved execution trace as a markdown replay
// that GitHub displays directly, so a trace committed next to a delivery
// doubles as a human-readable receipt: the console timeline (▶/✓/✗, durations,
// depth indentation), inputs, outputs, and errors, with the commit as the medium.

import type { NodeEvent } from './execute-engine'
import { formatUsage, type UsageSummary } from './llm-usage'

export interface TraceFile {
  graph?: string
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  events?: NodeEvent[]
  /** Stamped by run_execute when the run spent tokens — cost is a receipt. */
  usage?: UsageSummary
}

export interface TraceRenderOptions {
  /** Heading; defaults to the trace's graph name. */
  title?: string
  /** Where the trace came from — named in the footer so the receipt links back. */
  source?: string
  /** Per-value character cap for inputs/outputs (default 1500). */
  maxValueChars?: number
}

export function formatMs(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// JSON-string values (how MCP results arrive) are parsed so the receipt shows
// structure instead of an escaped blob; anything else pretty-prints as JSON.
function prettyValue(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
    } catch { /* plain string */ }
    return value
  }
  return JSON.stringify(value, null, 2)
}

function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n… (${text.length - cap} chars truncated)`
}

// Widen the fence when the content itself contains one
function fenced(text: string, lang = ''): string {
  const fence = text.includes('```') ? '````' : '```'
  return `${fence}${lang}\n${text}\n${fence}`
}

function timelineLine(e: NodeEvent): string {
  const indent = '  '.repeat(e.depth)
  if (e.type === 'start') return `${indent}▶ ${e.nodeId}`
  if (e.type === 'complete') return `${indent}✓ ${e.nodeId} (${formatMs(e.durationMs)})`
  return `${indent}✗ ${e.nodeId} (${formatMs(e.durationMs)}) — ${e.error}`
}

export function renderTraceMarkdown(trace: TraceFile, opts: TraceRenderOptions = {}): string {
  const events = trace.events ?? []
  const cap = opts.maxValueChars ?? 1500

  const completed = events.filter(e => e.type === 'complete').length
  const errors = events.filter(e => e.type === 'error')
  const stamped = events.filter(e => e.t !== undefined)
  const spanMs = stamped.length >= 2 ? stamped[stamped.length - 1].t! - stamped[0].t! : 0

  const lines: string[] = []
  lines.push(`# Trace replay — ${opts.title ?? trace.graph ?? 'execution'}`)
  lines.push('')
  const span = spanMs > 0 ? ` · recorded span ${formatMs(spanMs)}` : ''
  lines.push(`**${events.length} events · ${completed} nodes completed · ${errors.length} error${errors.length === 1 ? '' : 's'}${span}**`)

  if (trace.usage && trace.usage.requests > 0) {
    lines.push('', `*${formatUsage(trace.usage)}*`)
  }

  if (trace.inputs && Object.keys(trace.inputs).length > 0) {
    lines.push('', '## Inputs', '', fenced(truncate(JSON.stringify(trace.inputs, null, 2), cap), 'json'))
  }

  lines.push('', '## Timeline', '')
  lines.push(events.length > 0 ? fenced(events.map(timelineLine).join('\n')) : '*no events recorded*')

  if (errors.length > 0) {
    lines.push('', '## Errors', '')
    for (const e of errors) {
      if (e.type === 'error') lines.push(`- \`${e.nodeId}\` — ${e.error}`)
    }
  }

  const outputs = Object.entries(trace.outputs ?? {})
  if (outputs.length > 0) {
    lines.push('', '## Outputs')
    for (const [port, value] of outputs) {
      lines.push('', `### \`${port}\``, '', fenced(truncate(prettyValue(value), cap)))
    }
  }

  lines.push('', '---', '')
  lines.push(`*Rendered by trace-markdown${opts.source ? ` from \`${opts.source}\`` : ''}. The timeline above replays the recorded execution — it is the trace, not a description of it.*`)
  lines.push('')
  return lines.join('\n')
}
