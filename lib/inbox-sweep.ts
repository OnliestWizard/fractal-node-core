// The inbox sweep — one beat of the heartbeat. Lists the playground queue,
// filters it hard (owner-only, unlabeled, capped, budgeted), and runs each
// surviving issue through the gated issue_handler graph. The intelligence
// lives in the library; this module is the deterministic rails around it:
// the owner filter is code (never a prompt), labels are an at-most-once
// state machine (in-progress BEFORE work, so a crash strands rather than
// double-delivers), and the token meter enforces a per-sweep budget.

import { executeSubgraph, type NodeEvent } from './execute-engine'
import { usageSummary, formatCost } from './llm-usage'
import { draftTestFromTrace } from './test-draft'
import type { McpPool } from './mcp-pool'
import type { SerializedGraph } from '../core/serializer'

export const PLANT_LABELS = ['plant:in-progress', 'plant:delivered', 'plant:needs-human']

// Everything a sweep is allowed to touch. No plant, no save_graph, no
// github__* (read-wide channel), no filesystem — deliveries only.
export const SWEEP_ALLOWED_TOOLS = [
  'issue_triage', 'issue_handler', 'code_smith', 'inbox_worker', 'code_improve', 'playground_writer',
  'draft_writer', 'quality_judge', 'run_js', 'pack', 'pluck', 'template', 'extract_json_block',
  'playground__*',
]

export interface SweepOptions {
  owner: string
  repo: string
  /** true (default) = triage and report only, zero writes. */
  dryRun?: boolean
  /** Issues handled per sweep (default 3). */
  maxIssues?: number
  /** LLM budget per sweep in USD (default 0.25); checked before each issue. */
  budgetUsd?: number
}

export interface SweepItem {
  number: number
  title: string
  action: 'handled' | 'failed' | 'skipped-stranger' | 'skipped-labeled' | 'skipped-cap' | 'skipped-budget'
  category?: string
  result?: string
  error?: string
}

export interface SweepReport {
  dryRun: boolean
  scanned: number
  handled: number
  items: SweepItem[]
  costUsd: number
}

interface IssueRecord {
  number: number
  title: string
  body: string | null
  user: { login: string }
  labels?: Array<string | { name?: string }>
}

const labelNames = (issue: IssueRecord): string[] =>
  (issue.labels ?? []).map(l => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean)

async function setPlantLabel(
  pool: McpPool, owner: string, repo: string, issue: IssueRecord, label: string,
): Promise<void> {
  const keep = labelNames(issue).filter(l => !PLANT_LABELS.includes(l))
  await pool.callTool('playground', 'update_issue', {
    owner, repo, issue_number: issue.number, labels: [...keep, label],
  })
}

export async function sweepInbox(
  pool: McpPool,
  handlerGraph: SerializedGraph,
  opts: SweepOptions,
): Promise<SweepReport> {
  const dryRun = opts.dryRun ?? true
  const maxIssues = opts.maxIssues ?? 3
  const budgetUsd = opts.budgetUsd ?? 0.25
  const { owner, repo } = opts

  const raw = await pool.callTool('playground', 'list_issues', {
    owner, repo, state: 'open', per_page: 20,
  })
  const issues = JSON.parse(String(raw)) as IssueRecord[]

  const baselineCost = usageSummary().estimatedCost
  const items: SweepItem[] = []
  let handled = 0

  for (const issue of issues) {
    const base = { number: issue.number, title: issue.title }

    if (issue.user.login !== owner) {
      items.push({ ...base, action: 'skipped-stranger' })
      continue
    }
    if (labelNames(issue).some(l => PLANT_LABELS.includes(l))) {
      items.push({ ...base, action: 'skipped-labeled' })
      continue
    }
    if (handled >= maxIssues) {
      items.push({ ...base, action: 'skipped-cap' })
      continue
    }
    const spent = usageSummary().estimatedCost - baselineCost
    if (spent >= budgetUsd) {
      items.push({ ...base, action: 'skipped-budget' })
      continue
    }

    const handlerInputs = {
      issue: `TITLE: ${issue.title}\n\nBODY: ${issue.body ?? ''}`,
      dryRun,
      number: issue.number,
      codePath: `planted/issue-${issue.number}.js`,
      docPath: `proposals/issue-${issue.number}.md`,
      message: `inbox sweep: deliver #${issue.number}`,
      branch: 'main',
    }

    const events: NodeEvent[] = []
    try {
      // at-most-once: claim the issue before any work happens
      if (!dryRun) await setPlantLabel(pool, owner, repo, issue, 'plant:in-progress')

      const out = await executeSubgraph(
        handlerGraph, handlerInputs, pool, e => events.push(e), 0, true, undefined, SWEEP_ALLOWED_TOOLS,
      )
      const category = String(out.category ?? '').trim()
      const result = String(out.result ?? '')

      if (!dryRun) {
        const done = category === 'code_request' || category === 'proposal'
        await setPlantLabel(pool, owner, repo, issue, done ? 'plant:delivered' : 'plant:needs-human')
      }
      handled += 1
      items.push({ ...base, action: 'handled', category, result: result.slice(0, 200) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      handled += 1
      items.push({ ...base, action: 'failed', error: message })

      if (!dryRun) {
        // the failure leaves a receipt: label, error, and the drafted
        // regression test if one can be learned from the trace
        try {
          await setPlantLabel(pool, owner, repo, issue, 'plant:needs-human')
          const draft = draftTestFromTrace({ inputs: handlerInputs, outputs: {}, events }, handlerGraph)
          const draftSection = draft.drafted
            ? `\n\nDrafted regression test (${draft.reason}):\n\`\`\`json\n${JSON.stringify(draft.test, null, 2)}\n\`\`\``
            : ''
          await pool.callTool('playground', 'add_issue_comment', {
            owner, repo, issue_number: issue.number,
            body: `Inbox sweep could not deliver this issue.\n\n\`\`\`\n${message}\n\`\`\`${draftSection}\n\n*Labeled needs-human; no retry will be attempted.*`,
          })
        } catch { /* the report still records the failure */ }
      }
    }
  }

  return {
    dryRun,
    scanned: issues.length,
    handled,
    items,
    costUsd: usageSummary().estimatedCost - baselineCost,
  }
}

export function formatSweepReport(report: SweepReport): string {
  const lines = [
    `sweep ${report.dryRun ? '(dry-run)' : '(LIVE)'}: ${report.scanned} scanned, ${report.handled} handled, ${formatCost(report.costUsd)}`,
  ]
  for (const item of report.items) {
    const detail = item.category ? ` → ${item.category}` : item.error ? ` — ${item.error.slice(0, 80)}` : ''
    lines.push(`  #${item.number} ${item.action}${detail}  (${item.title.slice(0, 50)})`)
  }
  return lines.join('\n')
}
