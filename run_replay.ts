import { readFileSync } from 'fs'
import { replayTrace } from './lib/replay'
import type { NodeEvent } from './lib/execute-engine'

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      out[argv[i].slice(2)] = argv[i + 1]
      i++
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.trace) {
    console.error('Usage: npx tsx run_replay.ts --trace trace.json [--speed 1]')
    console.error('  --speed 0 = instant (default), 1 = recorded pace, 2 = twice as fast')
    process.exit(1)
  }

  const trace = JSON.parse(readFileSync(args.trace, 'utf8')) as {
    graph?: string
    inputs?: Record<string, unknown>
    outputs?: Record<string, unknown>
    events: NodeEvent[]
  }
  const speed = args.speed ? Number(args.speed) : 0

  console.log(`\n── replaying ${args.trace}${trace.graph ? ` (graph: ${trace.graph})` : ''} ${'─'.repeat(20)}`)
  if (trace.inputs) console.log(`  inputs: ${JSON.stringify(trace.inputs)}`)

  const summary = await replayTrace(trace.events ?? [], e => {
    const indent = '  '.repeat(e.depth + 1)
    if (e.type === 'start') {
      console.log(`${indent}▶ ${e.nodeId}`)
    } else if (e.type === 'complete') {
      console.log(`${indent}✓ ${e.nodeId} (${Math.round(e.durationMs)}ms)`)
    } else {
      console.log(`${indent}✗ ${e.nodeId} — ${e.error}`)
    }
  }, speed)

  console.log(`\n── summary ${'─'.repeat(40)}`)
  console.log(`  ${summary.eventCount} events, ${summary.nodeCount} completed, ${summary.errorCount} errors, recorded span ${summary.durationMs}ms`)
  if (trace.outputs) {
    console.log(`\n── recorded outputs ${'─'.repeat(32)}`)
    console.log(JSON.stringify(trace.outputs, null, 2))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
