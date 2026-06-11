import { config } from 'dotenv'
config({ path: '.env.local' })

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { executeSubgraph } from './lib/execute-engine'
import { usageSummary } from './lib/llm-usage'
import type { SerializedGraph } from './core/serializer'

function readJson<T>(path: string, what: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.error(`${what} is not valid JSON (${path}): ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

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

  if (!existsSync(args.graph)) {
    console.error(`Graph file not found: ${args.graph}`)
    console.error('Design one first: npx tsx run_plant.ts "describe the task" --out graph.json')
    process.exit(1)
  }
  const graph = readJson<SerializedGraph>(args.graph, 'Graph file')

  if (args['inputs-file'] && !existsSync(args['inputs-file'])) {
    const ports = graph.nodes.find(n => n.id === '$input')?.outputs ?? []
    console.error(`Inputs file not found: ${args['inputs-file']}`)
    console.error(`Create it as JSON supplying the graph's input ports${
      ports.length ? `, e.g.:\n  { ${ports.map(p => `"${p.id}": <${p.type}>`).join(', ')} }` : '.'}`)
    process.exit(1)
  }
  const userInputs: Record<string, unknown> = args['inputs-file']
    ? readJson(args['inputs-file'], 'Inputs file')
    : args.inputs ? JSON.parse(args.inputs) : {}

  const pool = new McpPool()
  await pool.connect()

  console.log(`\n── executing ${'─'.repeat(40)}`)

  const events: unknown[] = []
  const outputs = await executeSubgraph(graph, userInputs, pool, e => events.push(e), 0, false, undefined, allowedTools)

  await pool.close()

  if (args.out) {
    const usage = usageSummary()
    writeFileSync(args.out, JSON.stringify({
      graph: args.graph, inputs: userInputs, outputs, events,
      ...(usage.requests > 0 ? { usage } : {}),
    }, null, 2))
    console.log(`\n── trace → ${args.out}`)
  }
}

main().catch(err => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
