import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { McpPool } from '../lib/mcp-pool'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fractal-pool-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const writeConfig = (servers: unknown[]) => {
  const path = join(dir, 'mcp.json')
  writeFileSync(path, JSON.stringify({ servers }))
  return path
}

describe('McpPool lazy connection', () => {
  it('connect() tolerates a missing config file', async () => {
    const pool = new McpPool()
    await expect(pool.connect(join(dir, 'nope.json'))).resolves.toBeUndefined()
    await pool.close()
  })

  it('connect() reads the config without spawning any server', async () => {
    // A command that cannot spawn — if connect() were eager this would warn;
    // lazily it must succeed silently because nothing starts yet.
    const path = writeConfig([
      { name: 'ghost', transport: 'stdio', command: 'definitely-not-a-real-command-xyz' },
    ])
    const pool = new McpPool()
    await pool.connect(path)
    expect(console.warn).not.toHaveBeenCalled()
    await pool.close()
  })

  it('callTool surfaces a spawn failure at call time, not connect time', async () => {
    const path = writeConfig([
      { name: 'ghost', transport: 'stdio', command: 'definitely-not-a-real-command-xyz' },
    ])
    const pool = new McpPool()
    await pool.connect(path)
    await expect(pool.callTool('ghost', 'anything', {})).rejects.toThrow(
      'No MCP connection for server "ghost"',
    )
    expect(console.warn).toHaveBeenCalled()
    await pool.close()
  })

  it('callTool rejects for a server not in the config', async () => {
    const pool = new McpPool()
    await pool.connect(writeConfig([]))
    await expect(pool.callTool('unknown', 'tool', {})).rejects.toThrow(
      'No MCP connection for server "unknown"',
    )
    await pool.close()
  })

  it('a failed spawn is retried on the next call instead of being cached', async () => {
    const path = writeConfig([
      { name: 'ghost', transport: 'stdio', command: 'definitely-not-a-real-command-xyz' },
    ])
    const pool = new McpPool()
    await pool.connect(path)
    await expect(pool.callTool('ghost', 'tool', {})).rejects.toThrow()
    await expect(pool.callTool('ghost', 'tool', {})).rejects.toThrow()
    // two independent attempts → two warnings
    expect(vi.mocked(console.warn).mock.calls.length).toBe(2)
    await pool.close()
  })

  it('listTools returns empty when no server is reachable', async () => {
    const path = writeConfig([
      { name: 'ghost', transport: 'stdio', command: 'definitely-not-a-real-command-xyz' },
    ])
    const pool = new McpPool()
    await pool.connect(path)
    expect(await pool.listTools()).toEqual([])
    await pool.close()
  })
})
