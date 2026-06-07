import type { NodeEvent, NodeHook } from '../core/executor'

const INDENT = '  '

function pad(n: number): string {
  return String(n).padStart(4, ' ')
}

export function createTracer(label?: string): NodeHook {
  if (label) process.stdout.write(`\n[trace] ${label}\n`)

  return (event: NodeEvent) => {
    const prefix = INDENT.repeat(event.depth)
    if (event.type === 'start') {
      process.stdout.write(`${prefix}→ ${event.nodeId}\n`)
    } else if (event.type === 'complete') {
      process.stdout.write(`${prefix}✓ ${event.nodeId} (${pad(event.durationMs)}ms)\n`)
    } else {
      process.stdout.write(`${prefix}✗ ${event.nodeId} (${pad(event.durationMs)}ms): ${event.error.message}\n`)
    }
  }
}

export function collectEvents(): { hook: NodeHook; events: NodeEvent[] } {
  const events: NodeEvent[] = []
  return { hook: (e) => events.push(e), events }
}
