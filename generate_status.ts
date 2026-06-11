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

// Two attempts: the first call to a lazy pool can lose to an npx cold-start
// timeout; the pool retries the connect, so a second try usually lands.
async function fetchDeliveries(pool: McpPool, owner: string, repo: string): Promise<DeliveryLine[]> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await pool.callTool('playground', 'list_issues', {
        owner, repo, state: 'all', sort: 'updated', direction: 'desc', per_page: 5,
      })
      const issues = JSON.parse(String(raw)) as Array<{
        title: string; html_url: string; state: string; updated_at: string
      }>
      return issues.map(i => ({ title: i.title, url: i.html_url, state: i.state, updatedAt: i.updated_at }))
    } catch (err) {
      console.warn(`could not fetch deliveries (attempt ${attempt}/2): ${err}`)
    }
  }
  return []
}

async function pushToPlayground(pool: McpPool, owner: string, repo: string, path: string, content: string) {
  // create_or_update_file needs the current blob sha when the file exists
  let sha: string | undefined
  try {
    const raw = await pool.callTool('playground', 'get_file_contents', { owner, repo, path })
    sha = (JSON.parse(String(raw)) as { sha?: string }).sha
  } catch { /* new file */ }

  const result = await pool.callTool('playground', 'create_or_update_file', {
    owner, repo, path, content,
    message: 'garden report: regenerate STATUS.md',
    branch: 'main',
    ...(sha ? { sha } : {}),
  })
  const url = (JSON.parse(String(result)) as { content?: { html_url?: string } }).content?.html_url
  console.log(`pushed to playground: ${url ?? `${owner}/${repo}/${path}`}`)
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
    await pushToPlayground(pool, owner, repo, 'STATUS.md', markdown)
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
