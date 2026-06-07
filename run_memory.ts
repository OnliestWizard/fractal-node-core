import { deserialize } from './core/serializer'
import { runGraph } from './core/executor'
import type { SerializedGraph } from './core/serializer'
import { http_fetch } from './node/capabilities/http_fetch'
import { research_answer } from './node/capabilities/research_answer_openai'
import { memory_write } from './node/capabilities/memory_write'
import { memory_read } from './node/capabilities/memory_read'
import rememberData from './node/graphs/ResearchAndRemember.graph.json'
import recallData from './node/graphs/Recall.graph.json'

async function main() {
  const [,, cmd, ...args] = process.argv

  if (cmd === 'write') {
    const [url, question = 'Summarise this page in 3 sentences.'] = args
    if (!url) { console.error('Usage: run_memory.ts write <url> [question]'); process.exit(1) }

    const graph = deserialize(rememberData as SerializedGraph, { http_fetch, research_answer, memory_write })

    console.log(`Fetching: ${url}`)
    console.log(`Question: ${question}`)
    console.log('='.repeat(60))

    await runGraph(
      graph,
      {},
      (id, _in, out) => {
        if (id === 'http_fetch')      console.log('Fetched. Answering...\n')
        if (id === 'research_answer') process.stdout.write('\n')
        if (id === 'memory_write')    console.log(`\nStored under key: "${out.key}"`)
      },
      { url, question }
    )
    return
  }

  if (cmd === 'read') {
    const [key] = args
    if (!key) { console.error('Usage: run_memory.ts read <key>'); process.exit(1) }

    const graph = deserialize(recallData as SerializedGraph, { memory_read })
    const values = await runGraph(graph, {}, undefined, { key })

    const found = values.get('memory_read:found')
    const value = values.get('memory_read:value')

    if (found) {
      console.log(`Key: ${key}\n`)
      console.log(value)
    } else {
      console.log(`No memory found for key: "${key}"`)
    }
    return
  }

  console.error('Usage: run_memory.ts write <url> [question]')
  console.error('       run_memory.ts read <key>')
  process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
