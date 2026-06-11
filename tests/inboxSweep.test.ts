import { describe, it, expect, beforeEach } from 'vitest'
import { sweepInbox, formatSweepReport, PLANT_LABELS } from '../lib/inbox-sweep'
import { resetUsage } from '../lib/llm-usage'
import type { McpPool } from '../lib/mcp-pool'
import type { SerializedGraph } from '../core/serializer'

interface Call { server: string; tool: string; args: Record<string, unknown> }

const fakePool = (issues: unknown[], calls: Call[]): McpPool => ({
  callTool: async (server: string, tool: string, args: Record<string, unknown>) => {
    calls.push({ server, tool, args })
    if (tool === 'list_issues') return JSON.stringify(issues)
    return '{}'
  },
}) as unknown as McpPool

// Deterministic handler stand-ins — literals only, no LLM, no network
const stubHandler = (category: string): SerializedGraph => ({
  nodes: [
    { id: '$input', inputs: [], outputs: [{ id: 'issue', type: 'string' }] },
    { id: 'cat_const', inputs: [], outputs: [{ id: 'value', type: 'string' }], constraints: { literal: category } },
    { id: 'res_const', inputs: [], outputs: [{ id: 'value', type: 'string' }], constraints: { literal: 'stub-delivery' } },
    { id: '$output', inputs: [{ id: 'category', type: 'string' }, { id: 'result', type: 'any' }], outputs: [] },
  ],
  edges: [
    { from: { nodeId: 'cat_const', portId: 'value' }, to: { nodeId: '$output', portId: 'category' } },
    { from: { nodeId: 'res_const', portId: 'value' }, to: { nodeId: '$output', portId: 'result' } },
  ],
})

const failingHandler: SerializedGraph = {
  nodes: [
    { id: '$input', inputs: [], outputs: [{ id: 'issue', type: 'string' }] },
    { id: 'url_const', inputs: [], outputs: [{ id: 'value', type: 'string' }], constraints: { literal: 'http://localhost:9/unreachable' } },
    { id: 'http_fetch', inputs: [{ id: 'url', type: 'string' }], outputs: [{ id: 'body', type: 'string' }, { id: 'status', type: 'number' }] },
    { id: '$output', inputs: [{ id: 'result', type: 'any' }], outputs: [] },
  ],
  edges: [
    { from: { nodeId: 'url_const', portId: 'value' }, to: { nodeId: 'http_fetch', portId: 'url' } },
    { from: { nodeId: 'http_fetch', portId: 'body' }, to: { nodeId: '$output', portId: 'result' } },
  ],
}

const issue = (number: number, login: string, labels: string[] = []) => ({
  number, title: `Issue ${number}`, body: 'body', user: { login }, labels: labels.map(name => ({ name })),
})

const OPTS = { owner: 'kadie', repo: 'sandbox' }

beforeEach(() => resetUsage())

describe('sweepInbox filters', () => {
  it('dry run handles eligible issues and never writes', async () => {
    const calls: Call[] = []
    const pool = fakePool([issue(1, 'kadie')], calls)
    const report = await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: true })

    expect(report.items).toEqual([
      { number: 1, title: 'Issue 1', action: 'handled', category: 'proposal', result: 'stub-delivery' },
    ])
    expect(calls.map(c => c.tool)).toEqual(['list_issues'])
  })

  it('skips strangers even in live mode — the filter is code, not prompt', async () => {
    const calls: Call[] = []
    const pool = fakePool([issue(2, 'someone-else')], calls)
    const report = await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: false })

    expect(report.items[0].action).toBe('skipped-stranger')
    expect(calls.map(c => c.tool)).toEqual(['list_issues'])
  })

  it('skips issues already carrying a plant:* label (idempotency)', async () => {
    for (const label of PLANT_LABELS) {
      const calls: Call[] = []
      const pool = fakePool([issue(3, 'kadie', [label])], calls)
      const report = await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: false })
      expect(report.items[0].action).toBe('skipped-labeled')
    }
  })

  it('caps handled issues per sweep', async () => {
    const pool = fakePool([issue(4, 'kadie'), issue(5, 'kadie')], [])
    const report = await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: true, maxIssues: 1 })
    expect(report.items.map(i => i.action)).toEqual(['handled', 'skipped-cap'])
  })

  it('stops at the budget ceiling', async () => {
    const pool = fakePool([issue(6, 'kadie')], [])
    const report = await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: true, budgetUsd: 0 })
    expect(report.items[0].action).toBe('skipped-budget')
  })
})

describe('sweepInbox live label state machine', () => {
  it('claims with in-progress BEFORE work, then marks delivered', async () => {
    const calls: Call[] = []
    const pool = fakePool([issue(7, 'kadie')], calls)
    await sweepInbox(pool, stubHandler('code_request'), { ...OPTS, dryRun: false })

    const labelCalls = calls.filter(c => c.tool === 'update_issue')
    expect(labelCalls.length).toBe(2)
    expect(labelCalls[0].args.labels).toEqual(['plant:in-progress'])
    expect(labelCalls[1].args.labels).toEqual(['plant:delivered'])
  })

  it('routes category=other to needs-human', async () => {
    const calls: Call[] = []
    const pool = fakePool([issue(8, 'kadie')], calls)
    await sweepInbox(pool, stubHandler('other'), { ...OPTS, dryRun: false })

    const labelCalls = calls.filter(c => c.tool === 'update_issue')
    expect(labelCalls[1].args.labels).toEqual(['plant:needs-human'])
  })

  it('preserves non-plant labels when relabeling', async () => {
    const calls: Call[] = []
    const pool = fakePool([issue(9, 'kadie', ['bug'])], calls)
    await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: false })

    const labelCalls = calls.filter(c => c.tool === 'update_issue')
    expect(labelCalls[0].args.labels).toEqual(['bug', 'plant:in-progress'])
  })

  it('a failed delivery gets needs-human, an error comment, and a drafted regression test', async () => {
    const calls: Call[] = []
    const pool = fakePool([issue(10, 'kadie')], calls)
    const report = await sweepInbox(pool, failingHandler, { ...OPTS, dryRun: false })

    // http_fetch is outside SWEEP_ALLOWED_TOOLS — the permission rail is
    // what fails this handler, proving the allowlist and the failure path
    expect(report.items[0].action).toBe('failed')
    expect(report.items[0].error).toContain('blocked by allowedTools')

    const labelCalls = calls.filter(c => c.tool === 'update_issue')
    expect(labelCalls[1].args.labels).toEqual(['plant:needs-human'])

    const comment = calls.find(c => c.tool === 'add_issue_comment')
    expect(comment).toBeDefined()
    expect(String(comment!.args.body)).toContain('could not deliver')
    expect(String(comment!.args.body)).toContain('Drafted regression test')
  })
})

describe('formatSweepReport', () => {
  it('renders one line per item with the verdict', async () => {
    const pool = fakePool([issue(11, 'kadie'), issue(12, 'ghost')], [])
    const report = await sweepInbox(pool, stubHandler('proposal'), { ...OPTS, dryRun: true })
    const text = formatSweepReport(report)
    expect(text).toContain('sweep (dry-run): 2 scanned, 1 handled')
    expect(text).toContain('#11 handled → proposal')
    expect(text).toContain('#12 skipped-stranger')
  })
})
