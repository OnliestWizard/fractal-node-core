import { deserialize } from './core/serializer'
import { runGraph } from './core/executor'
import type { SerializedGraph } from './core/serializer'
import { draft_writer } from './node/capabilities/draft_writer_openai'
import { quality_judge } from './node/capabilities/quality_judge_openai'
import graphData from './node/graphs/RefineLoop.graph.json'

async function main() {
  const prompt = process.argv[2] ?? 'Explain how a fractal graph execution engine works, in plain English.'
  const graph = deserialize(graphData as SerializedGraph, { draft_writer, quality_judge })

  let iteration = 0

  console.log(`Prompt: ${prompt}`)
  console.log('='.repeat(60))

  await runGraph(
    graph,
    {},
    (event) => {
      if (event.type !== 'complete') return
      const { nodeId, outputs } = event
      if (nodeId === 'draft_writer') {
        iteration++
        process.stdout.write('\n')
        console.log('-'.repeat(60))
        console.log(`Draft ${iteration}`)
        console.log('-'.repeat(60))
      }
      if (nodeId === 'quality_judge') {
        const verdict = outputs.continue ? 'CONTINUE' : 'DONE'
        console.log(`\nJudge: ${verdict}`)
        if (outputs.feedback) console.log(`Feedback: ${outputs.feedback}`)
        console.log('='.repeat(60))
      }
    },
    { prompt }
  )
}

main().catch(err => { console.error(err); process.exit(1) })
