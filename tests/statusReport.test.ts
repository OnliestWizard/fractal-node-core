import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveGraph } from '../lib/graph-store'
import { collectStatus, renderStatusMarkdown, type StatusReport } from '../lib/status-report'
import type { SerializedGraph } from '../core/serializer'

const skill = (tag: string): SerializedGraph => ({
  description: `does ${tag}`,
  nodes: [
    { id: '$input', inputs: [], outputs: [{ id: 'value', type: 'string' }, { id: 'extra', type: 'string', optional: true }] },
    { id: '$output', inputs: [{ id: 'result', type: 'string' }], outputs: [] },
  ],
  edges: [],
  tests: [{ inputs: { value: 'x' }, expect: [{ port: 'result', exists: true }] }],
})

// Date.now() is the version timestamp — separate consecutive saves
const tick = () => new Promise(r => setTimeout(r, 10))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fractal-status-'))
  process.env.FRACTAL_GRAPHS_DIR = dir
})

afterEach(() => {
  delete process.env.FRACTAL_GRAPHS_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('collectStatus', () => {
  it('reports each skill with its version count and last save', async () => {
    saveGraph('alpha', skill('a'))
    await tick()
    saveGraph('alpha', { ...skill('a'), description: 'does a, v2' })

    const report = collectStatus()
    const alpha = report.skills.find(s => s.name === 'alpha')
    expect(alpha).toMatchObject({ versionCount: 2, tested: 1 })
    expect(alpha!.lastSaved).toBeGreaterThan(0)
  })

  it('orders recent saves newest first across skills and honors the limit', async () => {
    saveGraph('alpha', skill('a'))
    await tick()
    saveGraph('beta', skill('b'))
    await tick()
    saveGraph('alpha', { ...skill('a'), description: 'newer' })

    const report = collectStatus(2)
    expect(report.recentSaves.length).toBe(2)
    expect(report.recentSaves[0].skill).toBe('alpha')
    expect(report.recentSaves[1].skill).toBe('beta')
    const [first, second] = report.recentSaves
    expect(first.version.timestamp).toBeGreaterThanOrEqual(second.version.timestamp)
  })

  it('returns an empty report for an empty library', () => {
    expect(collectStatus()).toEqual({ skills: [], recentSaves: [] })
  })
})

describe('renderStatusMarkdown', () => {
  const generatedAt = new Date('2026-06-11T12:00:00Z')

  it('renders the skills table with interface signatures and totals', async () => {
    saveGraph('alpha', skill('a'))
    await tick()
    saveGraph('alpha', { ...skill('a'), description: 'does a, v2' })
    saveGraph('beta', skill('b'))

    const md = renderStatusMarkdown(collectStatus(), { generatedAt })
    expect(md).toContain('# Plant — skill library status')
    expect(md).toContain('**2 skills · 3 saved versions · 2 contract tests**')
    expect(md).toContain('regenerated 2026-06-11 12:00 UTC')
    expect(md).toContain('| `alpha` | does a, v2 | `(value, extra?) → (result)` | 1 | 2 |')
    expect(md).toContain('## Recent saves')
    expect(md).toContain('*Last heartbeat:')
  })

  it('escapes pipes and newlines so descriptions cannot break the table', () => {
    const report: StatusReport = {
      skills: [{
        name: 'tricky',
        description: 'a | b\nmultiline',
        inputs: [],
        outputs: [],
        tested: 0,
        versionCount: 1,
        lastSaved: Date.parse('2026-06-10'),
      }],
      recentSaves: [],
    }
    const md = renderStatusMarkdown(report, { generatedAt })
    expect(md).toContain('a \\| b multiline')
  })

  it('renders a deliveries section only when deliveries are passed in', () => {
    const empty: StatusReport = { skills: [], recentSaves: [] }
    const without = renderStatusMarkdown(empty, { generatedAt })
    expect(without).not.toContain('## Recent deliveries')

    const withDeliveries = renderStatusMarkdown(empty, {
      generatedAt,
      deliveries: [{ title: 'Code request: parseDuration', url: 'https://github.com/x/y/issues/4', state: 'closed', updatedAt: '2026-06-10T20:00:00Z' }],
    })
    expect(withDeliveries).toContain('## Recent deliveries')
    expect(withDeliveries).toContain('[Code request: parseDuration](https://github.com/x/y/issues/4) — closed, 2026-06-10')
  })

  it('says so when the library is empty', () => {
    const md = renderStatusMarkdown({ skills: [], recentSaves: [] }, { generatedAt })
    expect(md).toContain('*library is empty*')
    expect(md).toContain('*no version history on this machine yet')
  })
})
