import OpenAI from 'openai'
import { validateGraph } from '../core/validator'
import type { ValidationError } from '../core/validator'
import type { SerializedGraph } from '../core/serializer'
import { loadMcpCatalog } from './mcp-catalog'
import { listGraphs } from './graph-store'

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
    description: 'Evaluate a draft — outputs response, a boolean continue flag, and feedback string (LLM, gpt-4o). If testResults is provided, uses actual test pass/fail to inform the decision.',
    inputs:  [{ id: 'prompt', type: 'string' }, { id: 'draft', type: 'string' }, { id: 'testResults', type: 'string', optional: true }],
    outputs: [{ id: 'response', type: 'string' }, { id: 'continue', type: 'boolean' }, { id: 'feedback', type: 'string' }],
  },
  {
    id: 'run_js',
    description: 'Execute JavaScript code against an array of test cases. Detects the function name automatically. Returns pass/fail results and a human-readable summary. Use after draft_writer to verify generated code is correct.',
    inputs:  [{ id: 'code', type: 'string' }, { id: 'tests', type: 'object' }],
    outputs: [{ id: 'results', type: 'object' }, { id: 'allPassed', type: 'boolean' }, { id: 'summary', type: 'string' }],
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
  {
    id: 'flaky_op',
    description: 'Test node: throws an error on the first failTimes calls, then succeeds. Use inside a retry node to verify retry behavior.',
    inputs:  [{ id: 'failTimes', type: 'number' }],
    outputs: [{ id: 'result', type: 'string' }],
  },
  {
    id: 'plant_with_prompt',
    description: 'Test a candidate Plant system prompt by running it against a task. Returns whether a valid graph was produced and how many correction passes it needed. Lower passes = better prompt. Use in a self-improvement loop to evolve the Plant prompt.',
    inputs:  [{ id: 'task', type: 'string' }, { id: 'systemPrompt', type: 'string' }],
    outputs: [{ id: 'valid', type: 'boolean' }, { id: 'passes', type: 'number' }],
  },
  {
    id: 'plant',
    description: 'Design a new execution graph from a natural-language task description (LLM, GPT-4o). Output "graph" is a SerializedGraph object ready to pass to execute_graph.',
    inputs:  [{ id: 'task', type: 'string' }],
    outputs: [{ id: 'graph', type: 'object' }],
  },
  {
    id: 'execute_graph',
    description: 'Execute a SerializedGraph object at runtime. "inputs" is an optional object of input values. "outputs" is an object containing ALL of the subgraph\'s output values keyed by port name — use the pluck node to extract individual fields.',
    inputs:  [{ id: 'graph', type: 'object' }, { id: 'inputs', type: 'object', optional: true }],
    outputs: [{ id: 'outputs', type: 'object' }],
  },
  {
    id: 'pack',
    description: 'Build an object from up to 6 key/value pairs. Use to construct the inputs object for execute_graph when you need to pass individual port values as a named bundle. key1/value1 through key6/value6 — omit unused pairs.',
    inputs:  [
      { id: 'key1', type: 'string' }, { id: 'value1', type: 'any' },
      { id: 'key2', type: 'string', optional: true }, { id: 'value2', type: 'any', optional: true },
      { id: 'key3', type: 'string', optional: true }, { id: 'value3', type: 'any', optional: true },
      { id: 'key4', type: 'string', optional: true }, { id: 'value4', type: 'any', optional: true },
    ],
    outputs: [{ id: 'object', type: 'object' }],
  },
  {
    id: 'pluck',
    description: 'Extract a single field from an object by key. Use after execute_graph to pull a specific field out of execute_graph.outputs (e.g. pluck(execute_graph.outputs, "code") → value).',
    inputs:  [{ id: 'object', type: 'object' }, { id: 'key', type: 'string' }],
    outputs: [{ id: 'value', type: 'any' }],
  },
  {
    id: 'save_graph',
    description: 'Save a graph to the graph library by name. Use after plant or after a successful execution to persist a graph for reuse. Name must be alphanumeric with underscores/hyphens.',
    inputs:  [{ id: 'name', type: 'string' }, { id: 'graph', type: 'object' }],
    outputs: [{ id: 'name', type: 'string' }, { id: 'saved', type: 'boolean' }],
  },
  {
    id: 'load_graph',
    description: 'Load a previously saved graph from the graph library by name. Returns the graph object and a found flag. Pass the graph to execute_graph to run it.',
    inputs:  [{ id: 'name', type: 'string' }],
    outputs: [{ id: 'graph', type: 'object' }, { id: 'found', type: 'boolean' }],
  },
  {
    id: 'observe',
    description: 'Snapshot the current execution trace at this point in the graph. The executor injects the live event list automatically — no required inputs. Optional "trigger" input (any type) controls ordering: wire any upstream output to trigger to force observe to run after that node. Outputs a human-readable summary, counts, and the raw events array.',
    inputs:  [{ id: 'trigger', type: 'any', optional: true }],
    outputs: [{ id: 'summary', type: 'string' }, { id: 'nodeCount', type: 'number' }, { id: 'errorCount', type: 'number' }, { id: 'events', type: 'object' }],
  },
]

// Route and agent are not in BUILTIN_CATALOG — they are declared inline in the graph JSON.
// Plant needs their shapes documented in the system prompt instead.

const SYSTEM_TEMPLATE = `You are a graph compiler. Design execution graphs for AI agent workflows.

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

Available leaf nodes — copy their port shapes faithfully:
CATALOG_PLACEHOLDER

IMPORTANT: If you need multiple instances of the same catalog node (e.g. two draft_writer calls), give each a unique "id" but add "builtin": "<catalog-id>" so the executor knows which builtin to call. Example: { "id": "params_pack", "builtin": "pack", "inputs": [...], "outputs": [...] }. If you only need one instance, use the catalog id directly as the node id.

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
  All other subgraph outputs (except "continue") feed back as the next iteration's $input (same port names).
  IMPORTANT: any value you want fed back must use the same port name in both $input.outputs and $output.inputs.
  The while node's outputs must NOT include "continue" — runWhile strips it before returning.

  CRITICAL WIRING RULES for while loops (these mistakes cause silent bugs):
  1. The while node's outer inputs are context-only (e.g. prompt, system). Do NOT wire an outer input into a subgraph feedback port like "draft" — the subgraph feedback ports are populated by the subgraph's own $output on each iteration.
  2. The subgraph $output.draft must come from the node that actually produced the draft (e.g. draft_writer.response), NOT from a judge/evaluator node. The judge's "response" is evaluation text, not the draft itself.
  3. Every port you want to survive to the next iteration must appear in BOTH $input.outputs AND $output.inputs with the same name, and must have an edge wiring it into $output.

  Concrete example — a write/judge refinement loop:
  Outer node: { "id": "refine", "loop": true, "constraints": {"maxIterations": 5},
    "inputs":  [{"id":"prompt","type":"string"}],
    "outputs": [{"id":"draft","type":"string"}],
    "subgraph": {
      "nodes": [
        {"id":"$input","inputs":[],"outputs":[
          {"id":"prompt","type":"string"},
          {"id":"draft","type":"string","optional":true},
          {"id":"feedback","type":"string","optional":true}
        ]},
        {"id":"draft_writer","inputs":[{"id":"prompt","type":"string"},{"id":"draft","type":"string","optional":true},{"id":"feedback","type":"string","optional":true}],"outputs":[{"id":"response","type":"string"}]},
        {"id":"quality_judge","inputs":[{"id":"prompt","type":"string"},{"id":"draft","type":"string"}],"outputs":[{"id":"response","type":"string"},{"id":"continue","type":"boolean"},{"id":"feedback","type":"string"}]},
        {"id":"$output","inputs":[
          {"id":"draft","type":"string"},
          {"id":"feedback","type":"string"},
          {"id":"continue","type":"boolean"}
        ],"outputs":[]}
      ],
      "edges": [
        {"from":{"nodeId":"$input","portId":"prompt"},   "to":{"nodeId":"draft_writer","portId":"prompt"}},
        {"from":{"nodeId":"$input","portId":"draft"},    "to":{"nodeId":"draft_writer","portId":"draft"}},
        {"from":{"nodeId":"$input","portId":"feedback"}, "to":{"nodeId":"draft_writer","portId":"feedback"}},
        {"from":{"nodeId":"$input","portId":"prompt"},   "to":{"nodeId":"quality_judge","portId":"prompt"}},
        {"from":{"nodeId":"draft_writer","portId":"response"}, "to":{"nodeId":"quality_judge","portId":"draft"}},
        {"from":{"nodeId":"draft_writer","portId":"response"}, "to":{"nodeId":"$output","portId":"draft"}},
        {"from":{"nodeId":"quality_judge","portId":"continue"},"to":{"nodeId":"$output","portId":"continue"}},
        {"from":{"nodeId":"quality_judge","portId":"feedback"}, "to":{"nodeId":"$output","portId":"feedback"}}
      ]
    }
  }
  Note: draft_writer.response goes to BOTH quality_judge.draft AND $output.draft. quality_judge.feedback goes to $output.feedback so it feeds back to draft_writer.feedback next iteration.

Retry node — retries the subgraph on exception:
  Add "retry": true and "constraints": {"maxRetries": N} to the node.
  The subgraph is re-run up to maxRetries+1 times total; throws if all attempts fail.

Router node — runs one of several branch subgraphs based on a condition value:
  Add "router": true to the node. The node MUST have a required input port named "condition" (type "string").
  "branches" is a JSON object mapping string condition values to subgraph objects (same SerializedGraph shape).
  Include a "default" key as a fallback for unmatched conditions.
  All non-condition inputs are forwarded to the selected branch's $input.
  The router node's outputs must match the outputs of each branch's $output.
  Example shape:
  { "id": "decide", "router": true,
    "inputs":  [{"id":"condition","type":"string"}, {"id":"text","type":"string"}],
    "outputs": [{"id":"result","type":"string"}],
    "branches": {
      "short": {
        "nodes": [
          {"id":"$input","inputs":[],"outputs":[{"id":"condition","type":"string"},{"id":"text","type":"string"}]},
          {"id":"passthrough","inputs":[{"id":"value","type":"any"}],"outputs":[{"id":"value","type":"any"}]},
          {"id":"$output","inputs":[{"id":"result","type":"any"}],"outputs":[]}
        ],
        "edges": [
          {"from":{"nodeId":"$input","portId":"text"},"to":{"nodeId":"passthrough","portId":"value"}},
          {"from":{"nodeId":"passthrough","portId":"value"},"to":{"nodeId":"$output","portId":"result"}}
        ]
      },
      "default": { "nodes": [...], "edges": [...] }
    }
  }

Agent node — an LLM that autonomously calls tools until it produces a final answer:
  Add "agent": true and optionally "model": "gpt-4o-mini" (default) or "gpt-4o".
  Optionally add "constraints": {"maxTurns": N} (default 10).
  Required input port: "task" (type "string") — the natural-language instruction.
  Optional input port: "context" (type "string") — additional background.
  Output ports: "result" (type "string") — the agent's final answer; "steps" (type "object") — tool call log.
  The agent has access to: draft_writer, research_answer, http_fetch, run_js, memory_read, memory_write.
  Example shape:
  { "id": "researcher", "agent": true, "model": "gpt-4o-mini", "constraints": {"maxTurns": 5},
    "inputs":  [{"id":"task","type":"string"}, {"id":"context","type":"string","optional":true}],
    "outputs": [{"id":"result","type":"string"}, {"id":"steps","type":"object"}]
  }

Literal value nodes — use whenever you need a hardcoded constant string, number, or boolean as a port input. Any node with a "constraints.literal" field outputs { value: <that literal> } at runtime. Give each a unique id:
  { "id": "name_const", "inputs": [], "outputs": [{"id":"value","type":"string"}], "constraints": {"literal": "code_improve"} }
  { "id": "key_const",  "inputs": [], "outputs": [{"id":"value","type":"string"}], "constraints": {"literal": "code"} }
Use this for: graph names in load_graph, key names in pack/pluck, any fixed string that isn't a runtime input.

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

async function buildSystem(): Promise<string> {
  const mcpNodes = await loadMcpCatalog()
  const catalog = [...BUILTIN_CATALOG, ...mcpNodes]

  if (mcpNodes.length > 0)
    console.log(`[plant] loaded ${mcpNodes.length} MCP tool(s): ${mcpNodes.map(n => n.id).join(', ')}`)

  const savedGraphs = listGraphs()
  if (savedGraphs.length > 0)
    console.log(`[plant] graph library: ${savedGraphs.join(', ')}`)

  const catalogText = catalog.map(n =>
    `\n  id: "${n.id}"\n  description: ${n.description}\n  inputs:  ${JSON.stringify(n.inputs)}\n  outputs: ${JSON.stringify(n.outputs)}`
  ).join('\n')

  const librarySection = savedGraphs.length > 0
    ? `\n\nGraph library — reusable saved graphs (load with load_graph, run with execute_graph):\n${savedGraphs.map(n => `  - "${n}"`).join('\n')}`
    : ''

  return SYSTEM_TEMPLATE.replace('CATALOG_PLACEHOLDER', catalogText) + librarySection
}

export async function buildCatalogSection(): Promise<string> {
  const mcpNodes = await loadMcpCatalog()
  const catalog = [...BUILTIN_CATALOG, ...mcpNodes]
  const catalogText = catalog.map(n =>
    `\n  id: "${n.id}"\n  description: ${n.description}\n  inputs:  ${JSON.stringify(n.inputs)}\n  outputs: ${JSON.stringify(n.outputs)}`
  ).join('\n')
  const savedGraphs = listGraphs()
  const librarySection = savedGraphs.length > 0
    ? `\n\nGraph library:\n${savedGraphs.map(n => `  - "${n}"`).join('\n')}`
    : ''
  return `Available leaf nodes (use these ids exactly):\n${catalogText}${librarySection}`
}

export async function plantGraphTracked(
  task: string,
  maxPasses = 5,
  systemOverride?: string,
): Promise<{ graph: SerializedGraph; passes: number }> {
  const system = systemOverride ?? await buildSystem()

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user',   content: `Design a graph for this task:\n\n${task}` },
  ]

  for (let pass = 1; pass <= maxPasses; pass++) {
    console.log(`\n── plant pass ${pass}/${maxPasses} ${'─'.repeat(40)}`)

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
      return { graph: parsed, passes: pass }
    }

    console.log(`✗ ${errors.length} error(s):`)
    errors.forEach(e => console.log(`  ${formatError(e)}`))

    messages.push({ role: 'assistant', content: raw })
    messages.push({
      role: 'user',
      content: `The graph has ${errors.length} validation error(s). Fix all of them:\n${errors.map(e => `- ${formatError(e)}`).join('\n')}\n\nReturn the corrected SerializedGraph JSON.`,
    })
  }

  throw new Error(`Failed to produce a valid graph in ${maxPasses} passes`)
}

export async function plantGraph(task: string, maxPasses = 5): Promise<SerializedGraph> {
  const { graph } = await plantGraphTracked(task, maxPasses)
  return graph
}
