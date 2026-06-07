import { deserialize } from './core/serializer'
import { runGraph } from './core/executor'
import type { SerializedGraph } from './core/serializer'
import { http_fetch } from './node/capabilities/http_fetch'
import { research_answer } from './node/capabilities/research_answer_openai'
import { memory_read } from './node/capabilities/memory_read'
import { memory_write } from './node/capabilities/memory_write'
import graphData from './node/graphs/MemoryOrFetch.graph.json'

async function passthrough(inputs: Record<string, any>): Promise<{ response: string }> {
  return { response: String(inputs.cached) }
}

async function main() {
  const [,, url, question = 'Summarise this page in 2 sentences.'] = process.argv
  if (!url) { console.error('Usage: run_memory_or_fetch.ts <url> [question]'); process.exit(1) }

  const graph = deserialize(graphData as SerializedGraph, {
    http_fetch, research_answer, memory_read, memory_write, passthrough,
  })

  console.log(`URL:      ${url}`)
  console.log(`Question: ${question}`)
  console.log('='.repeat(60))

  let cacheHit = false

  const values = await runGraph(
    graph,
    {},
    (event) => {
      if (event.type !== 'complete') return
      if (event.nodeId === 'passthrough') { cacheHit = true; console.log('Cache HIT — returning stored answer.\n') }
      if (event.nodeId === 'http_fetch')  { console.log('Cache MISS — fetching page...\n') }
    },
    { url, question }
  )

  const response = values.get('gate:response')
  console.log(response)

  if (!cacheHit) {
    console.log(`\nStored under key: "${url}"`)
    console.log('Run again to see the cache hit.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
