import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { executeSubgraph, runGraphTests } from '../lib/execute-engine'
import { valueAtPath, checkExpectation } from '../lib/graph-tests'
import { loadGraph, listVersions } from '../lib/graph-store'
import type { SerializedGraph, SerializedNode } from '../core/serializer'
import type { Edge, Port } from '../core/types'
import type { McpPool } from '../lib/mcp-pool'

// ── Test helpers (mirroring executeEngine.test.ts) ────────────────────────────

const p = (id: string, optional?: boolean): Port =>
  optional ? { id, type: 'any', optional: true } : { id, type: 'any' }

const node = (id: string, partial: Partial<SerializedNode> = {}): SerializedNode => ({
  id,
  inputs: [],
  outputs: [],
  ...partial,
})

const edge = (from: string, to: string): Edge => {
  const [fn, fp] = from.split('.')
  const [tn, tp] = to.split('.')
  return { from: { nodeId: fn, portId: fp }, to: { nodeId: tn, portId: tp } }
}

type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>

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

// Pure passthrough graph: $input.value → $output.value
const passthrough = (tests?: SerializedGraph['tests']): SerializedGraph => ({
  nodes: [
    node('$input', { outputs: [p('value')] }),
    node('$output', { inputs: [p('value')] }),
  ],
  edges: [edge('$input.value', '$output.value')],
  ...(tests ? { tests } : {}),
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ── Assertion helpers ─────────────────────────────────────────────────────────

describe('valueAtPath', () => {
  it('reads a top-level port', () => {
    expect(valueAtPath({ a: 1 }, 'a')).toEqual({ value: 1, found: true })
  })

  it('walks dot-paths through objects', () => {
    expect(valueAtPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toEqual({ value: 'x', found: true })
  })

  it('parses JSON-string values mid-walk (MCP results)', () => {
    const outputs = { result: JSON.stringify({ content: { path: 'planted/x.md' } }) }
    expect(valueAtPath(outputs, 'result.content.path')).toEqual({ value: 'planted/x.md', found: true })
  })

  it('reports missing paths', () => {
    expect(valueAtPath({ a: 1 }, 'a.b').found).toBe(false)
    expect(valueAtPath({ a: 'not json' }, 'a.b').found).toBe(false)
  })
})

describe('checkExpectation', () => {
  it('equals compares deep JSON', () => {
    expect(checkExpectation({ port: 'x', equals: { a: 1 } }, { x: { a: 1 } })).toEqual([])
    expect(checkExpectation({ port: 'x', equals: { a: 1 } }, { x: { a: 2 } })).toHaveLength(1)
  })

  it('contains works on strings and stringified objects', () => {
    expect(checkExpectation({ port: 'x', contains: 'needle' }, { x: 'hay needle hay' })).toEqual([])
    expect(checkExpectation({ port: 'x', contains: 'needle' }, { x: { msg: 'a needle' } })).toEqual([])
    expect(checkExpectation({ port: 'x', contains: 'needle' }, { x: 'nothing' })).toHaveLength(1)
  })

  it('exists checks presence either way', () => {
    expect(checkExpectation({ port: 'x', exists: true }, { x: 0 })).toEqual([])
    expect(checkExpectation({ port: 'y', exists: false }, { x: 0 })).toEqual([])
    expect(checkExpectation({ port: 'y', exists: true }, { x: 0 })).toHaveLength(1)
  })
})

// ── runGraphTests ─────────────────────────────────────────────────────────────

describe('runGraphTests', () => {
  it('passes when all cases pass', async () => {
    const graph = passthrough([
      { name: 'echoes', inputs: { value: 'hi' }, expect: [{ port: 'value', equals: 'hi' }] },
      { inputs: { value: 7 }, expect: [{ port: 'value', equals: 7 }] },
    ])
    const report = await runGraphTests(graph, fakePool())
    expect(report).toMatchObject({ passed: true, total: 2, failed: 0 })
    expect(report.results.map(r => r.name)).toEqual(['echoes', 'case 2'])
  })

  it('fails with a useful summary when an expectation fails', async () => {
    const graph = passthrough([
      { name: 'wrong', inputs: { value: 'hi' }, expect: [{ port: 'value', equals: 'bye' }] },
    ])
    const report = await runGraphTests(graph, fakePool())
    expect(report.passed).toBe(false)
    expect(report.summary).toContain('wrong')
    expect(report.summary).toContain('FAILED')
  })

  it('a node failure fails the case; expectError inverts it', async () => {
    const boom: SerializedGraph = {
      nodes: [
        node('$input', { outputs: [p('value')] }),
        node('boom', { builtin: 'no_such_builtin', inputs: [p('value')], outputs: [p('out')] }),
        node('$output', { inputs: [p('out')] }),
      ],
      edges: [edge('$input.value', 'boom.value'), edge('boom.out', '$output.out')],
      tests: [{ name: 'should throw', inputs: { value: 1 }, expectError: true }],
    }
    expect((await runGraphTests(boom, fakePool())).passed).toBe(true)

    boom.tests = [{ name: 'should not throw', inputs: { value: 1 } }]
    const report = await runGraphTests(boom, fakePool())
    expect(report.passed).toBe(false)
    expect(report.results[0].failures[0]).toContain('graph threw')
  })

  it('expectError fails when the graph succeeds', async () => {
    const graph = passthrough([{ inputs: { value: 1 }, expectError: true }])
    const report = await runGraphTests(graph, fakePool())
    expect(report.passed).toBe(false)
  })

  it('a graph with no tests passes vacuously', async () => {
    const report = await runGraphTests(passthrough(), fakePool())
    expect(report).toMatchObject({ passed: true, total: 0 })
  })

  it('test runs inherit allowedTools', async () => {
    const graph: SerializedGraph = {
      nodes: [
        node('$input', { outputs: [p('params')] }),
        node('call', { builtin: 'mock__echo', inputs: [p('params')], outputs: [p('result')] }),
        node('$output', { inputs: [p('result')] }),
      ],
      edges: [edge('$input.params', 'call.params'), edge('call.result', '$output.result')],
      tests: [{ inputs: { params: { a: 1 } }, expect: [{ port: 'result', exists: true }] }],
    }
    const pool = fakePool({ mock__echo: args => args })
    expect((await runGraphTests(graph, pool, 0, ['mock__*'])).passed).toBe(true)
    const blocked = await runGraphTests(graph, pool, 0, ['something_else'])
    expect(blocked.passed).toBe(false)
    expect(blocked.results[0].failures[0]).toContain('blocked by allowedTools')
  })

  it('does not mutate the graph under test', async () => {
    const graph = passthrough([{ inputs: { value: 1 }, expect: [{ port: 'value', equals: 1 }] }])
    await runGraphTests(graph, fakePool())
    expect(graph.id).toBeUndefined()
  })
})

// ── save_graph gating + test_graph builtin ────────────────────────────────────

describe('save_graph test gate', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'graph-ci-'))
    process.env.FRACTAL_GRAPHS_DIR = dir
  })

  afterEach(() => {
    delete process.env.FRACTAL_GRAPHS_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  const saveWrapper: SerializedGraph = {
    nodes: [
      node('$input', { outputs: [p('graph')] }),
      node('name_const', { outputs: [p('value')], constraints: { literal: 'gated' } as never }),
      node('save_graph', { inputs: [p('name'), p('graph'), p('skipTests', true)], outputs: [p('name'), p('saved'), p('version'), p('tested')] }),
      node('$output', { inputs: [p('saved'), p('version'), p('tested')] }),
    ],
    edges: [
      edge('name_const.value', 'save_graph.name'),
      edge('$input.graph', 'save_graph.graph'),
      edge('save_graph.saved', '$output.saved'),
      edge('save_graph.version', '$output.version'),
      edge('save_graph.tested', '$output.tested'),
    ],
  }

  it('saves and reports tested count when contract tests pass', async () => {
    const payload = passthrough([{ inputs: { value: 'x' }, expect: [{ port: 'value', equals: 'x' }] }])
    const out = await executeSubgraph(saveWrapper, { graph: payload }, fakePool())
    expect(out.saved).toBe(true)
    expect(out.tested).toBe(1)
    expect(loadGraph('gated').found).toBe(true)
    expect(listVersions('gated')).toHaveLength(1)
  })

  it('refuses to version a graph whose contract tests fail', async () => {
    const payload = passthrough([{ name: 'broken contract', inputs: { value: 'x' }, expect: [{ port: 'value', equals: 'y' }] }])
    const events: { type: string; error?: string }[] = []
    const out = await executeSubgraph(saveWrapper, { graph: payload }, fakePool(), e => events.push(e))
    expect(out).toEqual({}) // $output skipped via error isolation
    const err = events.find(e => e.type === 'error' && e.error?.includes('version refused'))
    expect(err).toBeTruthy()
    expect(err!.error).toContain('broken contract')
    expect(existsSync(join(dir, 'gated.json'))).toBe(false)
    expect(listVersions('gated')).toHaveLength(0)
  })

  it('unwired skipTests in caller inputs does not reach the gate', async () => {
    const payload = passthrough([{ inputs: { value: 'x' }, expect: [{ port: 'value', equals: 'y' }] }])
    const out = await executeSubgraph(saveWrapper, { graph: payload, skipTests: true }, fakePool())
    expect(out).toEqual({}) // still refused — skipTests must be wired to the node
  })

  it('skipTests wired as input bypasses the gate and reports tested=0', async () => {
    const wrapper: SerializedGraph = JSON.parse(JSON.stringify(saveWrapper))
    wrapper.nodes.find(n => n.id === '$input')!.outputs.push(p('skipTests'))
    wrapper.edges.push(edge('$input.skipTests', 'save_graph.skipTests'))
    const payload = passthrough([{ inputs: { value: 'x' }, expect: [{ port: 'value', equals: 'y' }] }])
    const out = await executeSubgraph(wrapper, { graph: payload, skipTests: true }, fakePool())
    expect(out.saved).toBe(true)
    expect(out.tested).toBe(0)
    expect(loadGraph('gated').found).toBe(true)
  })

  it('graphs without tests save exactly as before', async () => {
    const out = await executeSubgraph(saveWrapper, { graph: passthrough() }, fakePool())
    expect(out.saved).toBe(true)
    expect(out.tested).toBe(0)
  })

  it('saveGraph stamps specVersion', async () => {
    await executeSubgraph(saveWrapper, { graph: passthrough() }, fakePool())
    expect(loadGraph('gated').graph?.specVersion).toBe('1')
  })
})

describe('test_graph builtin', () => {
  it('reports pass/fail without saving', async () => {
    const wrapper: SerializedGraph = {
      nodes: [
        node('$input', { outputs: [p('graph')] }),
        node('test_graph', { inputs: [p('graph')], outputs: [p('passed'), p('summary'), p('results')] }),
        node('$output', { inputs: [p('passed'), p('summary')] }),
      ],
      edges: [
        edge('$input.graph', 'test_graph.graph'),
        edge('test_graph.passed', '$output.passed'),
        edge('test_graph.summary', '$output.summary'),
      ],
    }
    const good = passthrough([{ inputs: { value: 1 }, expect: [{ port: 'value', equals: 1 }] }])
    const goodOut = await executeSubgraph(wrapper, { graph: good }, fakePool())
    expect(goodOut.passed).toBe(true)
    expect(goodOut.summary).toContain('1/1')

    const bad = passthrough([{ inputs: { value: 1 }, expect: [{ port: 'value', equals: 2 }] }])
    const badOut = await executeSubgraph(wrapper, { graph: bad }, fakePool())
    expect(badOut.passed).toBe(false)
  })

  it('is gated by allowedTools', async () => {
    const wrapper: SerializedGraph = {
      nodes: [
        node('$input', { outputs: [p('graph')] }),
        node('test_graph', { inputs: [p('graph')], outputs: [p('passed')] }),
        node('$output', { inputs: [p('passed')] }),
      ],
      edges: [edge('$input.graph', 'test_graph.graph'), edge('test_graph.passed', '$output.passed')],
    }
    const events: { type: string; error?: string }[] = []
    await executeSubgraph(wrapper, { graph: passthrough() }, fakePool(), e => events.push(e), 0, false, undefined, ['save_graph'])
    expect(events.some(e => e.type === 'error' && e.error?.includes('blocked by allowedTools'))).toBe(true)
  })
})
