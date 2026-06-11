// Push the garden report to the playground — shared by generate_status.ts
// (manual) and pulse.ts (after a delivering beat). Stays out of
// status-report.ts so that module remains pure of MCP.

import type { McpPool } from './mcp-pool'
import type { DeliveryLine } from './status-report'

// Two attempts: the first call to a lazy pool can lose to an npx cold-start
// timeout; the pool retries the connect, so a second try usually lands.
export async function fetchDeliveries(pool: McpPool, owner: string, repo: string): Promise<DeliveryLine[]> {
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

export async function pushStatusFile(
  pool: McpPool, owner: string, repo: string, content: string,
): Promise<string | undefined> {
  // create_or_update_file needs the current blob sha when the file exists
  let sha: string | undefined
  try {
    const raw = await pool.callTool('playground', 'get_file_contents', { owner, repo, path: 'STATUS.md' })
    sha = (JSON.parse(String(raw)) as { sha?: string }).sha
  } catch { /* new file */ }

  const result = await pool.callTool('playground', 'create_or_update_file', {
    owner, repo, path: 'STATUS.md', content,
    message: 'garden report: regenerate STATUS.md',
    branch: 'main',
    ...(sha ? { sha } : {}),
  })
  return (JSON.parse(String(result)) as { content?: { html_url?: string } }).content?.html_url
}
