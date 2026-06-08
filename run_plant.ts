import { config } from 'dotenv'
config({ path: '.env.local' })
import OpenAI from 'openai'
import { writeFileSync } from 'fs'
import { validateGraph } from './core/validator'
import type { ValidationError } from './core/validator'
import type { SerializedGraph } from './core/serializer'
import { loadMcpCatalog } from './lib/mcp-catalog'

let _client: OpenAI | undefined
const client = () => (_client ??= new OpenAI())

const BUILTIN_CATALOG = [
  {
    id: 'http_fetch',
    description: 'Fetch a URL over HTTP',
    inputs:  [{ id: 'url', type: 'string' }, { id: 'method', type: 'string', optional: true }],
    outputs: [{ id: 'body', type: 'string' }, { id: 'status', type: 'number' }],
  },
  {
    id: 'research_answer',
    description: 'Answer a question from provided content (LLM, gpt-4o-mini)',
    inputs:  [{ id: 'content', type: 'string' }, { id: 'question', type: 'string' }],
    outputs: [{ id: 'response', type: 'string' }],
  },
  {
    id: 'draft_writer',
    description: 'Write or improve a draft given a prompt and optional judge feedback (LLM, gpt-4o-mini)',
    inputs:  [{ id: 'prompt', type: 'string' }, { id: 'system', type: 'string', optional: true }, { id: 'draft', type: 'string', optional: true }, { id: 'feedback', type: 'string', optional: true }],
    outputs: [{ id: 'response', type: 'string' }],
  },
  {
    id: 'quality_judge',
    description: 'Evaluate a draft — outputs response, a boolean continue flag, and feedback string (LLM, gpt-4o)',
    inputs:  [{ id: 'prompt', type: 'string' }, { id: 'draft', type: 'string' }],
    outputs: [{ id: 'response', type: 'string' }, { id: 'continue', type: 'boolean' }, { id: 'feedback', type: 'string' }],
  },
  {
    id: 'memory_read',
    description: 'Read a value from persistent memory by key',
    inputs:  [{ id: 'key', type: 'string' }],
    outputs: [{ id: 'value', type: 'string' }, { id: 'found', type: 'boolean' }],
  },
  {
    id: 'memory_write',
    description: 'Write a key/value pair to persistent memory',
    inputs:  [{ id: 'key', type: 'string' }, { id: 'value', type: 'string' }],
    outputs: [{ id: 'key', type: 'string' }],
  },
  {
    id: 'passthrough',
    description: 'Pass a value through unchanged',
    inputs:  [{ id: 'value', type: 'any' }],
    outputs: [{ id: 'value', type: 'any' }],
  },
  {
    id: 'split_lines',
    description: 'Split newline-separated text into a paths array. Output "result" is {paths:[...]} — connect directly to an MCP params port.',
    inputs:  [{ id: 'text', type: 'string' }],
    outputs: [{ id: 'result', type: 'object' }, { id: 'count', type: 'number' }],
  },
]

const SYSTEM = `You are a graph compiler. Design execution graphs for AI agent workflows.

A graph is a JSON object:
{
  "nodes": [ ...SerializedNode ],
  "edges": [ ...Edge ]
}

SerializedNode shape:
{
  "id": string,           // unique within the graph
  "inputs":  Port[],
  "outputs": Port[],
  "sideEffects"?: string[],
  "constraints"?: { "offlineCapable"?: boolean, "maxIterations"?: number }
}

Port:  { "id": string, "type": "string"|"number"|"boolean"|"object"|"any"|"void", "optional"?: true }
Edge:  { "from": { "nodeId": string, "portId": string }, "to": { "nodeId": string, "portId": string } }

Required boundary nodes (always present):
- "$input"  — no incoming edges; its "outputs" array defines what the caller passes in
- "$output" — sink node; its "inputs" array defines the graph's final outputs

Hard rules:
1. Every required (non-optional) input port on every non-$input node must have exactly one incoming edge.
2. No port may receive more than one incoming edge.
3. Every edge nodeId and portId must exactly match an id on an existing node and an existing port on that node.
4. No cycles.

Available leaf nodes — use these ids exactly, and copy their port shapes faithfully:
CATALOG_PLACEHOLDER

Control-flow nodes (optional, for iteration):
You may embed a subgraph inside a node to create loops. Each subgraph is a full SerializedGraph with its own $input / $output boundary nodes.

ForEach node — runs the subgraph once per item in an array:
  Add "forEach": true to the node.
  The node's inputs must include { "id": "items", "type": "object" } (a JSON array or {paths:[...]} object).
  The subgraph's $input must expose { "id": "item", "type": "any" }; additional parent inputs are forwarded automatically.
  The node's outputs: [{ "id": "results", "type": "object" }] — an array of per-item result objects.
  Example shape:
  { "id": "process_each", "forEach": true,
    "inputs":  [{"id":"items","type":"object"}],
    "outputs": [{"id":"results","type":"object"}],
    "subgraph": {
      "nodes": [
        {"id":"$input","inputs":[],"outputs":[{"id":"item","type":"any"}]},
        ...leaf nodes...,
        {"id":"$output","inputs":[{"id":"result","type":"any"}],"outputs":[]}
      ],
      "edges": [...]
    }
  }

While node — runs the subgraph until $output.continue is false:
  Add "loop": true and "constraints": {"maxIterations": N} to the node.
  The subgraph's $output must include { "id": "continue", "type": "boolean" }.
  All other subgraph outputs feed back as the next iteration's $input (same port names).
  The while node's inputs / outputs mirror the initial-state / final-state ports.

Retry node — retries the subgraph on exception:
  Add "retry": true and "constraints": {"maxRetries": N} to the node.
  The subgraph is re-run up to maxRetries+1 times total; throws if all attempts fail.

Return ONLY valid JSON — no markdown fences, no explanation. The root object must be the SerializedGraph.`

function formatError(e: ValidationError): string {
  switch (e.type) {
    case 'unknown_node_ref':
      return `unknown_node_ref — edge[${e.edgeIndex}] ${e.side} references unknown node "${e.nodeId}"`
    case 'unknown_port_ref':
      return `unknown_port_ref — edge[${e.edgeIndex}] ${e.side} references unknown port "${e.portId}" on node "${e.nodeId}"`
    case 'type_mismatch':
      return `type_mismatch — ${e.fromNodeId}.${e.fromPortId} (${e.fromType}) → ${e.toNodeId}.${e.toPortId} (${e.toType})`
    case 'disconnected_input':
      return `disconnected_input — required port "${e.portId}" on node "${e.nodeId}" has no incoming edge`
    case 'multiple_inputs':
      return `multiple_inputs — port "${e.portId}" on node "${e.nodeId}" receives more than one edge`
    case 'cycle':
      return `cycle — ${e.nodeIds.join(' → ')}`
  }
}

async function callLLM(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
  const resp = await client().chat.completions.create({
    model: 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
  })
  return resp.choices[0].message.content ?? '{}'
}

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

  const mcpNodes = await loadMcpCatalog()
  const catalog = [...BUILTIN_CATALOG, ...mcpNodes]
  if (mcpNodes.length > 0)
    console.log(`[mcp] loaded ${mcpNodes.length} tool(s): ${mcpNodes.map(n => n.id).join(', ')}`)

  const catalogText = catalog.map(n =>
    `\n  id: "${n.id}"\n  description: ${n.description}\n  inputs:  ${JSON.stringify(n.inputs)}\n  outputs: ${JSON.stringify(n.outputs)}`
  ).join('\n')
  const system = SYSTEM.replace('CATALOG_PLACEHOLDER', catalogText)

  const maxPasses = 5
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user',   content: `Design a graph for this task:\n\n${task}` },
  ]

  let graph: SerializedGraph | null = null

  for (let pass = 1; pass <= maxPasses; pass++) {
    console.log(`\n── pass ${pass}/${maxPasses} ${'─'.repeat(50)}`)

    const raw = await callLLM(messages)

    let parsed: SerializedGraph
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.log('invalid JSON — retrying')
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: 'That was not valid JSON. Return only a JSON object with no markdown.' })
      continue
    }

    const errors = validateGraph(parsed)

    if (errors.length === 0) {
      console.log('✓ valid')
      graph = parsed
      break
    }

    console.log(`✗ ${errors.length} error(s):`)
    errors.forEach(e => console.log(`  ${formatError(e)}`))

    messages.push({ role: 'assistant', content: raw })
    messages.push({
      role: 'user',
      content: `The graph has ${errors.length} validation error(s). Fix all of them:\n${errors.map(e => `- ${formatError(e)}`).join('\n')}\n\nReturn the corrected SerializedGraph JSON.`,
    })
  }

  if (!graph) {
    console.error(`\n✗ failed to produce a valid graph in ${maxPasses} passes`)
    process.exit(1)
  }

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
