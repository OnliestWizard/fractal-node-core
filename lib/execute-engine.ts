import OpenAI from 'openai'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { topologicalSort } from '../core/topo'
import type { SerializedGraph, SerializedNode } from '../core/serializer'
import type { Edge } from '../core/types'
import { McpPool } from './mcp-pool'
import { plantGraph } from './plant'

export type NodeEvent =
  | { type: 'start';    nodeId: string; depth: number }
  | { type: 'complete'; nodeId: string; durationMs: number; depth: number }
  | { type: 'error';    nodeId: string; error: string; durationMs: number; depth: number }

type Wire = Map<string, unknown>
const wkey = (nodeId: string, portId: string) => `${nodeId}:${portId}`

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

// ── OpenAI ────────────────────────────────────────────────────────────────────

let _oai: OpenAI | undefined
const oai = () => (_oai ??= new OpenAI())

// ── flaky_op counter (test-only, resets per process) ─────────────────────────

let _flakyCallCount = 0

// ── Builtins ──────────────────────────────────────────────────────────────────

async function runBuiltin(nodeId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (nodeId) {
    case 'passthrough':
      return { value: inputs.value }

    case 'flaky_op': {
      const failTimes = Number(inputs.failTimes ?? 2)
      _flakyCallCount++
      if (_flakyCallCount <= failTimes)
        throw new Error(`flaky failure #${_flakyCallCount} of ${failTimes}`)
      return { result: `succeeded on attempt ${_flakyCallCount}` }
    }

    case 'split_lines': {
      const text = String(inputs.text ?? '')
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      return { result: { paths: lines }, count: lines.length }
    }

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

// ── Subgraph runners ──────────────────────────────────────────────────────────

async function runForEach(
  node: SerializedNode,
  inputs: Record<string, unknown>,
  pool: McpPool,
  onEvent: ((e: NodeEvent) => void) | undefined,
  depth: number,
): Promise<Record<string, unknown>> {
  const raw = inputs.items
  let items: unknown[]
  if (Array.isArray(raw)) {
    items = raw
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    items = Array.isArray(obj.items) ? obj.items
          : Array.isArray(obj.paths) ? obj.paths
          : Object.values(obj)
  } else {
    items = []
  }

  const context: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(inputs)) {
    if (k !== 'items') context[k] = v
  }

  const results: unknown[] = []
  for (const item of items) {
    const subOutputs = await executeSubgraph(node.subgraph!, { item, ...context }, pool, onEvent, depth + 1)
    results.push(subOutputs)
  }
  return { results }
}

async function runWhile(
  node: SerializedNode,
  inputs: Record<string, unknown>,
  pool: McpPool,
  onEvent: ((e: NodeEvent) => void) | undefined,
  depth: number,
): Promise<Record<string, unknown>> {
  const maxIter = node.constraints?.maxIterations ?? 10
  const indent = '  '.repeat(depth)
  let current = { ...inputs }
  let outputs: Record<string, unknown> = {}

  for (let i = 0; i < maxIter; i++) {
    console.log(`${indent}  ── pass ${i + 1}`)
    outputs = await executeSubgraph(node.subgraph!, current, pool, onEvent, depth + 1)
    const continuing = !!outputs.continue
    if (outputs.feedback) {
      const fb = String(outputs.feedback).replace(/\n/g, ' ').slice(0, 200)
      console.log(`${indent}  ── pass ${i + 1} done  continue=${continuing}  feedback: ${fb}`)
    } else {
      console.log(`${indent}  ── pass ${i + 1} done  continue=${continuing}`)
    }
    if (!continuing) break
    current = { ...inputs }
    for (const [k, v] of Object.entries(outputs)) {
      if (k !== 'continue') current[k] = v
    }
  }

  const { continue: _, ...rest } = outputs
  return rest
}

async function runRetry(
  node: SerializedNode,
  inputs: Record<string, unknown>,
  pool: McpPool,
  onEvent: ((e: NodeEvent) => void) | undefined,
  depth: number,
): Promise<Record<string, unknown>> {
  const maxRetries = node.constraints?.maxRetries ?? 3
  let lastError = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeSubgraph(node.subgraph!, inputs, pool, onEvent, depth + 1, true)
    } catch (err) {
      lastError = String(err)
    }
  }

  throw new Error(`Retry exhausted after ${maxRetries + 1} attempts: ${lastError}`)
}

// ── Graph execution ───────────────────────────────────────────────────────────

export async function executeSubgraph(
  graph: SerializedGraph,
  userInputs: Record<string, unknown>,
  pool: McpPool,
  onEvent?: (event: NodeEvent) => void,
  depth = 0,
  throwOnError = false,
): Promise<Record<string, unknown>> {
  const wire: Wire = new Map()

  const outEdges = new Map<string, Edge[]>()
  for (const node of graph.nodes) outEdges.set(node.id, [])
  for (const edge of graph.edges) outEdges.get(edge.from.nodeId)?.push(edge)

  const order = topologicalSort(graph.nodes.map(n => n.id), graph.edges)
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))

  const indent = '  '.repeat(depth)
  let finalOutputs: Record<string, unknown> = {}

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId)!

    if (nodeId !== '$input') {
      const missing = (node.inputs ?? [])
        .filter(p => !p.optional && !wire.has(wkey(nodeId, p.id)))
        .map(p => p.id)

      if (missing.length > 0) {
        console.log(`${indent}  ⚠ ${nodeId} — skipped (missing: ${missing.join(', ')})`)
        continue
      }
    }

    const inputs: Record<string, unknown> = nodeId === '$input'
      ? { ...userInputs }
      : Object.fromEntries((node.inputs ?? []).map(p => [p.id, wire.get(wkey(nodeId, p.id))]))

    const t0 = performance.now()
    let outputs: Record<string, unknown> | null = null

    onEvent?.({ type: 'start', nodeId, depth })

    try {
      if (nodeId === '$input') {
        outputs = userInputs
        if (depth === 0) console.log(`  ✓ $input       ${JSON.stringify(outputs)}`)
      } else if (nodeId === '$output') {
        outputs = inputs
        finalOutputs = inputs
        if (depth === 0) {
          console.log(`\n── $output ${'─'.repeat(40)}`)
          console.log(JSON.stringify(outputs, null, 2))
        }
      } else if (node.forEach && node.subgraph) {
        console.log(`${indent}  ↻ ${nodeId} (forEach)`)
        outputs = await runForEach(node, inputs, pool, onEvent, depth)
        console.log(`${indent}  ✓ ${nodeId} — ${(outputs.results as unknown[]).length} items`)
      } else if (node.loop && node.subgraph) {
        console.log(`${indent}  ↻ ${nodeId} (while)`)
        outputs = await runWhile(node, inputs, pool, onEvent, depth)
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (node.retry && node.subgraph) {
        console.log(`${indent}  ↻ ${nodeId} (retry)`)
        outputs = await runRetry(node, inputs, pool, onEvent, depth)
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (nodeId === 'plant') {
        console.log(`${indent}  ✦ ${nodeId} — designing graph for: "${inputs.task}"`)
        outputs = { graph: await plantGraph(String(inputs.task)) }
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (nodeId === 'execute_graph') {
        console.log(`${indent}  ▶ ${nodeId}`)
        const subGraph = inputs.graph as SerializedGraph
        const subInputs = (inputs.inputs ?? {}) as Record<string, unknown>
        const result = await executeSubgraph(subGraph, subInputs, pool, onEvent, depth + 1)
        outputs = { outputs: result }
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (nodeId.includes('__')) {
        const sep = nodeId.indexOf('__')
        const serverId = nodeId.slice(0, sep)
        const toolName = nodeId.slice(sep + 2)
        const result = await pool.callTool(serverId, toolName, autoBox(inputs.params))
        outputs = { result }
        console.log(`${indent}  ✓ ${nodeId}`)
      } else {
        outputs = await runBuiltin(nodeId, inputs)
        console.log(`${indent}  ✓ ${nodeId}`)
      }

      onEvent?.({ type: 'complete', nodeId, durationMs: performance.now() - t0, depth })
    } catch (err) {
      const error = String(err)
      console.log(`${indent}  ✗ ${nodeId} — ${error}`)
      onEvent?.({ type: 'error', nodeId, error, durationMs: performance.now() - t0, depth })
      if (throwOnError) throw err
    }

    if (outputs) {
      for (const edge of outEdges.get(nodeId) ?? []) {
        wire.set(wkey(edge.to.nodeId, edge.to.portId), outputs[edge.from.portId])
      }
    }
  }

  return finalOutputs
}
