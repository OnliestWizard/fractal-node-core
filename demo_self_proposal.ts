// The self-proposal loop — probability004's "ultimate self" joke, made real
// and contained by scope.
//
//   npx tsx demo_self_proposal.ts
//
// The system reads its own engine source through the read-wide GitHub
// channel, proposes ONE concrete next feature for itself, and files it as an
// issue in the sandbox — the write-narrow token means it can only ever
// PROPOSE, never touch its own code. Then the inbox side picks the proposal
// up and turns it into a committed prototype document, linked back on the
// issue. Both halves are planted skills, saved through the contract gate, so
// the library grows by two just by running this.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { McpPool } from './lib/mcp-pool'
import { executeSubgraph } from './lib/execute-engine'
import { plantGraph } from './lib/plant'
import { saveSkillThroughGate } from './lib/skill-gate'

const OWNER = process.env.PLAYGROUND_OWNER ?? ''
const REPO = process.env.PLAYGROUND_REPO ?? ''
const SOURCE_REPO = process.env.SOURCE_REPO ?? 'fractal-node-core'
if (!OWNER || !REPO) {
  console.error('Set PLAYGROUND_OWNER and PLAYGROUND_REPO in .env.local (a sandbox repo you own).')
  process.exit(1)
}

function beat(n: number, title: string) {
  console.log(`\n━━ ${n}. ${title} ${'━'.repeat(Math.max(2, 56 - title.length))}`)
}

async function readOwnFile(pool: McpPool, path: string): Promise<string> {
  const raw = await pool.callTool('github', 'get_file_contents', { owner: OWNER, repo: SOURCE_REPO, path })
  // server-github returns content already decoded; its encoding field lies
  return String(JSON.parse(String(raw)).content)
}

async function main() {
  const pool = new McpPool()
  await pool.connect()

  beat(1, 'READ SELF — the engine reads its own source')
  const source = [
    `=== README.md ===\n${await readOwnFile(pool, 'README.md')}`,
    `=== probability003.md (design direction) ===\n${await readOwnFile(pool, 'probability003.md')}`,
    `=== lib/execute-engine.ts (the engine) ===\n${await readOwnFile(pool, 'lib/execute-engine.ts')}`,
  ].join('\n\n')
  console.log(`  read ${source.length} chars of own source via the read-wide channel`)

  beat(2, 'PROPOSE — plant the self_proposer skill, gate it, run it')
  const proposer = await plantGraph(
    "Create a graph with one input port 'source'. Use a draft_writer node whose 'system' input is wired from a literal node containing: " +
    "'You are the design mind of the graph-execution system whose source you are reading. Propose exactly ONE concrete, small next feature for it. " +
    "First line: an issue title starting with Proposal: — then a blank line, then the issue body in markdown with three sections: " +
    "Motivation (grounded in specifics you saw in the source), Design sketch (data shapes and where it hooks into the engine), " +
    "and Prototype deliverable (what a prototype document should contain). Be specific to THIS codebase, never generic.' " +
    "Wire source to draft_writer's prompt. Output draft_writer's response as 'proposal'.",
  )
  proposer.description = 'Read system source text and propose one concrete next feature as an issue (title on first line, markdown body).'
  proposer.tests = [{ name: 'produces a proposal', inputs: { source: 'contract probe' }, expect: [{ port: 'proposal', exists: true }] }]
  const gateA = await saveSkillThroughGate('self_proposer', proposer, pool)
  console.log(`  → self_proposer: saved=${gateA.saved} tested=${gateA.tested} version=${gateA.version ?? gateA.refusal}`)
  if (!gateA.saved) throw new Error('self_proposer failed its contract')

  const proposed = await executeSubgraph(proposer, { source }, pool)
  const proposal = String(proposed.proposal ?? '')
  const [titleLine, ...rest] = proposal.split('\n')
  const title = titleLine.trim().replace(/^#+\s*/, '')
  const body = rest.join('\n').trim() +
    `\n\n---\n*Filed by the \`self_proposer\` skill after reading its own engine source (${SOURCE_REPO}). ` +
    'The write token is scoped to this sandbox: the system can propose its evolution, not perform it.*'
  console.log(`  proposal: ${title}`)

  beat(3, 'FILE — the proposal becomes a sandbox issue')
  const issueRaw = await pool.callTool('playground', 'create_issue', { owner: OWNER, repo: REPO, title, body })
  const issue = JSON.parse(String(issueRaw))
  console.log(`  → issue #${issue.number}: ${issue.html_url}`)

  beat(4, 'INBOX — plant the inbox_worker skill, gate it, process the issue')
  const worker = await plantGraph(
    "Create a graph with input ports 'proposal', 'path', 'message', and 'branch'. Use a draft_writer node whose 'system' input is wired from a literal node containing: " +
    "'You are the prototyping engineer for a graph-execution system. Turn the given design proposal into a concrete prototype document in markdown: " +
    "one paragraph restating the feature, a Design section with data shapes and engine hook points, and an Example section with code or graph JSON for the core piece. Concrete and brief.' " +
    "Wire proposal to draft_writer's prompt. Then use the playground_writer library skill to publish the document: wire path, message and branch from the inputs, " +
    "and draft_writer's response to content. Output playground_writer's result as 'result'.",
  )
  worker.description = 'Turn a design proposal into a prototype markdown document and commit it to the sandbox repo.'
  worker.tests = [{
    name: 'publishes a prototype to the requested path',
    inputs: { proposal: 'contract probe: a trivial feature sketch', path: 'proposals/contract-probe.md', message: 'graph CI: inbox_worker contract probe', branch: 'main' },
    expect: [{ port: 'result', contains: 'proposals/contract-probe.md' }],
  }]
  const gateB = await saveSkillThroughGate('inbox_worker', worker, pool)
  console.log(`  → inbox_worker: saved=${gateB.saved} tested=${gateB.tested} version=${gateB.version ?? gateB.refusal}`)
  if (!gateB.saved) throw new Error('inbox_worker failed its contract')

  const protoPath = `proposals/issue-${issue.number}.md`
  const processed = await executeSubgraph(worker, {
    proposal,
    path: protoPath,
    message: `prototype for proposal #${issue.number}`,
    branch: 'main',
  }, pool)
  const protoUrl = JSON.parse(String(processed.result)).content.html_url
  console.log(`  → prototype committed: ${protoUrl}`)

  beat(5, 'CLOSE THE LOOP — comment links the artifact to the proposal')
  await pool.callTool('playground', 'add_issue_comment', {
    owner: OWNER, repo: REPO, issue_number: issue.number,
    body: `Prototype document committed by the \`inbox_worker\` skill: ${protoUrl}\n\n*A human decides whether this graduates out of the sandbox.*`,
  })
  console.log('  → commented on the issue')

  console.log(`\n━━ verdict ${'━'.repeat(49)}`)
  console.log(`  it read its own engine, proposed: "${title}"`)
  console.log(`  issue:     ${issue.html_url}`)
  console.log(`  prototype: ${protoUrl}`)
  console.log('  ambition, contained by scope.')

  await pool.close()
}

main().catch(err => { console.error(err); process.exit(1) })
