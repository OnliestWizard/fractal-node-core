import OpenAI from 'openai'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { topologicalSort } from '../core/topo'
import type { SerializedGraph, SerializedNode } from '../core/serializer'
import type { Edge } from '../core/types'
import { McpPool } from './mcp-pool'
import { plantGraph, plantGraphTracked, buildCatalogSection } from './plant'
import { saveGraph, loadGraph } from './graph-store'

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
      const testSection = inputs.testResults
        ? `\n\nTest Results:\n${inputs.testResults}\n\nIf all tests pass, set continue=false unless there is a critical correctness issue.`
        : ''
      const res = await oai().chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Evaluate the draft. Return JSON: { response: string, continue: boolean, feedback: string }. Set continue=true if revision is needed.' },
          { role: 'user', content: `Prompt: ${inputs.prompt}\n\nDraft:\n${inputs.draft}${testSection}` },
        ],
      })
      const p = JSON.parse(res.choices[0].message.content ?? '{}')
      return { response: p.response ?? '', continue: p.continue ?? false, feedback: p.feedback ?? '' }
    }

    case 'run_js': {
      const { runInNewContext } = await import('vm')
      const cleanCode = String(inputs.code ?? '')
        .replace(/^```(?:javascript|js)?\s*/m, '')
        .replace(/\n?```\s*$/, '')
        .trim()
      const tests = Array.isArray(inputs.tests)
        ? inputs.tests as Array<{ args: unknown[]; expected: unknown }>
        : []

      const fnNameMatch =
        cleanCode.match(/function\s+(\w+)\s*\(/) ||
        cleanCode.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\()/)
      const fnName = fnNameMatch?.[1]

      if (!fnName) {
        return { results: [], allPassed: false, summary: 'Could not detect function name from code' }
      }

      const results: Array<Record<string, unknown>> = []
      for (const test of tests) {
        const args = Array.isArray(test.args) ? test.args : [test.args]
        const expectError = !!(test as Record<string, unknown>).expectError
        try {
          const ctx: Record<string, unknown> = {}
          runInNewContext(
            `${cleanCode}\nvar __fn__ = typeof ${fnName} !== 'undefined' ? ${fnName} : undefined;`,
            ctx,
            { timeout: 5000 }
          )
          const fn = ctx['__fn__']
          if (typeof fn !== 'function') {
            results.push({ args, expected: test.expected, actual: null, passed: false, error: `"${fnName}" not found` })
            continue
          }
          const actual = (fn as (...a: unknown[]) => unknown)(...args)
          if (expectError) {
            results.push({ args, expected: 'throws', actual, passed: false, error: 'expected an error but got a result' })
          } else {
            const passed = JSON.stringify(actual) === JSON.stringify(test.expected)
            results.push({ args, expected: test.expected, actual, passed })
          }
        } catch (e) {
          if (expectError) {
            results.push({ args, expected: 'throws', actual: String(e), passed: true })
          } else {
            results.push({ args, expected: test.expected, actual: null, passed: false, error: String(e) })
          }
        }
      }

      const passCount = results.filter(r => r.passed).length
      const allPassed = tests.length > 0 && passCount === tests.length
      const failLines = results
        .filter(r => !r.passed)
        .map(r => `  FAIL: args=${JSON.stringify(r.args)} expected=${JSON.stringify(r.expected)} got=${JSON.stringify(r.actual)}${r.error ? ` [${r.error}]` : ''}`)
      const summary = `${passCount}/${tests.length} tests passed` + (failLines.length ? '\n' + failLines.join('\n') : '')

      return { results, allPassed, summary }
    }

    case 'pack': {
      const obj: Record<string, unknown> = {}
      for (let i = 1; i <= 6; i++) {
        const k = inputs[`key${i}`]
        if (k !== undefined && k !== null && k !== '') obj[String(k)] = inputs[`value${i}`]
      }
      return { object: obj }
    }

    case 'pluck': {
      const obj = (inputs.object ?? {}) as Record<string, unknown>
      return { value: obj[String(inputs.key ?? '')] }
    }

    case 'combine_results': {
      const valid = inputs.valid
      const passes = Number(inputs.passes ?? 0)
      return { combined: `valid=${valid}, passes=${passes}` }
    }

    case 'save_graph': {
      const name = String(inputs.name ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
      saveGraph(name, inputs.graph as SerializedGraph)
      return { name, saved: true }
    }

    case 'load_graph': {
      const name = String(inputs.name ?? '')
      const { graph, found } = loadGraph(name)
      return { graph: graph ?? {}, found }
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
  parentEvents?: NodeEvent[],
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
    const subOutputs = await executeSubgraph(node.subgraph!, { item, ...context }, pool, onEvent, depth + 1, false, parentEvents)
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
  parentEvents?: NodeEvent[],
): Promise<Record<string, unknown>> {
  const maxIter = node.constraints?.maxIterations ?? 10
  const indent = '  '.repeat(depth)
  let current = { ...inputs }
  let outputs: Record<string, unknown> = {}

  for (let i = 0; i < maxIter; i++) {
    console.log(`${indent}  ── pass ${i + 1}`)
    outputs = await executeSubgraph(node.subgraph!, current, pool, onEvent, depth + 1, false, parentEvents)
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
  parentEvents?: NodeEvent[],
): Promise<Record<string, unknown>> {
  const maxRetries = node.constraints?.maxRetries ?? 3
  let lastError = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeSubgraph(node.subgraph!, inputs, pool, onEvent, depth + 1, true, parentEvents)
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
  parentEvents?: NodeEvent[],
): Promise<Record<string, unknown>> {
  const wire: Wire = new Map()
  const localEvents: NodeEvent[] = []

  const emit = (e: NodeEvent) => {
    localEvents.push(e)
    parentEvents?.push(e)
    onEvent?.(e)
  }

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

    emit({ type: 'start', nodeId, depth })

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
      } else if (node.constraints && 'literal' in node.constraints) {
        outputs = { value: node.constraints.literal }
        console.log(`${indent}  ✓ ${nodeId} = ${JSON.stringify(node.constraints.literal)}`)
      } else if (node.forEach && node.subgraph) {
        console.log(`${indent}  ↻ ${nodeId} (forEach)`)
        outputs = await runForEach(node, inputs, pool, onEvent, depth, localEvents)
        console.log(`${indent}  ✓ ${nodeId} — ${(outputs.results as unknown[]).length} items`)
      } else if (node.loop && node.subgraph) {
        console.log(`${indent}  ↻ ${nodeId} (while)`)
        outputs = await runWhile(node, inputs, pool, onEvent, depth, localEvents)
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (node.retry && node.subgraph) {
        console.log(`${indent}  ↻ ${nodeId} (retry)`)
        outputs = await runRetry(node, inputs, pool, onEvent, depth, localEvents)
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (nodeId === 'plant') {
        console.log(`${indent}  ✦ ${nodeId} — designing graph for: "${inputs.task}"`)
        outputs = { graph: await plantGraph(String(inputs.task)) }
        console.log(`${indent}  ✓ ${nodeId}`)
      } else if (nodeId === 'plant_with_prompt') {
        const task = String(inputs.task ?? '')
        const candidateInstructions = String(inputs.systemPrompt ?? '')
        console.log(`${indent}  ✦ plant_with_prompt — testing prompt on: "${task.slice(0, 60)}..."`)
        let passes = 0
        let valid = false
        try {
          const catalogSection = await buildCatalogSection()
          const fullSystem = candidateInstructions + '\n\n' + catalogSection
          const result = await plantGraphTracked(task, 5, fullSystem)
          passes = result.passes
          valid = true
        } catch {}
        outputs = { valid, passes }
        console.log(`${indent}  ✓ plant_with_prompt — valid=${valid} passes=${passes}`)
      } else if (nodeId === 'observe') {
        const completed = localEvents.filter(e => e.type === 'complete').map(e => e.nodeId)
        const errors    = localEvents.filter((e): e is NodeEvent & { type: 'error'; error: string } => e.type === 'error')
        const nodeCount  = completed.length
        const errorCount = errors.length
        const summary    = [
          `Nodes completed: ${nodeCount}${completed.length ? ` (${completed.join(', ')})` : ''}`,
          errorCount > 0
            ? `Errors: ${errors.map(e => `${e.nodeId}: ${e.error}`).join('; ')}`
            : 'No errors so far',
        ].join('. ')
        outputs = { summary, nodeCount, errorCount, events: localEvents }
        console.log(`${indent}  👁 observe — ${nodeCount} completed, ${errorCount} errors`)
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

      emit({ type: 'complete', nodeId, durationMs: performance.now() - t0, depth })
    } catch (err) {
      const error = String(err)
      console.log(`${indent}  ✗ ${nodeId} — ${error}`)
      emit({ type: 'error', nodeId, error, durationMs: performance.now() - t0, depth })
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
