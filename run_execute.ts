import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync, writeFileSync, existsSync } from 'fs'
import OpenAI from 'openai'
import { topologicalSort } from './core/topo'
import type { SerializedGraph } from './core/serializer'
import type { Edge } from './core/types'
import { McpPool } from './lib/mcp-pool'

// ── CLI ──────────────────────────────────────────────────────────────────────

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

// ── OpenAI ───────────────────────────────────────────────────────────────────

let _oai: OpenAI | undefined
const oai = () => (_oai ??= new OpenAI())

// ── Wire state ───────────────────────────────────────────────────────────────

type Wire = Map<string, unknown>
const wkey = (nodeId: string, portId: string) => `${nodeId}:${portId}`

// ── Trace ────────────────────────────────────────────────────────────────────

interface TraceEntry {
  nodeId: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown> | null
  durationMs: number
  error: string | null
  skipped?: true
}

// ── Auto-boxing ───────────────────────────────────────────────────────────────

function autoBox(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch {}
    const lines = value.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length > 1 && lines.every(l => l.includes('/') || l.includes('\\')))
      return { paths: lines }
  }
  return { value }
}

// ── Builtins ─────────────────────────────────────────────────────────────────

async function runBuiltin(nodeId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (nodeId) {
    case 'passthrough':
      return { value: inputs.value }

    case 'http_fetch': {
      const res = await fetch(String(inputs.url), { method: String(inputs.method ?? 'GET') })
      return { body: await res.text(), status: res.status }
    }

    case 'research_answer': {
      const res = await oai().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Answer the question based only on the provided content.' },
          { role: 'user', content: `Content:\n${inputs.content}\n\nQuestion: ${inputs.question}` },
        ],
      })
      return { response: res.choices[0].message.content ?? '' }
    }

    case 'draft_writer': {
      const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []
      if (inputs.system) msgs.push({ role: 'system', content: String(inputs.system) })
      let body = String(inputs.prompt)
      if (inputs.draft)    body += `\n\nExisting draft:\n${inputs.draft}`
      if (inputs.feedback) body += `\n\nFeedback:\n${inputs.feedback}`
      msgs.push({ role: 'user', content: body })
      const res = await oai().chat.completions.create({ model: 'gpt-4o-mini', messages: msgs })
      return { response: res.choices[0].message.content ?? '' }
    }

    case 'quality_judge': {
      const res = await oai().chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Evaluate the draft. Return JSON: { response: string, continue: boolean, feedback: string }. Set continue=true if revision is needed.' },
          { role: 'user', content: `Prompt: ${inputs.prompt}\n\nDraft:\n${inputs.draft}` },
        ],
      })
      const p = JSON.parse(res.choices[0].message.content ?? '{}')
      return { response: p.response ?? '', continue: p.continue ?? false, feedback: p.feedback ?? '' }
    }

    case 'memory_read': {
      const store = existsSync('memory-store.json') ? JSON.parse(readFileSync('memory-store.json', 'utf8')) : {}
      const value = store[String(inputs.key)]
      return { value: value ?? '', found: value !== undefined }
    }

    case 'memory_write': {
      const store = existsSync('memory-store.json') ? JSON.parse(readFileSync('memory-store.json', 'utf8')) : {}
      store[String(inputs.key)] = inputs.value
      writeFileSync('memory-store.json', JSON.stringify(store, null, 2))
      return { key: inputs.key }
    }

    default:
      throw new Error(`No builtin for node "${nodeId}"`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.graph) {
    console.error('Usage: npx tsx run_execute.ts --graph graph.json --inputs \'{"key":"value"}\' [--out trace.json]')
    process.exit(1)
  }

  const graph: SerializedGraph = JSON.parse(readFileSync(args.graph, 'utf8'))
  const userInputs: Record<string, unknown> = args['inputs-file']
    ? JSON.parse(readFileSync(args['inputs-file'], 'utf8'))
    : args.inputs ? JSON.parse(args.inputs) : {}

  const pool = new McpPool()
  await pool.connect()

  const wire: Wire = new Map()
  const trace: TraceEntry[] = []

  // Build outgoing edge index
  const outEdges = new Map<string, Edge[]>()
  for (const node of graph.nodes) outEdges.set(node.id, [])
  for (const edge of graph.edges) outEdges.get(edge.from.nodeId)?.push(edge)

  const order = topologicalSort(graph.nodes.map(n => n.id), graph.edges)
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))

  console.log(`\n── executing ${order.length} nodes ${'─'.repeat(40)}`)

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId)!

    // Skip if required inputs are missing (upstream failure)
    if (nodeId !== '$input') {
      const missing = (node.inputs ?? [])
        .filter(p => !p.optional && !wire.has(wkey(nodeId, p.id)))
        .map(p => p.id)

      if (missing.length > 0) {
        console.log(`  ⚠ ${nodeId} — skipped (missing: ${missing.join(', ')})`)
        trace.push({ nodeId, inputs: {}, outputs: null, durationMs: 0, error: `skipped: missing inputs [${missing.join(', ')}]`, skipped: true })
        continue
      }
    }

    // Gather inputs from wire
    const inputs: Record<string, unknown> = nodeId === '$input'
      ? { ...userInputs }
      : Object.fromEntries((node.inputs ?? []).map(p => [p.id, wire.get(wkey(nodeId, p.id))]))

    const t0 = performance.now()
    let outputs: Record<string, unknown> | null = null
    let error: string | null = null

    try {
      if (nodeId === '$input') {
        outputs = userInputs
        console.log(`  ✓ $input       ${JSON.stringify(outputs)}`)
      } else if (nodeId === '$output') {
        outputs = inputs
        console.log(`\n── $output ${'─'.repeat(40)}`)
        console.log(JSON.stringify(outputs, null, 2))
      } else if (nodeId.includes('__')) {
        const sep = nodeId.indexOf('__')
        const serverId  = nodeId.slice(0, sep)
        const toolName  = nodeId.slice(sep + 2)
        const result = await pool.callTool(serverId, toolName, autoBox(inputs.params))
        outputs = { result }
        console.log(`  ✓ ${nodeId}`)
      } else {
        outputs = await runBuiltin(nodeId, inputs)
        console.log(`  ✓ ${nodeId}`)
      }
    } catch (err) {
      error = String(err)
      console.log(`  ✗ ${nodeId} — ${error}`)
    }

    const durationMs = performance.now() - t0
    trace.push({ nodeId, inputs, outputs, durationMs, error })

    // Propagate outputs along edges
    if (outputs) {
      for (const edge of outEdges.get(nodeId) ?? []) {
        wire.set(wkey(edge.to.nodeId, edge.to.portId), outputs[edge.from.portId])
      }
    }
  }

  await pool.close()

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ graph: args.graph, inputs: userInputs, trace }, null, 2))
    console.log(`\n── trace → ${args.out}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
