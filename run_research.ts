import { deserialize } from './core/serializer'
import { runGraph } from './core/executor'
import type { SerializedGraph } from './core/serializer'
import { http_fetch } from './node/capabilities/http_fetch'
import { research_answer } from './node/capabilities/research_answer_openai'
import graphData from './node/graphs/ResearchAgent.graph.json'

async function main() {
  const url      = process.argv[2] ?? 'https://en.wikipedia.org/wiki/Directed_acyclic_graph'
  const question = process.argv[3] ?? 'What are the main use cases of a DAG?'

  const graph = deserialize(graphData as SerializedGraph, { http_fetch, research_answer })

  console.log(`URL:      ${url}`)
  console.log(`Question: ${question}`)
  console.log('='.repeat(60))

  await runGraph(
    graph,
    {},
    (id, _inputs, _output, _depth) => {
      if (id === 'http_fetch') console.log('Fetched. Answering...\n')
    },
    { url, question }
  )

  console.log()
}

main().catch(err => { console.error(err); process.exit(1) })
