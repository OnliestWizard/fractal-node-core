import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveGraph, loadGraph, listVersions, rollbackGraph, listGraphs, libraryCatalog } from '../lib/graph-store'
import type { SerializedGraph } from '../core/serializer'

const graph = (tag: string): SerializedGraph => ({
  nodes: [{ id: '$input', inputs: [], outputs: [], description: tag }],
  edges: [],
})

// What a graph looks like after passing through saveGraph (specVersion stamped)
const stored = (tag: string): SerializedGraph => ({ ...graph(tag), specVersion: '1' })

// Date.now() is the version timestamp — separate consecutive saves
const tick = () => new Promise(r => setTimeout(r, 10))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fractal-graphs-'))
  process.env.FRACTAL_GRAPHS_DIR = dir
})

afterEach(() => {
  delete process.env.FRACTAL_GRAPHS_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('save / load', () => {
  it('round-trips a graph and returns a version id', () => {
    const version = saveGraph('demo', graph('v1'))
    expect(version).toMatch(/^\d+_[0-9a-f]{8}$/)
    const { graph: loaded, found } = loadGraph('demo')
    expect(found).toBe(true)
    expect(loaded).toEqual(stored('v1'))
  })

  it('returns found=false for unknown names', () => {
    expect(loadGraph('nope')).toEqual({ graph: null, found: false })
  })

  it('listGraphs excludes the .versions directory', () => {
    saveGraph('demo', graph('v1'))
    expect(listGraphs()).toEqual(['demo'])
  })
})

describe('libraryCatalog', () => {
  it('exposes each graph as a composable skill signature', () => {
    const skill: SerializedGraph = {
      description: 'echoes a value',
      nodes: [
        { id: '$input', inputs: [], outputs: [{ id: 'value', type: 'string' }] },
        { id: '$output', inputs: [{ id: 'value', type: 'string' }], outputs: [] },
      ],
      edges: [{ from: { nodeId: '$input', portId: 'value' }, to: { nodeId: '$output', portId: 'value' } }],
      tests: [{ inputs: { value: 'x' }, expect: [{ port: 'value', equals: 'x' }] }],
    }
    saveGraph('echo_skill', skill)
    saveGraph('bare', graph('v1'))

    const catalog = libraryCatalog()
    const echo = catalog.find(e => e.name === 'echo_skill')
    expect(echo).toMatchObject({
      description: 'echoes a value',
      inputs: [{ id: 'value', type: 'string' }],
      outputs: [{ id: 'value', type: 'string' }],
      tested: 1,
    })
    const bare = catalog.find(e => e.name === 'bare')
    expect(bare).toMatchObject({ tested: 0, inputs: [], outputs: [] })
    expect(bare!.description).toBeUndefined()
  })
})

describe('version history', () => {
  it('records one version per distinct save, newest first', async () => {
    saveGraph('demo', graph('v1'))
    await tick()
    saveGraph('demo', graph('v2'))
    const versions = listVersions('demo')
    expect(versions.length).toBe(2)
    expect(versions[0].timestamp).toBeGreaterThan(versions[1].timestamp)
  })

  it('skips a new version when content is unchanged', () => {
    const v1 = saveGraph('demo', graph('v1'))
    const v2 = saveGraph('demo', graph('v1'))
    expect(v2).toBe(v1)
    expect(listVersions('demo').length).toBe(1)
  })

  it('loads a specific version by id or bare hash', async () => {
    const v1 = saveGraph('demo', graph('v1'))
    await tick()
    saveGraph('demo', graph('v2'))

    expect(loadGraph('demo', v1).graph).toEqual(stored('v1'))
    expect(loadGraph('demo', v1.split('_')[1]).graph).toEqual(stored('v1'))
    expect(loadGraph('demo', 'bogus')).toEqual({ graph: null, found: false })
  })
})

describe('rollback', () => {
  it('restores the previous version by default and records the restore', async () => {
    saveGraph('demo', graph('v1'))
    await tick()
    saveGraph('demo', graph('v2'))
    await tick()

    const { graph: restored, restored: ok } = rollbackGraph('demo')
    expect(ok).toBe(true)
    expect(restored).toEqual(stored('v1'))
    expect(loadGraph('demo').graph).toEqual(stored('v1'))
    expect(listVersions('demo').length).toBe(3) // v1, v2, restore-of-v1
  })

  it('restores a named version', async () => {
    const v1 = saveGraph('demo', graph('v1'))
    await tick()
    saveGraph('demo', graph('v2'))
    await tick()
    saveGraph('demo', graph('v3'))
    await tick()

    const result = rollbackGraph('demo', v1)
    expect(result.restored).toBe(true)
    expect(loadGraph('demo').graph).toEqual(stored('v1'))
  })

  it('returns restored=false when there is nothing to roll back to', () => {
    saveGraph('demo', graph('v1'))
    expect(rollbackGraph('demo').restored).toBe(false)
    expect(rollbackGraph('missing').restored).toBe(false)
  })
})
