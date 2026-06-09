import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync, writeFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { executeSubgraph } from './lib/execute-engine'
import type { SerializedGraph } from './core/serializer'

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

  if (!args.graph) {
    console.error('Usage: npx tsx run_execute.ts --graph graph.json --inputs-file inputs.json [--out trace.json] [--allowed-tools tool1,tool2,prefix__*]')
    process.exit(1)
  }

  const allowedTools = args['allowed-tools']
    ? args['allowed-tools'].split(',').map(t => t.trim()).filter(Boolean)
    : undefined

  const graph: SerializedGraph = JSON.parse(readFileSync(args.graph, 'utf8'))
  const userInputs: Record<string, unknown> = args['inputs-file']
    ? JSON.parse(readFileSync(args['inputs-file'], 'utf8'))
    : args.inputs ? JSON.parse(args.inputs) : {}

  const pool = new McpPool()
  await pool.connect()

  console.log(`\n── executing ${'─'.repeat(40)}`)

  const events: unknown[] = []
  const outputs = await executeSubgraph(graph, userInputs, pool, e => events.push(e), 0, false, undefined, allowedTools)

  await pool.close()

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ graph: args.graph, inputs: userInputs, outputs, events }, null, 2))
    console.log(`\n── trace → ${args.out}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
