import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeSubgraph } from '../lib/execute-engine'
import type { NodeEvent } from '../lib/execute-engine'
import type { SerializedGraph, SerializedNode } from '../core/serializer'
import type { Edge, Port } from '../core/types'
import type { McpPool } from '../lib/mcp-pool'

// ── Test helpers ──────────────────────────────────────────────────────────────

const p = (id: string, optional?: boolean): Port =>
  optional ? { id, type: 'any', optional: true } : { id, type: 'any' }

const node = (id: string, partial: Partial<SerializedNode> = {}): SerializedNode => ({
  id,
  inputs: [],
  outputs: [],
  ...partial,
})

// edge('a.x', 'b.y') → { from: { nodeId: 'a', portId: 'x' }, to: { nodeId: 'b', portId: 'y' } }
const edge = (from: string, to: string): Edge => {
  const [fn, fp] = from.split('.')
  const [tn, tp] = to.split('.')
  return { from: { nodeId: fn, portId: fp }, to: { nodeId: tn, portId: tp } }
}

type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>

// Fake MCP pool — handlers keyed by "serverId__toolName"
function fakePool(handlers: Record<string, ToolHandler> = {}): McpPool {
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => [],
    callTool: async (serverId: string, toolName: string, args: Record<string, unknown>) => {
      const handler = handlers[`${serverId}__${toolName}`]
      if (!handler) throw new Error(`No fake handler for ${serverId}__${toolName}`)
      return handler(args)
    },
  } as unknown as McpPool
}

const run = (
  graph: SerializedGraph,
  inputs: Record<string, unknown>,
  pool = fakePool(),
  onEvent?: (e: NodeEvent) => void,
  throwOnError = false,
  allowedTools?: string[],
) => executeSubgraph(graph, inputs, pool, onEvent, 0, throwOnError, undefined, allowedTools)

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Wiring & dispatch ─────────────────────────────────────────────────────────

describe('wire propagation', () => {
  it('runs a linear chain and returns $output values', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value')] }),
      ],
      edges: [edge('$input.value', 'passthrough.value'), edge('passthrough.value', '$output.value')],
    }
    expect(await run(graph, { value: 'hello' })).toEqual({ value: 'hello' })
  })

  it('fans one output out to multiple consumers', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('a', { builtin: 'passthrough', inputs: [p('value')], outputs: [p('value')] }),
        node('b', { builtin: 'passthrough', inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('a'), p('b')] }),
      ],
      edges: [
        edge('$input.value', 'a.value'),
        edge('$input.value', 'b.value'),
        edge('a.value', '$output.a'),
        edge('b.value', '$output.b'),
      ],
    }
    expect(await run(graph, { value: 7 })).toEqual({ a: 7, b: 7 })
  })

  it('dispatches via the builtin field when a node is renamed', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('my_renamed_node', { builtin: 'split_lines', inputs: [p('text')], outputs: [p('result'), p('count')] }),
        node('$output', { inputs: [p('count')] }),
      ],
      edges: [edge('$input.text', 'my_renamed_node.text'), edge('my_renamed_node.count', '$output.count')],
    }
    expect(await run(graph, { text: 'a\nb\nc' })).toEqual({ count: 3 })
  })

  it('routes a renamed MCP node to the pool via the builtin field', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('renamed_mcp_call', { builtin: 'mock__echo', inputs: [p('params')], outputs: [p('result')] }),
        node('$output', { inputs: [p('result')] }),
      ],
      edges: [edge('$input.params', 'renamed_mcp_call.params'), edge('renamed_mcp_call.result', '$output.result')],
    }
    const pool = fakePool({ mock__echo: args => args })
    expect(await run(graph, { params: { a: 1 } }, pool)).toEqual({ result: { a: 1 } })
  })
})

// ── Builtins ──────────────────────────────────────────────────────────────────

describe('builtins', () => {
  it('literal nodes emit their constant', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('name_const', { outputs: [p('value')], constraints: { literal: 'code_improve' } }),
        node('$output', { inputs: [p('name')] }),
      ],
      edges: [edge('name_const.value', '$output.name')],
    }
    expect(await run(graph, {})).toEqual({ name: 'code_improve' })
  })

  it('pack builds an object from key/value pairs and skips empty keys', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('pack', {
          inputs: [p('key1'), p('value1'), p('key2'), p('value2'), p('key3', true), p('value3', true)],
          outputs: [p('object')],
        }),
        node('$output', { inputs: [p('object')] }),
      ],
      edges: [
        edge('$input.key1', 'pack.key1'),
        edge('$input.value1', 'pack.value1'),
        edge('$input.key2', 'pack.key2'),
        edge('$input.value2', 'pack.value2'),
        edge('pack.object', '$output.object'),
      ],
    }
    const out = await run(graph, { key1: 'a', value1: 1, key2: 'b', value2: 2 })
    expect(out).toEqual({ object: { a: 1, b: 2 } })
  })

  it('pluck extracts a field from an object', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('pluck', { inputs: [p('object'), p('key')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value')] }),
      ],
      edges: [
        edge('$input.object', 'pluck.object'),
        edge('$input.key', 'pluck.key'),
        edge('pluck.value', '$output.value'),
      ],
    }
    expect(await run(graph, { object: { x: 42 }, key: 'x' })).toEqual({ value: 42 })
  })

  it('split_lines splits, trims, and filters empty lines into { paths }', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('split_lines', { inputs: [p('text')], outputs: [p('result'), p('count')] }),
        node('$output', { inputs: [p('result'), p('count')] }),
      ],
      edges: [
        edge('$input.text', 'split_lines.text'),
        edge('split_lines.result', '$output.result'),
        edge('split_lines.count', '$output.count'),
      ],
    }
    const out = await run(graph, { text: ' a/1 \n\n b/2 \n' })
    expect(out).toEqual({ result: { paths: ['a/1', 'b/2'] }, count: 2 })
  })

  it('combine_results formats valid + passes', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('combine_results', { inputs: [p('valid'), p('passes')], outputs: [p('combined')] }),
        node('$output', { inputs: [p('combined')] }),
      ],
      edges: [
        edge('$input.valid', 'combine_results.valid'),
        edge('$input.passes', 'combine_results.passes'),
        edge('combine_results.combined', '$output.combined'),
      ],
    }
    expect(await run(graph, { valid: true, passes: 1 })).toEqual({ combined: 'valid=true, passes=1' })
  })
})

// ── run_js ────────────────────────────────────────────────────────────────────

describe('run_js', () => {
  const graph: SerializedGraph = {
    nodes: [
      node('$input'),
      node('run_js', { inputs: [p('code'), p('tests')], outputs: [p('results'), p('allPassed'), p('summary')] }),
      node('$output', { inputs: [p('allPassed'), p('summary')] }),
    ],
    edges: [
      edge('$input.code', 'run_js.code'),
      edge('$input.tests', 'run_js.tests'),
      edge('run_js.allPassed', '$output.allPassed'),
      edge('run_js.summary', '$output.summary'),
    ],
  }

  it('passes when code satisfies all tests', async () => {
    const out = await run(graph, {
      code: 'function add(a, b) { return a + b }',
      tests: [{ args: [1, 2], expected: 3 }, { args: [0, 0], expected: 0 }],
    })
    expect(out.allPassed).toBe(true)
    expect(out.summary).toContain('2/2 tests passed')
  })

  it('fails with FAIL lines when output mismatches', async () => {
    const out = await run(graph, {
      code: 'function add(a, b) { return a - b }',
      tests: [{ args: [1, 2], expected: 3 }],
    })
    expect(out.allPassed).toBe(false)
    expect(out.summary).toContain('FAIL')
  })

  it('strips markdown fences and detects const arrow functions', async () => {
    const out = await run(graph, {
      code: '```js\nconst double = (n) => n * 2\n```',
      tests: [{ args: [4], expected: 8 }],
    })
    expect(out.allPassed).toBe(true)
  })

  it('expectError passes only when the call throws', async () => {
    const code = 'function strict(n) { if (typeof n !== "number") throw new Error("bad"); return n }'
    const throws = await run(graph, { code, tests: [{ args: ['x'], expected: null, expectError: true }] })
    expect(throws.allPassed).toBe(true)

    const noThrow = await run(graph, { code, tests: [{ args: [1], expected: null, expectError: true }] })
    expect(noThrow.allPassed).toBe(false)
  })

  it('reports failure when no function name is detectable', async () => {
    const out = await run(graph, { code: '1 + 1', tests: [{ args: [], expected: 2 }] })
    expect(out.allPassed).toBe(false)
    expect(out.summary).toContain('Could not detect function name')
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('error isolation', () => {
  const graph: SerializedGraph = {
    nodes: [
      node('$input'),
      node('boom', { builtin: 'no_such_builtin', inputs: [p('value')], outputs: [p('value')] }),
      node('$output', { inputs: [p('value')] }),
    ],
    edges: [edge('$input.value', 'boom.value'), edge('boom.value', '$output.value')],
  }

  it('emits an error event and skips dependents instead of throwing', async () => {
    const events: NodeEvent[] = []
    const out = await run(graph, { value: 1 }, fakePool(), e => events.push(e))
    expect(out).toEqual({})
    expect(events.some(e => e.type === 'error' && e.nodeId === 'boom')).toBe(true)
    // $output never ran — its input was missing
    expect(events.some(e => e.type === 'complete' && e.nodeId === '$output')).toBe(false)
  })

  it('throws when throwOnError is true', async () => {
    await expect(run(graph, { value: 1 }, fakePool(), undefined, true)).rejects.toThrow('no_such_builtin')
  })

  it('skips nodes with unwired required inputs without erroring', async () => {
    const orphaned: SerializedGraph = {
      nodes: [
        node('$input'),
        node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value')] }),
      ],
      edges: [edge('passthrough.value', '$output.value')], // nothing feeds passthrough
    }
    const events: NodeEvent[] = []
    const out = await run(orphaned, { value: 'ignored' }, fakePool(), e => events.push(e))
    expect(out).toEqual({})
    expect(events.some(e => e.type === 'error')).toBe(false)
  })
})

// ── MCP nodes & auto-boxing ───────────────────────────────────────────────────

describe('MCP dispatch and auto-boxing', () => {
  const echoGraph: SerializedGraph = {
    nodes: [
      node('$input'),
      node('mock__echo', { inputs: [p('params')], outputs: [p('result')] }),
      node('$output', { inputs: [p('result')] }),
    ],
    edges: [edge('$input.params', 'mock__echo.params'), edge('mock__echo.result', '$output.result')],
  }
  const echoPool = () => fakePool({ mock__echo: args => args })

  it('passes objects through unchanged', async () => {
    const out = await run(echoGraph, { params: { a: 1 } }, echoPool())
    expect(out).toEqual({ result: { a: 1 } })
  })

  it('parses JSON strings', async () => {
    const out = await run(echoGraph, { params: '{"a":1}' }, echoPool())
    expect(out).toEqual({ result: { a: 1 } })
  })

  it('boxes newline-separated paths as { paths }', async () => {
    const out = await run(echoGraph, { params: 'C:/one.txt\nC:/two.txt' }, echoPool())
    expect(out).toEqual({ result: { paths: ['C:/one.txt', 'C:/two.txt'] } })
  })

  it('boxes plain values as { value }', async () => {
    const out = await run(echoGraph, { params: 'hello' }, echoPool())
    expect(out).toEqual({ result: { value: 'hello' } })
  })
})

// ── forEach ───────────────────────────────────────────────────────────────────

describe('forEach', () => {
  const forEachNode = node('each', {
    forEach: true,
    inputs: [p('items'), p('extra', true)],
    outputs: [p('results')],
    subgraph: {
      nodes: [
        node('$input'),
        node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value'), p('extra')] }),
      ],
      edges: [
        edge('$input.item', 'passthrough.value'),
        edge('passthrough.value', '$output.value'),
        edge('$input.extra', '$output.extra'),
      ],
    },
  })

  const graph: SerializedGraph = {
    nodes: [node('$input'), forEachNode, node('$output', { inputs: [p('results')] })],
    edges: [
      edge('$input.items', 'each.items'),
      edge('$input.extra', 'each.extra'),
      edge('each.results', '$output.results'),
    ],
  }

  it('iterates a plain array and forwards context inputs', async () => {
    const out = await run(graph, { items: ['a', 'b'], extra: 'ctx' })
    expect(out).toEqual({
      results: [
        { value: 'a', extra: 'ctx' },
        { value: 'b', extra: 'ctx' },
      ],
    })
  })

  it('accepts { paths: [...] } shape', async () => {
    const out = await run(graph, { items: { paths: ['x'] }, extra: 'e' })
    expect((out.results as unknown[]).length).toBe(1)
  })

  it('accepts { items: [...] } shape', async () => {
    const out = await run(graph, { items: { items: [1, 2, 3] }, extra: 'e' })
    expect((out.results as unknown[]).length).toBe(3)
  })
})

// ── while ─────────────────────────────────────────────────────────────────────

describe('while loop', () => {
  // Subgraph: increment n via mock__inc, continue while mock__lt3 says n < 3.
  // Regression: $output port names must match $input names for feedback (n → n).
  const whileNode = (maxIterations: number) =>
    node('loop', {
      loop: true,
      constraints: { maxIterations },
      inputs: [p('n')],
      outputs: [p('n')],
      subgraph: {
        nodes: [
          node('$input'),
          node('mock__inc', { inputs: [p('params')], outputs: [p('result')] }),
          node('mock__lt3', { inputs: [p('params')], outputs: [p('result')] }),
          node('$output', { inputs: [p('n'), p('continue')] }),
        ],
        edges: [
          edge('$input.n', 'mock__inc.params'),
          edge('mock__inc.result', 'mock__lt3.params'),
          edge('mock__inc.result', '$output.n'),
          edge('mock__lt3.result', '$output.continue'),
        ],
      },
    })

  const graph = (maxIterations: number): SerializedGraph => ({
    nodes: [node('$input'), whileNode(maxIterations), node('$output', { inputs: [p('n')] })],
    edges: [edge('$input.n', 'loop.n'), edge('loop.n', '$output.n')],
  })

  const incPool = (alwaysContinue = false) =>
    fakePool({
      // numbers arrive auto-boxed as { value: n }
      mock__inc: args => Number(args.value) + 1,
      mock__lt3: args => (alwaysContinue ? true : Number(args.value) < 3),
    })

  it('feeds outputs back into the next iteration and exits on continue=false', async () => {
    const out = await run(graph(10), { n: 0 }, incPool())
    expect(out).toEqual({ n: 3 }) // 0→1 (continue), 1→2 (continue), 2→3 (stop)
  })

  it('strips the continue port from the final outputs', async () => {
    const out = await run(graph(10), { n: 0 }, incPool())
    expect('continue' in out).toBe(false)
  })

  it('respects maxIterations when the loop never exits', async () => {
    const out = await run(graph(4), { n: 0 }, incPool(true))
    expect(out).toEqual({ n: 4 }) // incremented exactly maxIterations times
  })
})

// ── retry ─────────────────────────────────────────────────────────────────────

describe('retry', () => {
  const retryGraph = (maxRetries: number): SerializedGraph => ({
    nodes: [
      node('$input'),
      node('attempt', {
        retry: true,
        constraints: { maxRetries },
        inputs: [p('params')],
        outputs: [p('result')],
        subgraph: {
          nodes: [
            node('$input'),
            node('mock__flaky', { inputs: [p('params')], outputs: [p('result')] }),
            node('$output', { inputs: [p('result')] }),
          ],
          edges: [edge('$input.params', 'mock__flaky.params'), edge('mock__flaky.result', '$output.result')],
        },
      }),
      node('$output', { inputs: [p('result')] }),
    ],
    edges: [edge('$input.params', 'attempt.params'), edge('attempt.result', '$output.result')],
  })

  it('retries failed subgraphs and succeeds once the node stops failing', async () => {
    let calls = 0
    const pool = fakePool({
      mock__flaky: () => {
        calls++
        if (calls <= 2) throw new Error(`failure #${calls}`)
        return 'ok'
      },
    })
    const out = await run(retryGraph(3), { params: {} }, pool)
    expect(out).toEqual({ result: 'ok' })
    expect(calls).toBe(3)
  })

  it('throws after exhausting all attempts', async () => {
    const pool = fakePool({
      mock__flaky: () => {
        throw new Error('always broken')
      },
    })
    await expect(run(retryGraph(1), { params: {} }, pool, undefined, true)).rejects.toThrow(
      /Retry exhausted after 2 attempts/,
    )
  })

  it('works with the flaky_op builtin', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('attempt', {
          retry: true,
          constraints: { maxRetries: 3 },
          inputs: [p('failTimes')],
          outputs: [p('result')],
          subgraph: {
            nodes: [
              node('$input'),
              node('flaky_op', { inputs: [p('failTimes')], outputs: [p('result')] }),
              node('$output', { inputs: [p('result')] }),
            ],
            edges: [edge('$input.failTimes', 'flaky_op.failTimes'), edge('flaky_op.result', '$output.result')],
          },
        }),
        node('$output', { inputs: [p('result')] }),
      ],
      edges: [edge('$input.failTimes', 'attempt.failTimes'), edge('attempt.result', '$output.result')],
    }
    // flaky_op's counter is module-level — keep this the only test that uses it
    const out = await run(graph, { failTimes: 2 })
    expect(out).toEqual({ result: 'succeeded on attempt 3' })
  })
})

// ── router ────────────────────────────────────────────────────────────────────

describe('router', () => {
  const branch = (tag: string): SerializedGraph => ({
    nodes: [
      node('$input'),
      node('tag_const', { outputs: [p('value')], constraints: { literal: tag } }),
      node('$output', { inputs: [p('tag'), p('payload')] }),
    ],
    edges: [edge('tag_const.value', '$output.tag'), edge('$input.payload', '$output.payload')],
  })

  const routerGraph = (branches: Record<string, SerializedGraph>): SerializedGraph => ({
    nodes: [
      node('$input'),
      node('route', {
        router: true,
        branches,
        inputs: [p('condition'), p('payload')],
        outputs: [p('tag'), p('payload')],
      }),
      node('$output', { inputs: [p('tag'), p('payload')] }),
    ],
    edges: [
      edge('$input.condition', 'route.condition'),
      edge('$input.payload', 'route.payload'),
      edge('route.tag', '$output.tag'),
      edge('route.payload', '$output.payload'),
    ],
  })

  it('selects the named branch and forwards non-condition inputs', async () => {
    const graph = routerGraph({ a: branch('A'), b: branch('B') })
    expect(await run(graph, { condition: 'b', payload: 'p' })).toEqual({ tag: 'B', payload: 'p' })
  })

  it('maps boolean conditions to "true"/"false" branch keys', async () => {
    const graph = routerGraph({ true: branch('T'), false: branch('F') })
    expect(await run(graph, { condition: true, payload: 'p' })).toEqual({ tag: 'T', payload: 'p' })
    expect(await run(graph, { condition: false, payload: 'p' })).toEqual({ tag: 'F', payload: 'p' })
  })

  it('falls back to the default branch for unknown conditions', async () => {
    const graph = routerGraph({ a: branch('A'), default: branch('D') })
    expect(await run(graph, { condition: 'zzz', payload: 'p' })).toEqual({ tag: 'D', payload: 'p' })
  })

  it('throws when no branch matches and there is no default', async () => {
    const graph = routerGraph({ a: branch('A') })
    await expect(run(graph, { condition: 'zzz', payload: 'p' }, fakePool(), undefined, true)).rejects.toThrow(
      /No branch for condition "zzz"/,
    )
  })
})

// ── observe ───────────────────────────────────────────────────────────────────

describe('observe', () => {
  it('summarizes completed nodes when sequenced via trigger', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
        node('observe', { inputs: [p('trigger', true)], outputs: [p('summary'), p('nodeCount'), p('errorCount')] }),
        node('$output', { inputs: [p('summary'), p('nodeCount'), p('errorCount')] }),
      ],
      edges: [
        edge('$input.value', 'passthrough.value'),
        edge('passthrough.value', 'observe.trigger'),
        edge('observe.summary', '$output.summary'),
        edge('observe.nodeCount', '$output.nodeCount'),
        edge('observe.errorCount', '$output.errorCount'),
      ],
    }
    const out = await run(graph, { value: 1 })
    expect(out.nodeCount).toBe(2) // $input + passthrough completed before observe
    expect(out.errorCount).toBe(0)
    expect(String(out.summary)).toContain('passthrough')
  })

  it('counts errors from failed nodes', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('boom', { builtin: 'nope', inputs: [p('value')], outputs: [p('value')] }),
        node('observe', { inputs: [p('trigger', true)], outputs: [p('errorCount')] }),
        node('$output', { inputs: [p('errorCount')] }),
      ],
      edges: [
        edge('$input.value', 'boom.value'),
        edge('$input.value', 'observe.trigger'),
        edge('observe.errorCount', '$output.errorCount'),
      ],
    }
    const out = await run(graph, { value: 1 })
    expect(out.errorCount).toBe(1)
  })
})

// ── execute_graph (meta) ──────────────────────────────────────────────────────

describe('execute_graph', () => {
  it('runs a graph passed as a value', async () => {
    const inner: SerializedGraph = {
      nodes: [
        node('$input'),
        node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value')] }),
      ],
      edges: [edge('$input.value', 'passthrough.value'), edge('passthrough.value', '$output.value')],
    }
    const outer: SerializedGraph = {
      nodes: [
        node('$input'),
        node('execute_graph', { inputs: [p('graph'), p('inputs', true)], outputs: [p('outputs')] }),
        node('$output', { inputs: [p('outputs')] }),
      ],
      edges: [
        edge('$input.graph', 'execute_graph.graph'),
        edge('$input.inputs', 'execute_graph.inputs'),
        edge('execute_graph.outputs', '$output.outputs'),
      ],
    }
    const out = await run(outer, { graph: inner, inputs: { value: 'nested' } })
    expect(out).toEqual({ outputs: { value: 'nested' } })
  })
})

// ── Capability permissions ────────────────────────────────────────────────────

describe('capability permissions', () => {
  const passGraph: SerializedGraph = {
    nodes: [
      node('$input'),
      node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
      node('$output', { inputs: [p('value')] }),
    ],
    edges: [edge('$input.value', 'passthrough.value'), edge('passthrough.value', '$output.value')],
  }

  const echoGraph: SerializedGraph = {
    nodes: [
      node('$input'),
      node('mock__echo', { inputs: [p('params')], outputs: [p('result')] }),
      node('$output', { inputs: [p('result')] }),
    ],
    edges: [edge('$input.params', 'mock__echo.params'), edge('mock__echo.result', '$output.result')],
  }
  const echoPool = () => fakePool({ mock__echo: args => args })

  it('allows builtins on the list and blocks the rest', async () => {
    const ok = await run(passGraph, { value: 1 }, fakePool(), undefined, false, ['passthrough'])
    expect(ok).toEqual({ value: 1 })

    const events: NodeEvent[] = []
    const blocked = await run(passGraph, { value: 1 }, fakePool(), e => events.push(e), false, ['split_lines'])
    expect(blocked).toEqual({})
    expect(events.some(e => e.type === 'error' && e.error.includes('blocked by allowedTools'))).toBe(true)
  })

  it('checks the dispatch key for renamed builtins', async () => {
    const renamed: SerializedGraph = {
      nodes: [
        node('$input'),
        node('alias', { builtin: 'passthrough', inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value')] }),
      ],
      edges: [edge('$input.value', 'alias.value'), edge('alias.value', '$output.value')],
    }
    expect(await run(renamed, { value: 2 }, fakePool(), undefined, false, ['passthrough'])).toEqual({ value: 2 })
  })

  it('matches MCP tools by exact id and trailing-* wildcard', async () => {
    expect(await run(echoGraph, { params: { a: 1 } }, echoPool(), undefined, false, ['mock__echo'])).toEqual({ result: { a: 1 } })
    expect(await run(echoGraph, { params: { a: 1 } }, echoPool(), undefined, false, ['mock__*'])).toEqual({ result: { a: 1 } })
    expect(await run(echoGraph, { params: { a: 1 } }, echoPool(), undefined, false, ['other__*'])).toEqual({})
  })

  it('a container node\'s allowedTools restricts its subgraph', async () => {
    const each: SerializedGraph = {
      nodes: [
        node('$input'),
        node('each', {
          forEach: true,
          allowedTools: ['split_lines'],
          inputs: [p('items')],
          outputs: [p('results')],
          subgraph: passGraph,
        }),
        node('$output', { inputs: [p('results')] }),
      ],
      edges: [edge('$input.items', 'each.items'), edge('each.results', '$output.results')],
    }
    // passthrough inside the forEach is not in the node's allowedTools → per-item outputs empty
    const out = await run(each, { items: ['x'] })
    expect(out).toEqual({ results: [{}] })
  })

  it('nested permissions intersect — a child cannot widen its parent\'s set', async () => {
    const each: SerializedGraph = {
      nodes: [
        node('$input'),
        node('each', {
          forEach: true,
          allowedTools: ['passthrough'], // child allows it...
          inputs: [p('items')],
          outputs: [p('results')],
          subgraph: passGraph,
        }),
        node('$output', { inputs: [p('results')] }),
      ],
      edges: [edge('$input.items', 'each.items'), edge('each.results', '$output.results')],
    }
    // ...but the top-level set does not → still blocked
    const out = await run(each, { items: ['x'] }, fakePool(), undefined, false, ['split_lines'])
    expect(out).toEqual({ results: [{}] })
  })

  it('gates execute_graph itself', async () => {
    const outer: SerializedGraph = {
      nodes: [
        node('$input'),
        node('execute_graph', { inputs: [p('graph')], outputs: [p('outputs')] }),
        node('$output', { inputs: [p('outputs')] }),
      ],
      edges: [edge('$input.graph', 'execute_graph.graph'), edge('execute_graph.outputs', '$output.outputs')],
    }
    const events: NodeEvent[] = []
    const out = await run(outer, { graph: passGraph }, fakePool(), e => events.push(e), false, ['passthrough'])
    expect(out).toEqual({})
    expect(events.some(e => e.type === 'error' && e.nodeId === 'execute_graph')).toBe(true)
  })
})

// ── Graph lineage ─────────────────────────────────────────────────────────────

describe('graph lineage', () => {
  it('assigns an id to a graph on first execution', async () => {
    const graph: SerializedGraph = {
      nodes: [node('$input'), node('$output', { inputs: [p('value')] })],
      edges: [edge('$input.value', '$output.value')],
    }
    await run(graph, { value: 1 })
    expect(graph.id).toMatch(/^g_[0-9a-f]{8}$/)
  })

  it('execute_graph stamps the child with the parent graph id', async () => {
    const inner: SerializedGraph = {
      nodes: [
        node('$input'),
        node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
        node('$output', { inputs: [p('value')] }),
      ],
      edges: [edge('$input.value', 'passthrough.value'), edge('passthrough.value', '$output.value')],
    }
    const outer: SerializedGraph = {
      nodes: [
        node('$input'),
        node('execute_graph', { inputs: [p('graph'), p('inputs', true)], outputs: [p('outputs')] }),
        node('$output', { inputs: [p('outputs')] }),
      ],
      edges: [
        edge('$input.graph', 'execute_graph.graph'),
        edge('$input.inputs', 'execute_graph.inputs'),
        edge('execute_graph.outputs', '$output.outputs'),
      ],
    }
    await run(outer, { graph: inner, inputs: { value: 'x' } })
    expect(outer.id).toBeDefined()
    expect(inner.parentGraphId).toBe(outer.id)
  })

  it('does not overwrite an existing parentGraphId', async () => {
    const inner: SerializedGraph = {
      parentGraphId: 'g_original',
      nodes: [node('$input'), node('$output', { inputs: [p('value')] })],
      edges: [edge('$input.value', '$output.value')],
    }
    const outer: SerializedGraph = {
      nodes: [
        node('$input'),
        node('execute_graph', { inputs: [p('graph'), p('inputs', true)], outputs: [p('outputs')] }),
        node('$output', { inputs: [p('outputs')] }),
      ],
      edges: [
        edge('$input.graph', 'execute_graph.graph'),
        edge('$input.inputs', 'execute_graph.inputs'),
        edge('execute_graph.outputs', '$output.outputs'),
      ],
    }
    await run(outer, { graph: inner, inputs: { value: 'x' } })
    expect(inner.parentGraphId).toBe('g_original')
  })
})

// ── Events & depth ────────────────────────────────────────────────────────────

describe('telemetry events', () => {
  it('emits start/complete with depth, and depth+1 inside subgraphs', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input'),
        node('each', {
          forEach: true,
          inputs: [p('items')],
          outputs: [p('results')],
          subgraph: {
            nodes: [
              node('$input'),
              node('passthrough', { inputs: [p('value')], outputs: [p('value')] }),
              node('$output', { inputs: [p('value')] }),
            ],
            edges: [edge('$input.item', 'passthrough.value'), edge('passthrough.value', '$output.value')],
          },
        }),
        node('$output', { inputs: [p('results')] }),
      ],
      edges: [edge('$input.items', 'each.items'), edge('each.results', '$output.results')],
    }

    const events: NodeEvent[] = []
    await run(graph, { items: ['x'] }, fakePool(), e => events.push(e))

    const topStart = events.find(e => e.type === 'start' && e.nodeId === 'each')
    expect(topStart?.depth).toBe(0)

    const innerComplete = events.find(e => e.type === 'complete' && e.nodeId === 'passthrough')
    expect(innerComplete?.depth).toBe(1)
    expect(typeof (innerComplete as { durationMs: number }).durationMs).toBe('number')

    // every start has a matching complete (no errors in this graph)
    const starts = events.filter(e => e.type === 'start').length
    const completes = events.filter(e => e.type === 'complete').length
    expect(completes).toBe(starts)
  })
})
