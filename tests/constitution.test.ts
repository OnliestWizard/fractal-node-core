import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadConstitution,
  matchesPath,
  protectingRule,
  collectPathArgs,
  assertConstitutional,
  constitutionalPool,
  type Constitution,
} from '../lib/constitution'
import { executeSubgraph, type NodeEvent } from '../lib/execute-engine'
import type { McpPool } from '../lib/mcp-pool'
import type { SerializedGraph } from '../core/serializer'

const LAW: Constitution = {
  version: 1,
  guardedTools: ['playground__create_or_update_file', 'playground__push_files'],
  protected: [
    { paths: ['.github/**'], why: 'the heartbeat' },
    { paths: ['README.md'], why: 'the front door' },
  ],
}

describe('matchesPath', () => {
  it('matches exact paths, segments, and any-depth globs', () => {
    expect(matchesPath('README.md', 'README.md')).toBe(true)
    expect(matchesPath('README.md', 'planted/README.md')).toBe(false)
    expect(matchesPath('.github/**', '.github/workflows/pulse.yml')).toBe(true)
    expect(matchesPath('.github/**', '.github')).toBe(false)
    expect(matchesPath('**/*.md', 'a/b/c.md')).toBe(true)
    expect(matchesPath('**/*.md', 'c.md')).toBe(true)
    expect(matchesPath('planted/*', 'planted/x.js')).toBe(true)
    expect(matchesPath('planted/*', 'planted/deep/x.js')).toBe(false)
  })

  it('normalizes separators and leading ./', () => {
    expect(matchesPath('.github/**', '.github\\workflows\\pulse.yml')).toBe(true)
    expect(matchesPath('README.md', './README.md')).toBe(true)
    expect(matchesPath('README.md', '/README.md')).toBe(true)
  })
})

describe('loadConstitution', () => {
  it('returns null when there is no law, loads a valid one, refuses a corrupt one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fractal-law-'))
    try {
      expect(loadConstitution(join(dir, 'constitution.json'))).toBeNull()

      const good = join(dir, 'good.json')
      writeFileSync(good, JSON.stringify(LAW))
      expect(loadConstitution(good)?.protected).toHaveLength(2)

      const corrupt = join(dir, 'corrupt.json')
      writeFileSync(corrupt, '{ not json')
      expect(() => loadConstitution(corrupt)).toThrow(/refusing to run unguarded/)

      const malformed = join(dir, 'malformed.json')
      writeFileSync(malformed, JSON.stringify({ version: 1, guardedTools: 'oops', protected: [] }))
      expect(() => loadConstitution(malformed)).toThrow(/malformed/)

      const reasonless = join(dir, 'reasonless.json')
      writeFileSync(reasonless, JSON.stringify({ version: 1, guardedTools: [], protected: [{ paths: ['x'] }] }))
      expect(() => loadConstitution(reasonless)).toThrow(/malformed/) // every rule carries its why
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('collectPathArgs', () => {
  it('finds path properties at any depth, including arrays', () => {
    expect(collectPathArgs({ path: 'a.md' })).toEqual(['a.md'])
    expect(collectPathArgs({ files: [{ path: 'a.md' }, { path: 'b.md' }] })).toEqual(['a.md', 'b.md'])
    expect(collectPathArgs({ nested: { deep: { path: 'c.md' } }, other: 1 })).toEqual(['c.md'])
    expect(collectPathArgs({ path: 42, content: 'path: not-a-key' })).toEqual([])
  })
})

describe('assertConstitutional', () => {
  it('ignores unguarded tools entirely', () => {
    expect(() => assertConstitutional(LAW, 'playground__add_issue_comment', { path: 'README.md' })).not.toThrow()
    expect(() => assertConstitutional(LAW, 'github__get_file_contents', { path: '.github/x' })).not.toThrow()
  })

  it('allows guarded writes into free territory', () => {
    expect(() => assertConstitutional(LAW, 'playground__create_or_update_file', { path: 'planted/x.js' })).not.toThrow()
    expect(() => assertConstitutional(LAW, 'playground__push_files', { files: [{ path: 'STATUS.md' }] })).not.toThrow()
  })

  it('blocks guarded writes into protected territory, citing the why', () => {
    expect(() => assertConstitutional(LAW, 'playground__create_or_update_file', { path: '.github/workflows/pulse.yml' }))
      .toThrow(/blocked by constitution — the heartbeat/)
    expect(() => assertConstitutional(LAW, 'playground__push_files', { files: [{ path: 'planted/ok.js' }, { path: 'README.md' }] }))
      .toThrow(/blocked by constitution — the front door/)
  })

  it('fails closed when a guarded tool carries no readable path', () => {
    expect(() => assertConstitutional(LAW, 'playground__create_or_update_file', { content: 'x' }))
      .toThrow(/fail closed/)
  })

  it('supports wildcard guarded tools', () => {
    const law: Constitution = { ...LAW, guardedTools: ['playground__*'] }
    expect(() => assertConstitutional(law, 'playground__create_or_update_file', { path: 'README.md' }))
      .toThrow(/blocked by constitution/)
  })
})

function fakePool(calls: Array<{ server: string; tool: string; args: unknown }>): McpPool {
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => [],
    callTool: async (server: string, tool: string, args: Record<string, unknown>) => {
      calls.push({ server, tool, args })
      return JSON.stringify({ ok: true })
    },
  } as unknown as McpPool
}

describe('constitutionalPool', () => {
  it('refuses protected writes BEFORE the pool is touched, delegates free ones', async () => {
    const calls: Array<{ server: string; tool: string; args: unknown }> = []
    const pool = constitutionalPool(fakePool(calls), LAW)

    await expect(pool.callTool('playground', 'create_or_update_file', { path: 'README.md', content: 'x' }))
      .rejects.toThrow(/blocked by constitution/)
    expect(calls).toHaveLength(0) // the server was never reached

    await pool.callTool('playground', 'create_or_update_file', { path: 'planted/ok.md', content: 'x' })
    expect(calls).toHaveLength(1)
  })

  it('governs the whole nested execution through the engine, with error isolation', async () => {
    const calls: Array<{ server: string; tool: string; args: unknown }> = []
    const pool = constitutionalPool(fakePool(calls), LAW)

    const graph: SerializedGraph = {
      nodes: [
        { id: '$input', inputs: [], outputs: [{ id: 'params', type: 'any' }] },
        { id: 'playground__create_or_update_file', inputs: [{ id: 'params', type: 'any' }], outputs: [{ id: 'result', type: 'any' }] },
        { id: '$output', inputs: [{ id: 'result', type: 'any' }], outputs: [] },
      ],
      edges: [
        { from: { nodeId: '$input', portId: 'params' }, to: { nodeId: 'playground__create_or_update_file', portId: 'params' } },
        { from: { nodeId: 'playground__create_or_update_file', portId: 'result' }, to: { nodeId: '$output', portId: 'result' } },
      ],
    }

    const events: NodeEvent[] = []
    const blocked = await executeSubgraph(graph, { params: { path: '.github/workflows/pulse.yml', content: 'evil' } }, pool, e => events.push(e))
    expect(blocked).toEqual({}) // $output skipped via normal error isolation
    expect(calls).toHaveLength(0)
    expect(events.some(e => e.type === 'error' && String(e.error).includes('blocked by constitution'))).toBe(true)

    const ok = await executeSubgraph(graph, { params: { path: 'planted/fine.md', content: 'good' } }, pool)
    expect(ok.result).toBeDefined()
    expect(calls).toHaveLength(1)
  })
})
