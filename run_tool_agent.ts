import { deserialize } from './core/serializer'
import { runGraph } from './core/executor'
import type { SerializedGraph } from './core/serializer'
import { http_fetch } from './node/capabilities/http_fetch'
import { memory_read } from './node/capabilities/memory_read'
import { memory_write } from './node/capabilities/memory_write'
import graphData from './node/graphs/ToolAgent.graph.json'

async function main() {
  const prompt = process.argv.slice(2).join(' ') || 'What is a directed acyclic graph?'

  const graph = deserialize(graphData as SerializedGraph, { http_fetch, memory_read, memory_write })

  const system = `You are a research assistant with access to tools for fetching web pages and persisting information to memory.
Think step by step. Before fetching a URL, check memory to see if you already have the answer.
After answering, store your response in memory so future queries can reuse it.`

  console.log(`Prompt: ${prompt}`)
  console.log('='.repeat(60))

  const values = await runGraph(
    graph,
    {},
    (event) => {
      if (event.type === 'complete' && event.nodeId === 'tool_agent') process.stdout.write(event.outputs.response ?? '')
    },
    { prompt, system }
  )

  console.log('\n' + '='.repeat(60))
  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
