import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'net'
import { createApp } from '../server'
import type { SerializedGraph } from '../core/serializer'
import researchData from '../node/graphs/ResearchAgent.graph.json'

let base: string
let server: ReturnType<ReturnType<typeof createApp>['listen']>

beforeAll(async () => {
  const app = createApp()
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve())
  })
  const { port } = server.address() as AddressInfo
  base = `http://localhost:${port}`
})

afterAll(() => { server.close() })

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function get(path: string) {
  const res = await fetch(`${base}${path}`)
  return { status: res.status, body: await res.json() }
}

// ── /health ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok: true', async () => {
    const { status, body } = await get('/health')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })
})

// ── /capabilities ─────────────────────────────────────────────────────────────

describe('GET /capabilities', () => {
  it('returns an array of node contracts', async () => {
    const { status, body } = await get('/capabilities')
    expect(status).toBe(200)
    expect(Array.isArray(body.capabilities)).toBe(true)
    expect(body.capabilities.length).toBeGreaterThan(0)
  })

  it('each capability has id, inputs, and outputs', async () => {
    const { body } = await get('/capabilities')
    for (const cap of body.capabilities) {
      expect(cap).toHaveProperty('id')
      expect(cap).toHaveProperty('inputs')
      expect(cap).toHaveProperty('outputs')
    }
  })

  it('includes expected built-in nodes', async () => {
    const { body } = await get('/capabilities')
    const ids = body.capabilities.map((c: any) => c.id)
    expect(ids).toContain('http_fetch')
    expect(ids).toContain('memory_read')
    expect(ids).toContain('memory_write')
  })
})

// ── /validate ─────────────────────────────────────────────────────────────────

describe('POST /validate', () => {
  it('returns valid: true for a correct graph', async () => {
    const { status, body } = await post('/validate', { graph: researchData })
    expect(status).toBe(200)
    expect(body.valid).toBe(true)
    expect(body.errors).toHaveLength(0)
  })

  it('returns valid: false and errors for an invalid graph', async () => {
    const bad: SerializedGraph = {
      nodes: [
        { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
        { id: 'orphan',  inputs: [{ id: 'x', type: 'string' }], outputs: [] },
      ],
      edges: [],  // orphan:x is disconnected
    }
    const { status, body } = await post('/validate', { graph: bad })
    expect(status).toBe(200)
    expect(body.valid).toBe(false)
    expect(body.errors.some((e: any) => e.type === 'disconnected_input')).toBe(true)
  })

  it('returns 400 when graph is missing', async () => {
    const { status } = await post('/validate', {})
    expect(status).toBe(400)
  })
})

// ── /emit ─────────────────────────────────────────────────────────────────────

describe('POST /emit/:platform', () => {
  it('emits JS files', async () => {
    const { status, body } = await post('/emit/js', { graph: researchData })
    expect(status).toBe(200)
    expect(typeof body.files['index.js']).toBe('string')
    expect(body.files['index.js']).toContain('fetch')
  })

  it('emits Kotlin files', async () => {
    const { status, body } = await post('/emit/kotlin', { graph: researchData })
    expect(status).toBe(200)
    expect(typeof body.files['Main.kt']).toBe('string')
    expect(body.files['Main.kt']).toContain('suspend fun')
  })

  it('emits Swift files', async () => {
    const { status, body } = await post('/emit/swift', { graph: researchData })
    expect(status).toBe(200)
    expect(typeof body.files['Main.swift']).toBe('string')
    expect(body.files['Main.swift']).toContain('async throws')
  })

  it('returns 400 for unknown platform', async () => {
    const { status, body } = await post('/emit/ruby', { graph: researchData })
    expect(status).toBe(400)
    expect(body.error).toContain('Unknown platform')
  })
})

// ── /run ──────────────────────────────────────────────────────────────────────

describe('POST /run', () => {
  it('executes a simple in-memory graph and returns outputs', async () => {
    // Build a minimal graph: $input(x) → double(x→y) → $output(y)
    // We can't use LLM nodes here (no API key in test env), so use memory_read
    // which gracefully returns { value: '', found: false } on a cold store
    const graph: SerializedGraph = {
      nodes: [
        { id: '$input',     inputs: [], outputs: [{ id: 'key', type: 'string' }] },
        { id: 'memory_read', inputs: [{ id: 'key', type: 'string' }], outputs: [{ id: 'value', type: 'string' }, { id: 'found', type: 'boolean' }], sideEffects: ['filesystem_read'] },
        { id: '$output',    inputs: [{ id: 'value', type: 'string' }, { id: 'found', type: 'boolean' }], outputs: [] },
      ],
      edges: [
        { from: { nodeId: '$input',      portId: 'key'   }, to: { nodeId: 'memory_read', portId: 'key'   } },
        { from: { nodeId: 'memory_read', portId: 'value' }, to: { nodeId: '$output',     portId: 'value' } },
        { from: { nodeId: 'memory_read', portId: 'found' }, to: { nodeId: '$output',     portId: 'found' } },
      ],
    }

    const { status, body } = await post('/run', { graph, inputs: { key: 'nonexistent-key-xyz' } })
    expect(status).toBe(200)
    expect(body.outputs).toHaveProperty('found', false)
    expect(body.outputs).toHaveProperty('value', '')
  })

  it('returns 422 for an invalid graph', async () => {
    const bad: SerializedGraph = {
      nodes: [{ id: 'a', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'x', type: 'string' }] }],
      edges: [{ from: { nodeId: 'a', portId: 'x' }, to: { nodeId: 'a', portId: 'x' } }],  // cycle
    }
    const { status } = await post('/run', { graph: bad })
    expect(status).toBe(422)
  })

  it('returns 422 when a required leaf is not in the registry', async () => {
    const graph: SerializedGraph = {
      nodes: [
        { id: '$input',  inputs: [], outputs: [{ id: 'x', type: 'string' }] },
        { id: 'unknown_leaf', inputs: [{ id: 'x', type: 'string' }], outputs: [{ id: 'y', type: 'string' }] },
        { id: '$output', inputs: [{ id: 'y', type: 'string' }], outputs: [] },
      ],
      edges: [
        { from: { nodeId: '$input',       portId: 'x' }, to: { nodeId: 'unknown_leaf', portId: 'x' } },
        { from: { nodeId: 'unknown_leaf', portId: 'y' }, to: { nodeId: '$output',      portId: 'y' } },
      ],
    }
    const { status, body } = await post('/run', { graph })
    expect(status).toBe(422)
    expect(body.error).toContain('unknown_leaf')
  })

  it('returns 400 when graph is missing', async () => {
    const { status } = await post('/run', {})
    expect(status).toBe(400)
  })
})
