// The compounding chain — the missing demonstration named in probability003.
//
//   npx tsx demo_compounding_chain.ts
//
// Solve task A and save it as a tested skill; then give Plant a bigger task
// that never mentions the library and watch it compose the saved skills
// instead of rebuilding from leaf nodes. Ends with a real file on GitHub
// written through two layers of library composition.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { executeSubgraph, type NodeEvent } from './lib/execute-engine'
import { plantGraph } from './lib/plant'
import { listGraphs } from './lib/graph-store'
import type { SerializedGraph } from './core/serializer'

// Your sandbox repo — see .env.example. The publish step writes here.
const OWNER = process.env.PLAYGROUND_OWNER ?? ''
const REPO = process.env.PLAYGROUND_REPO ?? ''
if (!OWNER || !REPO) {
  console.error('Set PLAYGROUND_OWNER and PLAYGROUND_REPO in .env.local (a sandbox repo you own).')
  process.exit(1)
}
const SKILL_NAME = 'haiku_writer'

function beat(n: number, title: string) {
  console.log(`\n━━ ${n}. ${title} ${'━'.repeat(Math.max(2, 56 - title.length))}`)
}

// Which library graphs does this graph compose? Skills are nodes now —
// detected by dispatch id; the load_graph + literal mechanism also counts.
function composedSkills(graph: SerializedGraph): string[] {
  const library = new Set(listGraphs())
  const found = new Set<string>()
  const usesLoad = graph.nodes.some(n => (n.builtin ?? n.id) === 'load_graph')
  for (const node of graph.nodes) {
    const dispatchId = node.builtin ?? node.id
    if (library.has(dispatchId)) found.add(dispatchId)
    const lit = node.constraints?.literal
    if (usesLoad && typeof lit === 'string' && library.has(lit)) found.add(lit)
  }
  return [...found]
}

async function main() {
  const pool = new McpPool()
  await pool.connect()

  beat(1, 'SKILL — plant task A from one sentence')
  const skill = await plantGraph(
    "Create a graph with one input port 'topic'. Use a draft_writer node whose 'system' input is wired from a literal node containing: " +
    "'You are a haiku poet. Respond with ONLY a haiku — three lines, 5-7-5 syllables — about the given topic. No explanations.' " +
    "Wire topic to draft_writer's prompt. Output draft_writer's response as 'haiku'.",
  )
  skill.description = 'Write a haiku about a topic. Returns the haiku text.'
  skill.tests = [{
    name: 'produces a haiku',
    inputs: { topic: 'contract probe' },
    expect: [{ port: 'haiku', exists: true }],
  }]
  console.log(`  planted ${skill.nodes.length}-node graph, contract test + description attached`)

  beat(2, 'GATE — save the skill through graph CI')
  const saveWrapper: SerializedGraph = {
    nodes: [
      { id: '$input', inputs: [], outputs: [{ id: 'graph', type: 'object' }] },
      { id: 'name_const', inputs: [], outputs: [{ id: 'value', type: 'string' }], constraints: { literal: SKILL_NAME } },
      { id: 'save_graph', inputs: [{ id: 'name', type: 'string' }, { id: 'graph', type: 'object' }], outputs: [{ id: 'saved', type: 'boolean' }, { id: 'version', type: 'string' }, { id: 'tested', type: 'number' }] },
      { id: '$output', inputs: [{ id: 'saved', type: 'boolean' }, { id: 'version', type: 'string' }, { id: 'tested', type: 'number' }], outputs: [] },
    ],
    edges: [
      { from: { nodeId: 'name_const', portId: 'value' }, to: { nodeId: 'save_graph', portId: 'name' } },
      { from: { nodeId: '$input', portId: 'graph' }, to: { nodeId: 'save_graph', portId: 'graph' } },
      { from: { nodeId: 'save_graph', portId: 'saved' }, to: { nodeId: '$output', portId: 'saved' } },
      { from: { nodeId: 'save_graph', portId: 'version' }, to: { nodeId: '$output', portId: 'version' } },
      { from: { nodeId: 'save_graph', portId: 'tested' }, to: { nodeId: '$output', portId: 'tested' } },
    ],
  }
  const saved = await executeSubgraph(saveWrapper, { graph: skill }, pool)
  console.log(`  → saved=${saved.saved} tested=${saved.tested} version=${saved.version}`)
  if (!saved.saved) throw new Error('skill failed its contract — chain aborted')

  beat(3, 'COMPOSE — task B never mentions the library')
  const taskB =
    `Write a haiku about recursion and publish it to the ${REPO} GitHub repository ` +
    "as the file 'planted/recursion-haiku.md' with commit message 'a planted haiku' on branch 'main'. " +
    'Output the publish result as \'result\'.'
  console.log(`  task: ${taskB}`)
  const graphB = await plantGraph(taskB)
  writeFileSync('demo_chain_graphB.json', JSON.stringify(graphB, null, 2))
  const composed = composedSkills(graphB)
  console.log(`  → Plant composed library skills: ${composed.length ? composed.join(', ') : 'NONE (built from leaf nodes)'}`)

  beat(4, 'RUN — execute the composition')
  // Plant may bake the task's constants in as literals or expose them as
  // $input ports — supply them either way, like any real caller would.
  const taskInputs = {
    topic: 'recursion',
    path: 'planted/recursion-haiku.md',
    message: 'a planted haiku',
    branch: 'main',
  }
  const events: NodeEvent[] = []
  const outputs = await executeSubgraph(graphB, taskInputs, pool, e => events.push(e))
  const subNodes = events.filter(e => e.type === 'complete' && e.depth > 0).length
  console.log(`  → graph B id=${graphB.id}, ${subNodes} child-graph node completions at depth>0`)

  beat(5, 'VERIFY — the haiku is on GitHub')
  let published = false
  try {
    const raw = await pool.callTool('github', 'get_file_contents', {
      owner: OWNER, repo: REPO, path: 'planted/recursion-haiku.md',
    })
    const file = JSON.parse(String(raw))
    published = Boolean(file.content)
    console.log(`  planted/recursion-haiku.md:\n${String(file.content).split('\n').map(l => `    ${l}`).join('\n')}`)
  } catch {
    console.log('  planted/recursion-haiku.md NOT FOUND — publish failed')
  }

  console.log(`\n━━ verdict ${'━'.repeat(49)}`)
  console.log(`  skill saved through gate: ${saved.saved} (tested=${saved.tested})`)
  console.log(`  library skills composed in task B: ${composed.length ? composed.join(', ') : 'none'}`)
  console.log(`  artifact on GitHub: ${published}`)
  console.log(composed.length && published ? '  the library compounds.' : '  chain incomplete — see beats above.')

  await pool.close()
}

main().catch(err => { console.error(err); process.exit(1) })
