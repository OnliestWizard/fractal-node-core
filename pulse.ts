// The pulse — the heartbeat's timer. Runs inbox sweeps on an interval until
// stopped, a beat limit, or a total budget is hit. The sweep itself carries
// the per-beat rails (owner filter, labels, per-sweep budget, allowlist);
// the pulse adds time and a ceiling.
//
//   npx tsx pulse.ts                                # dry beats every 15m
//   npx tsx pulse.ts --once --live                  # one live beat, then exit
//   npx tsx pulse.ts --live --interval 10m --budget 0.25 --max-issues 2 --total-budget 1
//
// Beats never overlap: the next wait starts only after the sweep finishes.
// Stop with Ctrl+C — the current beat completes first (at-most-once labels
// mean a hard kill strands an issue as plant:in-progress for a human).

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { loadGraph } from './lib/graph-store'
import { sweepInbox, formatSweepReport } from './lib/inbox-sweep'
import { collectStatus, renderStatusMarkdown } from './lib/status-report'
import { fetchDeliveries, pushStatusFile } from './lib/status-push'
import { usageSummary, formatCost } from './lib/llm-usage'

function parseArgs(argv: string[]) {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[key] = argv[i + 1]
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

// "90s", "15m", "1h"; a bare number means minutes
function parseInterval(text: string): number {
  const m = /^(\d+)([smh])?$/.exec(text.trim())
  if (!m) {
    console.error(`Cannot parse interval "${text}" — use forms like 90s, 15m, 1h.`)
    process.exit(1)
  }
  const n = Number(m[1])
  return n * (m[2] === 's' ? 1_000 : m[2] === 'h' ? 3_600_000 : 60_000)
}

const stamp = () => new Date().toISOString().slice(11, 19)

let stopping = false
process.on('SIGINT', () => {
  if (stopping) process.exit(130) // second Ctrl+C: force quit
  stopping = true
  console.log('\npulse: finishing the current beat, then stopping (Ctrl+C again to force)…')
})

// interruptible wait — checks the stop flag every second
async function wait(ms: number) {
  const until = Date.now() + ms
  while (!stopping && Date.now() < until) {
    await new Promise(r => setTimeout(r, Math.min(1000, until - Date.now())))
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const owner = process.env.PLAYGROUND_OWNER ?? ''
  const repo = process.env.PLAYGROUND_REPO ?? ''
  if (!owner || !repo) {
    console.error('Set PLAYGROUND_OWNER and PLAYGROUND_REPO in .env.local (a sandbox repo you own).')
    process.exit(1)
  }

  const { graph: handler } = loadGraph('issue_handler')
  if (!handler) {
    console.error('issue_handler is not in the graph library — the pulse has nothing to run.')
    process.exit(1)
  }

  const live = args.live === true
  const intervalMs = parseInterval(typeof args.interval === 'string' ? args.interval : '15m')
  const maxBeats = args.once === true ? 1
    : typeof args.beats === 'string' ? Number(args.beats) : Infinity
  const totalBudgetUsd = typeof args['total-budget'] === 'string' ? Number(args['total-budget']) : 1.0
  const maxIssues = typeof args['max-issues'] === 'string' ? Number(args['max-issues']) : undefined
  const budgetUsd = typeof args.budget === 'string' ? Number(args.budget) : undefined

  console.log(`pulse: ${live ? 'LIVE' : 'dry-run'} · every ${Math.round(intervalMs / 1000)}s · total budget ${formatCost(totalBudgetUsd)}${maxBeats !== Infinity ? ` · ${maxBeats} beat(s)` : ''}`)

  const pool = new McpPool()
  await pool.connect()

  let beats = 0
  let delivered = 0
  while (!stopping && beats < maxBeats) {
    const spent = usageSummary().estimatedCost
    if (spent >= totalBudgetUsd) {
      console.log(`[${stamp()}] pulse: total budget reached (${formatCost(spent)}) — stopping.`)
      break
    }

    beats += 1
    try {
      const report = await sweepInbox(pool, handler, { owner, repo, dryRun: !live, maxIssues, budgetUsd })
      console.log(`[${stamp()}] beat ${beats} — ${formatSweepReport(report)}`)

      // the front page only changes when something was actually done
      if (live && report.handled > 0) {
        delivered += report.handled
        const deliveries = await fetchDeliveries(pool, owner, repo)
        const markdown = renderStatusMarkdown(collectStatus(), { deliveries })
        writeFileSync('STATUS.md', markdown)
        const url = await pushStatusFile(pool, owner, repo, markdown)
        console.log(`[${stamp()}] garden report refreshed: ${url ?? 'STATUS.md'}`)
      }
    } catch (err) {
      // a failed beat is logged and the pulse keeps beating
      console.error(`[${stamp()}] beat ${beats} failed: ${err instanceof Error ? err.message : err}`)
    }

    if (!stopping && beats < maxBeats) await wait(intervalMs)
  }

  console.log(`pulse: stopped after ${beats} beat(s), ${delivered} delivery(ies), ${formatCost(usageSummary().estimatedCost)} total.`)
  await pool.close()
}

main().catch(err => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
