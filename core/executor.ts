// LEGACY EXECUTOR — runs deserialized ExecutionGraphs against a RuntimeRegistry.
//
// Kept because the registry/emitter pipeline depends on it: serialize/deserialize
// round-trips, the /run and /run/stream server routes, the CLI runners under
// node/graphs, and emit-parity tests for JS/Kotlin/Swift.
//
// The CANONICAL executor is lib/execute-engine.ts — it has the full control-flow
// set (forEach/while/retry/router/agent), MCP tools, builtins, and the meta nodes.
// Add new node types and execution semantics THERE, not here.

import OpenAI from 'openai'
import { IExecutionGraph, Port } from './types'
import { topologicalSort } from './topo'

function portToJsonSchema(port: Port): Record<string, any> {
  const map: Record<string, string> = {
    string: 'string', number: 'number', boolean: 'boolean', object: 'object',
    audio: 'string', image: 'string', void: 'null', any: 'string',
  }
  return { type: map[port.type] ?? 'string' }
}

export type NodeEvent =
  | { type: 'start';    nodeId: string; inputs: Record<string, any>; depth: number }
  | { type: 'complete'; nodeId: string; inputs: Record<string, any>; outputs: Record<string, any>; durationMs: number; depth: number }
  | { type: 'error';    nodeId: string; inputs: Record<string, any>; error: Error; durationMs: number; depth: number }

export type NodeHook = (event: NodeEvent) => void

function normaliseOutput(raw: any, portIds: string[]): Record<string, any> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw
  return { [portIds[0] ?? 'out']: raw }
}

async function executeGraph(
  graph: IExecutionGraph,
  seed: Map<string, any>,
  overrides: Record<string, Function>,
  onNode: NodeHook | undefined,
  depth: number
): Promise<Map<string, any>> {
  const nodeIds = topologicalSort([...graph.nodes.keys()], graph.edges)
    .filter(id => id !== '$input' && id !== '$output')

  // Each node gets a Promise for its output. Nodes with no shared data dependency
  // resolve their Promises concurrently — Promise.all fans them out automatically.
  const nodePromises = new Map<string, Promise<Record<string, any>>>()

  for (const nodeId of nodeIds) {
    const node = graph.nodes.get(nodeId)!

    const predecessors = [...new Set(
      graph.edges
        .filter(e => e.to.nodeId === nodeId && e.from.nodeId !== '$input')
        .map(e => e.from.nodeId)
    )]

    const nodePromise = (async () => {
      await Promise.all(predecessors.map(p => nodePromises.get(p)!))

      const inputs: Record<string, any> = {}
      for (const edge of graph.edges) {
        if (edge.to.nodeId !== nodeId) continue
        if (edge.from.nodeId === '$input') {
          inputs[edge.to.portId] = seed.get(`$input:${edge.from.portId}`)
        } else {
          const predOut = await nodePromises.get(edge.from.nodeId)!
          inputs[edge.to.portId] = predOut[edge.from.portId]
        }
      }

      const t0 = Date.now()
      onNode?.({ type: 'start', nodeId, inputs, depth })

      let output: Record<string, any> = {}

      try {

      if (node.agent && node.tools) {
        const maxTurns = node.constraints?.maxTurns ?? 10
        const toolDefs = node.tools

        const toolSchemas = toolDefs.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.id,
            description: tool.description ?? '',
            parameters: {
              type: 'object',
              properties: Object.fromEntries(
                tool.inputs.map(p => [p.id, portToJsonSchema(p)])
              ),
              required: tool.inputs.filter(p => !p.optional).map(p => p.id),
            },
          },
        }))

        const messages: OpenAI.ChatCompletionMessageParam[] = [
          ...(inputs.system ? [{ role: 'system' as const, content: String(inputs.system) }] : []),
          { role: 'user' as const, content: String(inputs.prompt) },
        ]

        const openai = new OpenAI()
        let response = ''

        for (let turn = 0; turn < maxTurns; turn++) {
          const completion = await openai.chat.completions.create({
            model: node.model ?? 'gpt-4o',
            messages,
            tools: toolSchemas,
            tool_choice: 'auto',
          })

          const msg = completion.choices[0].message
          messages.push(msg as OpenAI.ChatCompletionMessageParam)

          if (!msg.tool_calls?.length) {
            response = msg.content ?? ''
            break
          }

          const toolResults = await Promise.all(
            msg.tool_calls.filter(tc => tc.type === 'function').map(async tc => {
              const fn_name = (tc as any).function.name as string
              const fn_args = (tc as any).function.arguments as string
              const tool = toolDefs.find(t => t.id === fn_name)
              if (!tool) throw new Error(`Agent "${nodeId}": unknown tool "${fn_name}"`)
              const toolInputs = JSON.parse(fn_args)
              const fn = overrides[fn_name] ?? tool.run
              if (!fn) throw new Error(`No implementation for tool "${fn_name}"`)
              const raw = await fn(toolInputs)
              return { tool_call_id: tc.id, output: normaliseOutput(raw, tool.outputs.map(p => p.id)) }
            })
          )

          for (const { tool_call_id, output } of toolResults) {
            messages.push({ role: 'tool', tool_call_id, content: JSON.stringify(output) })
          }
        }

        output = { response }
      } else if (node.router && node.branches) {
        const key = String(inputs.condition)
        const branch = node.branches[key]
        if (!branch) throw new Error(`Router "${nodeId}": no branch "${key}"`)

        const branchSeed = new Map<string, any>()
        for (const port of node.inputs) {
          if (port.id === 'condition') continue
          branchSeed.set(`$input:${port.id}`, inputs[port.id])
        }

        const innerValues = await executeGraph(branch, branchSeed, overrides, onNode, depth + 1)

        for (const edge of branch.edges) {
          if (edge.to.nodeId !== '$output') continue
          output[edge.to.portId] = innerValues.get(`${edge.from.nodeId}:${edge.from.portId}`)
        }
      } else if (node.subgraph && node.loop) {
        const maxIter = node.constraints?.maxIterations ?? 10
        const loopSeed = new Map<string, any>()
        for (const port of node.inputs) {
          loopSeed.set(`$input:${port.id}`, inputs[port.id])
        }

        for (let i = 0; i < maxIter; i++) {
          const innerValues = await executeGraph(node.subgraph, new Map(loopSeed), overrides, onNode, depth + 1)

          output = {}
          for (const edge of node.subgraph.edges) {
            if (edge.to.nodeId !== '$output') continue
            output[edge.to.portId] = innerValues.get(`${edge.from.nodeId}:${edge.from.portId}`)
          }

          if (!output.continue) break

          for (const [key, val] of Object.entries(output)) {
            if (key === 'continue') continue
            loopSeed.set(`$input:${key}`, val)
          }
        }

        delete output.continue
      } else if (node.subgraph) {
        const innerSeed = new Map<string, any>()
        for (const port of node.inputs) {
          innerSeed.set(`$input:${port.id}`, inputs[port.id])
        }

        const innerValues = await executeGraph(node.subgraph, innerSeed, overrides, onNode, depth + 1)

        for (const edge of node.subgraph.edges) {
          if (edge.to.nodeId !== '$output') continue
          output[edge.to.portId] = innerValues.get(`${edge.from.nodeId}:${edge.from.portId}`)
        }
      } else {
        const fn = overrides[nodeId] ?? node.run
        if (!fn) throw new Error(`No runtime for node: ${nodeId}`)
        const raw = await fn(inputs)
        output = normaliseOutput(raw, node.outputs.map(p => p.id))
      }

      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        onNode?.({ type: 'error', nodeId, inputs, error, durationMs: Date.now() - t0, depth })
        throw error
      }

      onNode?.({ type: 'complete', nodeId, inputs, outputs: output, durationMs: Date.now() - t0, depth })
      return output
    })()

    nodePromises.set(nodeId, nodePromise)
  }

  await Promise.all([...nodePromises.values()])

  const values = new Map<string, any>(seed)
  for (const [nodeId, promise] of nodePromises) {
    const output = await promise
    const node = graph.nodes.get(nodeId)!
    for (const port of node.outputs) {
      values.set(`${nodeId}:${port.id}`, output[port.id])
    }
  }

  return values
}

export async function runGraph(
  graph: IExecutionGraph,
  overrides: Record<string, Function> = {},
  onNode?: NodeHook,
  inputs?: Record<string, any>
): Promise<Map<string, any>> {
  const seed = new Map<string, any>()
  if (inputs) {
    for (const [key, val] of Object.entries(inputs)) {
      seed.set(`$input:${key}`, val)
    }
  }
  return executeGraph(graph, seed, overrides, onNode, 0)
}
