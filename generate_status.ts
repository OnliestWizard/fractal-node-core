// Regenerate the garden report (STATUS.md) from the graph library on disk.
//
//   npx tsx generate_status.ts                  # write STATUS.md locally
//   npx tsx generate_status.ts --out path.md    # write elsewhere
//   npx tsx generate_status.ts --push           # also commit it to the playground
//
// --push pulls the playground's recent issues in as a deliveries section and
// commits the report via the write-scoped MCP server, so the playground's
// front page stays a live dashboard. Needs PLAYGROUND_OWNER/PLAYGROUND_REPO
// and GITHUB_PAT_WRITE in .env.local.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { collectStatus, renderStatusMarkdown, type DeliveryLine } from './lib/status-report'
import { fetchDeliveries, pushStatusFile } from './lib/status-push'

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
  const outPath = typeof args.out === 'string' ? args.out : 'STATUS.md'

  const report = collectStatus()

  let deliveries: DeliveryLine[] | undefined
  let pool: McpPool | undefined
  const owner = process.env.PLAYGROUND_OWNER ?? ''
  const repo = process.env.PLAYGROUND_REPO ?? ''

  if (args.push) {
    if (!owner || !repo) {
      console.error('Set PLAYGROUND_OWNER and PLAYGROUND_REPO in .env.local to push.')
      process.exit(1)
    }
    pool = new McpPool()
    await pool.connect()
    deliveries = await fetchDeliveries(pool, owner, repo)
  }

  const markdown = renderStatusMarkdown(report, { deliveries })
  writeFileSync(outPath, markdown)
  console.log(`wrote ${outPath}: ${report.skills.length} skills, ${report.recentSaves.length} recent saves${deliveries ? `, ${deliveries.length} deliveries` : ''}`)

  if (pool) {
    const url = await pushStatusFile(pool, owner, repo, markdown)
    console.log(`pushed to playground: ${url ?? `${owner}/${repo}/STATUS.md`}`)
    await pool.close()
  }
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\n${msg}`)
  if (/credentials|401|unauthorized/i.test(msg)) {
    console.error('Check GITHUB_PAT_WRITE in .env.local — the playground push needs a write-scoped token.')
  }
  process.exit(1)
})
