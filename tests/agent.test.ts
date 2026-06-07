import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  },
}))

import { ExecutionGraph } from '../core/graph'
import { runGraph } from '../core/executor'
import { serialize, deserialize, validateRegistry } from '../core/serializer'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import { emitGraphKotlin } from '../emitters/android/emitKotlin'
import type { SerializedGraph } from '../core/serializer'
import toolAgentData from '../node/graphs/ToolAgent.graph.json'

// ── Helpers ──────────────────────────────────────────────────────────────────

function finalMsg(content: string) {
  return { choices: [{ message: { role: 'assistant', content, tool_calls: null } }] }
}

function toolCallMsg(calls: Array<{ id: string; name: string; args: Record<string, any> }>) {
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: calls.map(c => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      },
    }],
  }
}

function makeAgentGraph(tools: any[] = []) {
  const fetchTool = {
    id: 'mock_fetch',
    description: 'fetch a thing',
    inputs:  [{ id: 'url', type: 'string' as const }],
    outputs: [{ id: 'body', type: 'string' as const }],
    run: vi.fn().mockResolvedValue({ body: 'page content' }),
  }
  const allTools = tools.length ? tools : [fetchTool]

  const g = new ExecutionGraph()
  g.addNode({ id: '$input', inputs: [], outputs: [{ id: 'prompt', type: 'string' }] })
  g.addNode({
    id: 'agent',
    agent: true,
    inputs:  [{ id: 'prompt', type: 'string' }],
    outputs: [{ id: 'response', type: 'string' }],
    constraints: { maxTurns: 5 },
    tools: allTools,
  })
  g.addNode({ id: '$output', inputs: [{ id: 'response', type: 'string' }], outputs: [] })
  g.addEdge({ from: { nodeId: '$input', portId: 'prompt'   }, to: { nodeId: 'agent',   portId: 'prompt'   } })
  g.addEdge({ from: { nodeId: 'agent',  portId: 'response' }, to: { nodeId: '$output', portId: 'response' } })

  return { g, fetchTool: allTools[0] }
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { mockCreate.mockReset() })

describe('agent node execution', () => {
  it('returns final response when LLM needs no tools', async () => {
    mockCreate.mockResolvedValueOnce(finalMsg('42'))

    const { g } = makeAgentGraph()
    const values = await runGraph(g, {}, undefined, { prompt: 'What is 6×7?' })

    expect(values.get('agent:response')).toBe('42')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('calls a tool then returns final answer on second turn', async () => {
    const { g, fetchTool } = makeAgentGraph()

    mockCreate
      .mockResolvedValueOnce(toolCallMsg([{ id: 'c1', name: 'mock_fetch', args: { url: 'https://example.com' } }]))
      .mockResolvedValueOnce(finalMsg('The page says: page content'))

    const values = await runGraph(g, {}, undefined, { prompt: 'What is on example.com?' })

    expect(fetchTool.run).toHaveBeenCalledWith({ url: 'https://example.com' })
    expect(values.get('agent:response')).toBe('The page says: page content')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('handles multiple tool calls in a single turn (parallel)', async () => {
    const toolA = { id: 'tool_a', description: '', inputs: [{ id: 'x', type: 'string' as const }], outputs: [{ id: 'v', type: 'string' as const }], run: vi.fn().mockResolvedValue({ v: 'A' }) }
    const toolB = { id: 'tool_b', description: '', inputs: [{ id: 'x', type: 'string' as const }], outputs: [{ id: 'v', type: 'string' as const }], run: vi.fn().mockResolvedValue({ v: 'B' }) }

    const { g } = makeAgentGraph([toolA, toolB])

    mockCreate
      .mockResolvedValueOnce(toolCallMsg([
        { id: 'c1', name: 'tool_a', args: { x: '1' } },
        { id: 'c2', name: 'tool_b', args: { x: '2' } },
      ]))
      .mockResolvedValueOnce(finalMsg('got A and B'))

    const values = await runGraph(g, {}, undefined, { prompt: 'run both' })

    expect(toolA.run).toHaveBeenCalledWith({ x: '1' })
    expect(toolB.run).toHaveBeenCalledWith({ x: '2' })
    expect(values.get('agent:response')).toBe('got A and B')
  })

  it('respects maxTurns ceiling', async () => {
    // always returns a tool call — should stop after maxTurns
    mockCreate.mockResolvedValue(
      toolCallMsg([{ id: 'c1', name: 'mock_fetch', args: { url: 'https://x.com' } }])
    )

    const { g } = makeAgentGraph()
    const values = await runGraph(g, {}, undefined, { prompt: 'loop forever' })

    expect(mockCreate).toHaveBeenCalledTimes(5)  // maxTurns = 5
    expect(values.get('agent:response')).toBe('')  // never got a final answer
  })

  it('overrides take precedence over tool.run', async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallMsg([{ id: 'c1', name: 'mock_fetch', args: { url: 'https://x.com' } }]))
      .mockResolvedValueOnce(finalMsg('override was called'))

    const { g, fetchTool } = makeAgentGraph()
    const overrideFn = vi.fn().mockResolvedValue({ body: 'overridden' })

    await runGraph(g, { mock_fetch: overrideFn }, undefined, { prompt: 'test' })

    expect(overrideFn).toHaveBeenCalled()
    expect(fetchTool.run).not.toHaveBeenCalled()
  })

  it('throws on call to unknown tool', async () => {
    mockCreate.mockResolvedValueOnce(
      toolCallMsg([{ id: 'c1', name: 'nonexistent_tool', args: {} }])
    )

    const { g } = makeAgentGraph()
    await expect(runGraph(g, {}, undefined, { prompt: 'use unknown tool' }))
      .rejects.toThrow('unknown tool "nonexistent_tool"')
  })
})

describe('agent serialization round-trip', () => {
  it('serialize → deserialize preserves tool contracts', () => {
    const { g } = makeAgentGraph()
    const serialized = serialize(g)
    const agentNode = serialized.nodes.find(n => n.id === 'agent')!

    expect(agentNode.agent).toBe(true)
    expect(agentNode.tools).toHaveLength(1)
    expect(agentNode.tools![0].id).toBe('mock_fetch')
    expect((agentNode.tools![0] as any).run).toBeUndefined()
  })

  it('deserialize wires tool run functions from registry', async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallMsg([{ id: 'c1', name: 'mock_fetch', args: { url: 'https://x.com' } }]))
      .mockResolvedValueOnce(finalMsg('done'))

    const { g } = makeAgentGraph()
    const serialized = serialize(g)

    const implFn = vi.fn().mockResolvedValue({ body: 'impl body' })
    const restored = deserialize(serialized, { mock_fetch: implFn })
    await runGraph(restored, {}, undefined, { prompt: 'go' })

    expect(implFn).toHaveBeenCalledWith({ url: 'https://x.com' })
  })
})

describe('ToolAgent graph registry', () => {
  it('requires http_fetch, memory_read, memory_write', () => {
    const missing = validateRegistry(toolAgentData as SerializedGraph, {})
    expect(missing).toContain('http_fetch')
    expect(missing).toContain('memory_read')
    expect(missing).toContain('memory_write')
  })

  it('validates cleanly when all tools are registered', () => {
    const stub = async () => ({})
    const missing = validateRegistry(toolAgentData as SerializedGraph, {
      http_fetch: stub, memory_read: stub, memory_write: stub,
    })
    expect(missing).toHaveLength(0)
  })
})

describe('emitter stubs for agent nodes', () => {
  it('JS emitter emits agent stub with throw', () => {
    const { g } = makeAgentGraph()
    const files = emitGraphJS(serialize(g))
    const src = Object.values(files).join('\n')
    expect(src).toContain('agent nodes must be run via the fractal executor')
  })

  it('Kotlin emitter emits agent stub with throw', () => {
    const { g } = makeAgentGraph()
    const files = emitGraphKotlin(serialize(g))
    const src = Object.values(files).join('\n')
    expect(src).toContain('agent nodes must be run via the fractal executor')
  })
})
