import express from 'express'
import cors from 'cors'
import { deserialize, validateRegistry } from './core/serializer'
import { validateGraph } from './core/validator'
import { runGraph } from './core/executor'
import { collectEvents } from './node/tracer'
import { emitGraphJS } from './emitters/web/emitGraphJS'
import { emitGraphKotlin } from './emitters/android/emitKotlin'
import { emitGraphSwift } from './emitters/swift/emitSwift'
import type { SerializedGraph } from './core/serializer'
import { plantGraph } from './lib/plant'
import { executeSubgraph } from './lib/execute-engine'
import { McpPool } from './lib/mcp-pool'

// ── Built-in capability registry ─────────────────────────────────────────────

import { http_fetch }      from './node/capabilities/http_fetch'
import { research_answer } from './node/capabilities/research_answer_openai'
import { draft_writer }    from './node/capabilities/draft_writer_openai'
import { quality_judge }   from './node/capabilities/quality_judge_openai'
import { memory_read }     from './node/capabilities/memory_read'
import { memory_write }    from './node/capabilities/memory_write'
import { passthrough }     from './node/capabilities/passthrough'

const REGISTRY = {
  http_fetch,
  research_answer,
  draft_writer,
  quality_judge,
  memory_read,
  memory_write,
  passthrough,
}

// ── Graph catalog ────────────────────────────────────────────────────────────

import researchAgentGraph    from './node/graphs/ResearchAgent.graph.json'
import memoryOrFetchGraph    from './node/graphs/MemoryOrFetch.graph.json'
import refineLoopGraph       from './node/graphs/RefineLoop.graph.json'
import toolAgentGraph        from './node/graphs/ToolAgent.graph.json'
import researchRememberGraph from './node/graphs/ResearchAndRemember.graph.json'
import recallGraph           from './node/graphs/Recall.graph.json'

const GRAPHS = [
  { name: 'ResearchAgent',        graph: researchAgentGraph    },
  { name: 'MemoryOrFetch',        graph: memoryOrFetchGraph    },
  { name: 'RefineLoop',           graph: refineLoopGraph       },
  { name: 'ToolAgent',            graph: toolAgentGraph        },
  { name: 'ResearchAndRemember',  graph: researchRememberGraph },
  { name: 'Recall',               graph: recallGraph           },
]

// ── Node catalog ──────────────────────────────────────────────────────────────

import httpFetchContract    from './node/nodes/HttpFetch.node.json'
import researchContract     from './node/nodes/ResearchAnswer.node.json'
import draftWriterContract  from './node/nodes/DraftWriter.node.json'
import qualityJudgeContract from './node/nodes/QualityJudge.node.json'
import memoryReadContract   from './node/nodes/MemoryRead.node.json'
import memoryWriteContract  from './node/nodes/MemoryWrite.node.json'
import llmReasonContract    from './node/nodes/LLMReason.node.json'
import captureContract      from './node/nodes/CaptureAudio.node.json'
import transcribeContract   from './node/nodes/TranscribeAudio.node.json'

const CATALOG = [
  httpFetchContract,
  researchContract,
  draftWriterContract,
  qualityJudgeContract,
  memoryReadContract,
  memoryWriteContract,
  llmReasonContract,
  captureContract,
  transcribeContract,
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractOutputs(graph: SerializedGraph, values: Map<string, any>): Record<string, any> {
  const outputs: Record<string, any> = {}
  for (const edge of graph.edges) {
    if (edge.to.nodeId === '$output') {
      outputs[edge.to.portId] = values.get(`${edge.from.nodeId}:${edge.from.portId}`)
    }
  }
  return outputs
}

// ── App ───────────────────────────────────────────────────────────────────────

export function createApp(sharedPool?: McpPool) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  // GET /health
  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  // GET /graphs
  app.get('/graphs', (_req, res) => {
    res.json({ graphs: GRAPHS })
  })

  // GET /capabilities
  // Returns all built-in node contracts for the editor node picker.
  app.get('/capabilities', (_req, res) => {
    res.json({ capabilities: CATALOG })
  })

  // POST /validate
  // Body: { graph: SerializedGraph }
  // Returns: { valid: boolean, errors: ValidationError[] }
  app.post('/validate', (req, res) => {
    const { graph } = req.body as { graph: SerializedGraph }
    if (!graph) return res.status(400).json({ error: 'Missing graph' })

    const errors = validateGraph(graph)
    res.json({ valid: errors.length === 0, errors })
  })

  // POST /emit/:platform   (js | kotlin | swift)
  // Body: { graph: SerializedGraph }
  // Returns: { files: Record<string, string> }
  app.post('/emit/:platform', (req, res) => {
    const { graph } = req.body as { graph: SerializedGraph }
    if (!graph) return res.status(400).json({ error: 'Missing graph' })

    const { platform } = req.params

    let files: Record<string, string>
    if      (platform === 'js')     files = emitGraphJS(graph)
    else if (platform === 'kotlin') files = emitGraphKotlin(graph)
    else if (platform === 'swift')  files = emitGraphSwift(graph)
    else return res.status(400).json({ error: `Unknown platform "${platform}". Use js, kotlin, or swift.` })

    res.json({ files })
  })

  // POST /run
  // Body: { graph: SerializedGraph, inputs?: Record<string, any>, trace?: boolean }
  // Returns: { outputs: Record<string, any>, events?: NodeEvent[] }
  app.post('/run', async (req, res) => {
    const { graph, inputs, trace } = req.body as { graph: SerializedGraph; inputs?: Record<string, any>; trace?: boolean }
    if (!graph) return res.status(400).json({ error: 'Missing graph' })

    const validationErrors = validateGraph(graph)
    if (validationErrors.length) {
      return res.status(422).json({ error: 'Invalid graph', errors: validationErrors })
    }

    const missing = validateRegistry(graph, REGISTRY)
    if (missing.length) {
      return res.status(422).json({ error: `Missing registry entries: ${missing.join(', ')}` })
    }

    try {
      const execGraph = deserialize(graph, REGISTRY)
      const { hook, events } = collectEvents()
      const values = await runGraph(execGraph, {}, trace ? hook : undefined, inputs)
      const result: Record<string, any> = { outputs: extractOutputs(graph, values) }
      if (trace) result.events = events
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Execution failed' })
    }
  })

  // POST /run/stream
  // Body: { graph: SerializedGraph, inputs?: Record<string, any> }
  // Returns: SSE stream of NodeEvent objects, then a final "done" event with outputs
  // Error before stream starts: regular JSON 400/422. Error mid-execution: SSE "error" event.
  app.post('/run/stream', async (req, res) => {
    const { graph, inputs } = req.body as { graph: SerializedGraph; inputs?: Record<string, any> }
    if (!graph) return res.status(400).json({ error: 'Missing graph' })

    const validationErrors = validateGraph(graph)
    if (validationErrors.length) {
      return res.status(422).json({ error: 'Invalid graph', errors: validationErrors })
    }

    const missing = validateRegistry(graph, REGISTRY)
    if (missing.length) {
      return res.status(422).json({ error: `Missing registry entries: ${missing.join(', ')}` })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const execGraph = deserialize(graph, REGISTRY)
      const values = await runGraph(execGraph, {}, (event) => send('node', event), inputs)
      send('done', { outputs: extractOutputs(graph, values) })
    } catch (err: any) {
      send('error', { error: err.message ?? 'Execution failed' })
    } finally {
      res.end()
    }
  })

  // POST /plant
  // Body: { task: string }
  // Returns: { graph: SerializedGraph }
  app.post('/plant', async (req, res) => {
    const { task } = req.body as { task?: string }
    if (!task) return res.status(400).json({ error: 'Missing task' })

    try {
      const graph = await plantGraph(task)
      res.json({ graph })
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Plant failed' })
    }
  })

  // POST /execute/stream
  // Body: { graph: SerializedGraph, inputs?: Record<string, any> }
  // Returns: SSE stream compatible with /run/stream — same event format
  app.post('/execute/stream', async (req, res) => {
    const { graph, inputs } = req.body as { graph: SerializedGraph; inputs?: Record<string, any> }
    if (!graph) return res.status(400).json({ error: 'Missing graph' })

    const validationErrors = validateGraph(graph)
    if (validationErrors.length) {
      return res.status(422).json({ error: 'Invalid graph', errors: validationErrors })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    if (sharedPool) {
      try {
        const outputs = await executeSubgraph(graph, inputs ?? {}, sharedPool, event => send('node', event))
        send('done', { outputs })
      } catch (err: any) {
        send('error', { error: err.message ?? 'Execution failed' })
      } finally {
        res.end()
      }
    } else {
      const pool = new McpPool()
      try {
        await pool.connect()
        const outputs = await executeSubgraph(graph, inputs ?? {}, pool, event => send('node', event))
        send('done', { outputs })
      } catch (err: any) {
        send('error', { error: err.message ?? 'Execution failed' })
      } finally {
        await pool.close()
        res.end()
      }
    }
  })

  return app
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const port = Number(process.env.PORT ?? 3000)

  const pool = new McpPool()
  await pool.connect()

  const app = createApp(pool)
  const server = app.listen(port, () => {
    console.log(`fractal server running on http://localhost:${port}`)
    console.log(`  GET  /health`)
    console.log(`  GET  /capabilities`)
    console.log(`  POST /validate`)
    console.log(`  POST /emit/:platform   (js | kotlin | swift)`)
    console.log(`  POST /run`)
    console.log(`  POST /run/stream       (SSE)`)
  })

  const shutdown = async () => {
    server.close()
    await pool.close()
    process.exit(0)
  }

  process.on('SIGINT',  shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => { console.error(err); process.exit(1) })
