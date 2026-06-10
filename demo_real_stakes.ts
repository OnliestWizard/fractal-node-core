// The "real stakes" demo from probability001.md — autonomy with receipts.
//
//   npx tsx demo_real_stakes.ts
//
// One command, eight beats: Plant designs a GitHub-writing tool from a
// sentence; it's smoke-tested live, saved versioned with lineage; a careless
// edit hardcodes the target path and ships as v2; running v2 clobbers the
// repo README (real damage on a real repo); rollback restores the good tool
// in one call; the bad run replays from its trace at recorded pace; the
// restored tool repairs the damage it caused.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { executeSubgraph, type NodeEvent } from './lib/execute-engine'
import { plantGraph } from './lib/plant'
import { replayTrace } from './lib/replay'
import { saveGraph, loadGraph, listVersions, rollbackGraph } from './lib/graph-store'
import type { SerializedGraph } from './core/serializer'

// Your sandbox repo — the demo does real (recoverable) damage here.
// Set PLAYGROUND_OWNER / PLAYGROUND_REPO in .env.local; the write-scoped
// PAT behind the "playground" MCP server must match this repo.
const OWNER = process.env.PLAYGROUND_OWNER ?? ''
const REPO = process.env.PLAYGROUND_REPO ?? ''
if (!OWNER || !REPO) {
  console.error('Set PLAYGROUND_OWNER and PLAYGROUND_REPO in .env.local (a sandbox repo you own).')
  process.exit(1)
}
const TOOL_NAME = 'playground_writer'
const TRACE_FILE = 'demo_bad_trace.json'

const PLANT_TASK =
  "Create a graph with input ports 'path', 'content', 'message', and 'branch'. " +
  `It must create or update a file in the GitHub repository owned by '${OWNER}' named '${REPO}' ` +
  "using the playground__create_or_update_file tool. Use literal nodes for the owner and repo values " +
  'and for any pack keys. Pack all six parameters (owner, repo, path, content, message, branch) into ' +
  "one params object. Output the tool result as 'result'."

function beat(n: number, title: string) {
  console.log(`\n━━ ${n}. ${title} ${'━'.repeat(Math.max(2, 56 - title.length))}`)
}

async function readReadme(pool: McpPool): Promise<string> {
  const raw = await pool.callTool('github', 'get_file_contents', {
    owner: OWNER, repo: REPO, path: 'README.md',
  })
  const file = JSON.parse(String(raw))
  // server-github returns content already decoded; its encoding field is
  // stale ("base64" even after decoding) — do NOT decode again
  return String(file.content)
}

async function run(graph: SerializedGraph, inputs: Record<string, unknown>, pool: McpPool) {
  const events: NodeEvent[] = []
  const outputs = await executeSubgraph(graph, inputs, pool, e => events.push(e), 0, false, undefined, undefined)
  return { outputs, events }
}

function commitShaOf(outputs: Record<string, unknown>): string {
  try { return JSON.parse(String(outputs.result)).commit.sha.slice(0, 7) } catch { return '???????' }
}

// The careless edit: whoever "maintains" v2 hardcodes the path literal,
// so the tool ignores its path input and always writes README.md.
function sabotage(graph: SerializedGraph): SerializedGraph {
  const bad: SerializedGraph = JSON.parse(JSON.stringify(graph))
  const pathKey = bad.nodes.find(n => n.constraints?.literal === 'path')
  if (!pathKey) throw new Error('demo: planted graph has no "path" key literal')
  const keyEdge = bad.edges.find(e => e.from.nodeId === pathKey.id)
  if (!keyEdge || !/^key\d$/.test(keyEdge.to.portId)) throw new Error('demo: unexpected pack wiring')
  const valuePort = keyEdge.to.portId.replace('key', 'value')
  const valueEdge = bad.edges.find(e => e.to.nodeId === keyEdge.to.nodeId && e.to.portId === valuePort)
  if (!valueEdge) throw new Error('demo: no value edge feeding the path')
  bad.nodes.push({
    id: 'hardcoded_path',
    inputs: [],
    outputs: [{ id: 'value', type: 'string' }],
    constraints: { literal: 'README.md' },
  })
  valueEdge.from = { nodeId: 'hardcoded_path', portId: 'value' }
  return bad
}

async function main() {
  const pool = new McpPool()
  await pool.connect()

  const readmeOriginal = await readReadme(pool)
  console.log(`README.md before the demo: ${JSON.stringify(readmeOriginal)}`)

  beat(1, 'PLANT — design the tool from one sentence')
  const graph = await plantGraph(PLANT_TASK)
  console.log(`  Plant produced a valid ${graph.nodes.length}-node graph`)

  beat(2, 'TEST — run it once, harmlessly')
  const smoke = await run(graph, {
    path: 'planted/demo-smoke-test.md',
    content: `Smoke test of ${TOOL_NAME} before saving to the library. ${new Date().toISOString()}\n`,
    message: 'demo: smoke test of planted writer tool',
    branch: 'main',
  }, pool)
  console.log(`  wrote planted/demo-smoke-test.md (commit ${commitShaOf(smoke.outputs)})`)

  beat(3, 'SAVE — versioned, with lineage')
  const v1 = saveGraph(TOOL_NAME, graph)
  console.log(`  saved as "${TOOL_NAME}" version ${v1}`)
  console.log(`  lineage: id=${graph.id ?? '(unassigned)'} parentGraphId=${graph.parentGraphId ?? '(root)'}`)

  beat(4, 'BAD CHANGE — v2 hardcodes the target path')
  const badGraph = sabotage(graph)
  const v2 = saveGraph(TOOL_NAME, badGraph)
  console.log(`  saved sabotaged version ${v2}`)
  for (const v of listVersions(TOOL_NAME)) console.log(`    ${v.version}`)

  beat(5, 'DAMAGE — an innocent run of v2 clobbers README.md')
  const current = loadGraph(TOOL_NAME)
  if (!current.graph) throw new Error('demo: library lost the tool')
  const innocentInputs = {
    path: 'planted/notes/run-log.md', // what the caller asked for — v2 ignores it
    content: `run ${new Date().toISOString()}: 3 graphs executed, 0 errors\n`,
    message: 'append run log',
    branch: 'main',
  }
  const bad = await run(current.graph, innocentInputs, pool)
  writeFileSync(TRACE_FILE, JSON.stringify({ graph: `${TOOL_NAME}@${v2}`, inputs: innocentInputs, outputs: bad.outputs, events: bad.events }, null, 2))
  console.log(`  caller asked for: ${innocentInputs.path}`)
  console.log(`  README.md is now: ${JSON.stringify(await readReadme(pool))}`)
  console.log(`  (commit ${commitShaOf(bad.outputs)} — real damage, trace → ${TRACE_FILE})`)

  beat(6, 'ROLLBACK — one call')
  const rb = rollbackGraph(TOOL_NAME)
  console.log(`  restored=${rb.restored} → version ${rb.version}`)
  const restored = loadGraph(TOOL_NAME)
  const stillSabotaged = restored.graph?.nodes.some(n => n.id === 'hardcoded_path')
  console.log(`  current library copy contains the bad edit: ${stillSabotaged}`)

  beat(7, 'REPLAY — the receipts, at recorded pace')
  const summary = await replayTrace(bad.events, e => {
    const indent = '  '.repeat(e.depth + 1)
    if (e.type === 'start') console.log(`${indent}▶ ${e.nodeId}`)
    else if (e.type === 'complete') console.log(`${indent}✓ ${e.nodeId} (${Math.round(e.durationMs)}ms)`)
    else console.log(`${indent}✗ ${e.nodeId} — ${e.error}`)
  }, 1)
  console.log(`  ${summary.eventCount} events, ${summary.nodeCount} completed, ${summary.errorCount} errors, span ${summary.durationMs}ms`)

  beat(8, 'REPAIR — the restored tool undoes the damage')
  if (!restored.graph) throw new Error('demo: library lost the tool after rollback')
  const fix = await run(restored.graph, {
    path: 'README.md',
    content: readmeOriginal,
    message: 'demo: restore README clobbered by sabotaged v2 (rolled back)',
    branch: 'main',
  }, pool)
  const readmeNow = await readReadme(pool)
  console.log(`  README.md restored: ${readmeNow === readmeOriginal} (commit ${commitShaOf(fix.outputs)})`)

  console.log(`\n━━ done ${'━'.repeat(52)}`)
  console.log('  designed → tested → versioned → sabotaged → damaged → rolled back → replayed → repaired')
  console.log('  autonomy with receipts.')

  await pool.close()
}

main().catch(err => { console.error(err); process.exit(1) })
