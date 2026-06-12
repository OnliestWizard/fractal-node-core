// Run one inbox sweep against the playground queue.
//
//   npx tsx sweep.ts                      # dry-run: triage + report, zero writes
//   npx tsx sweep.ts --live               # deliver, label, comment
//   npx tsx sweep.ts --live --max-issues 1 --budget 0.25
//
// The pulse calls this on a timer; by hand it is one beat of the heartbeat.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { McpPool } from './lib/mcp-pool'
import { loadGraph } from './lib/graph-store'
import { sweepInbox, formatSweepReport } from './lib/inbox-sweep'
import { loadConstitution, constitutionalPool } from './lib/constitution'

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
    console.error('issue_handler is not in the graph library — the sweep has nothing to run.')
    process.exit(1)
  }

  const rawPool = new McpPool()
  await rawPool.connect()

  const law = loadConstitution()
  const pool = law ? constitutionalPool(rawPool, law) : rawPool
  console.log(law
    ? `constitution active — ${law.protected.length} protected territories, ${law.guardedTools.length} guarded tools`
    : 'no constitution.json found — the unattended lane is running UNGOVERNED')

  const report = await sweepInbox(pool, handler, {
    owner,
    repo,
    dryRun: args.live !== true,
    maxIssues: typeof args['max-issues'] === 'string' ? Number(args['max-issues']) : undefined,
    budgetUsd: typeof args.budget === 'string' ? Number(args.budget) : undefined,
  })

  console.log(`\n${formatSweepReport(report)}`)
  await pool.close()
}

main().catch(err => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
