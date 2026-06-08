import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { plantGraph } from './lib/plant'

async function main() {
  const rawArgs = process.argv.slice(2)
  const outIdx = rawArgs.indexOf('--out')
  let outFile: string | null = null
  if (outIdx !== -1) { outFile = rawArgs[outIdx + 1]; rawArgs.splice(outIdx, 2) }
  const task = rawArgs.join(' ')

  if (!task) {
    console.error('Usage: npx tsx run_plant.ts "describe the agent graph you want" [--out graph.json]')
    process.exit(1)
  }

  const graph = await plantGraph(task)

  console.log('\n── generated graph ' + '─'.repeat(50))
  console.log(JSON.stringify(graph, null, 2))
  console.log('\n── node summary ' + '─'.repeat(50))
  graph.nodes.forEach(n => {
    const ins  = (n.inputs  ?? []).map(p => p.id + (p.optional ? '?' : '')).join(', ')
    const outs = (n.outputs ?? []).map(p => p.id).join(', ')
    console.log(`  ${n.id.padEnd(20)} in:[${ins}]  out:[${outs}]`)
  })

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(graph, null, 2))
    console.log(`\n── saved to ${outFile}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
