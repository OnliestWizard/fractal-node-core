// The spec-to-tested-code service — file an issue with a function spec and
// test cases; the system writes the code in a judge loop, verifies it
// against the spec's own tests, commits it, and reports back with evidence.
//
//   npx tsx demo_code_service.ts
//
// Under the hood this composes the library across its whole history: the
// OLDEST skill (code_improve, the original write/judge/run_js while-loop)
// dispatched through the NEWEST mechanism (skills-as-nodes) — a while-loop
// skill running inside library dispatch, plus run_js re-verification of the
// delivered code and playground_writer for the commit. Every delivery ships
// with its test results.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { McpPool } from './lib/mcp-pool'
import { executeSubgraph } from './lib/execute-engine'
import { plantGraph } from './lib/plant'
import { saveSkillThroughGate } from './lib/skill-gate'

const OWNER = process.env.PLAYGROUND_OWNER ?? ''
const REPO = process.env.PLAYGROUND_REPO ?? ''
if (!OWNER || !REPO) {
  console.error('Set PLAYGROUND_OWNER and PLAYGROUND_REPO in .env.local (a sandbox repo you own).')
  process.exit(1)
}

function beat(n: number, title: string) {
  console.log(`\n━━ ${n}. ${title} ${'━'.repeat(Math.max(2, 56 - title.length))}`)
}

// The "customer" spec — deliberately edge-casey so the judge loop has work.
const SPEC = {
  problem:
    'Write a JavaScript function parseDuration(str) that converts a duration string into milliseconds. ' +
    'It must support hours, minutes and seconds in combination, e.g. "2h", "90s", "1h30m", "2h15m30s". ' +
    'Throw an Error for strings that contain no valid duration parts (e.g. "abc", "").',
  tests: [
    { args: ['2h'], expected: 7200000 },
    { args: ['90s'], expected: 90000 },
    { args: ['1h30m'], expected: 5400000 },
    { args: ['45m'], expected: 2700000 },
    { args: ['2h15m30s'], expected: 8130000 },
    { args: ['abc'], expectError: true },
    { args: [''], expectError: true },
  ],
}

async function main() {
  const pool = new McpPool()
  await pool.connect()

  beat(1, 'FILE — a customer files a spec with test cases')
  const issueBody =
    'Requesting a tested implementation.\n\n' +
    '```json\n' + JSON.stringify(SPEC, null, 2) + '\n```\n\n' +
    '*Deliveries must include test results.*'
  const issueRaw = await pool.callTool('playground', 'create_issue', {
    owner: OWNER, repo: REPO, title: 'Code request: parseDuration(str) → milliseconds', body: issueBody,
  })
  const issue = JSON.parse(String(issueRaw))
  console.log(`  → issue #${issue.number}: ${issue.html_url}`)

  beat(2, 'READ — the system reads the spec back off the issue')
  const fetchedRaw = await pool.callTool('playground', 'get_issue', {
    owner: OWNER, repo: REPO, issue_number: issue.number,
  })
  const fetched = JSON.parse(String(fetchedRaw))
  const jsonBlock = String(fetched.body).match(/```json\s*([\s\S]*?)```/)
  if (!jsonBlock) throw new Error('no spec block found on the issue')
  const spec = JSON.parse(jsonBlock[1]) as typeof SPEC
  console.log(`  parsed spec: ${spec.tests.length} test cases`)

  beat(3, 'FORGE — plant the code_smith skill, gate it')
  const smith = await plantGraph(
    "Create a graph with input ports 'problem', 'system', 'tests', 'path', 'message', and 'branch'. " +
    'First use the code_improve library skill: wire problem, system and tests to its inputs. ' +
    "Then use the run_js builtin to verify the final code: wire code_improve's code output to run_js's code input, and tests to run_js's tests input. " +
    "Then use the playground_writer library skill to publish the code: wire path, message and branch from the inputs, and code_improve's code output to content. " +
    "Output code_improve's code as 'code', run_js's summary as 'summary', run_js's allPassed as 'allPassed', and playground_writer's result as 'result'.",
  )
  smith.description = 'Write code for a problem with a judge loop, verify it against the given tests, commit it to the sandbox, and return the code with its test evidence.'
  smith.tests = [{
    name: 'delivers working code to the requested path',
    inputs: {
      problem: 'Write a function add(a, b) that returns the sum of a and b.',
      system: 'Return only the JavaScript function, no explanations or markdown.',
      tests: [{ args: [1, 2], expected: 3 }, { args: [-1, 1], expected: 0 }],
      path: 'planted/contract-probe-add.js',
      message: 'graph CI: code_smith contract probe',
      branch: 'main',
    },
    expect: [
      { port: 'allPassed', equals: true },
      { port: 'result', contains: 'planted/contract-probe-add.js' },
    ],
  }]
  const gate = await saveSkillThroughGate('code_smith', smith, pool)
  console.log(`  → code_smith: saved=${gate.saved} tested=${gate.tested} version=${gate.version ?? gate.refusal}`)
  if (!gate.saved) throw new Error('code_smith failed its contract')

  beat(4, 'RUN — while-loop skill inside library dispatch')
  const delivered = await executeSubgraph(smith, {
    problem: spec.problem,
    system: 'Return only the JavaScript function, no explanations or markdown.',
    tests: spec.tests,
    path: 'planted/parse-duration.js',
    message: `deliver #${issue.number}: parseDuration`,
    branch: 'main',
  }, pool)
  const codeUrl = JSON.parse(String(delivered.result)).content.html_url
  console.log(`  → allPassed=${delivered.allPassed}`)
  console.log(`  → committed: ${codeUrl}`)

  beat(5, 'DELIVER — evidence back on the issue')
  await pool.callTool('playground', 'add_issue_comment', {
    owner: OWNER, repo: REPO, issue_number: issue.number,
    body:
      `Delivered by the \`code_smith\` skill: ${codeUrl}\n\n` +
      `**Verification against your test cases:** ${delivered.allPassed ? 'ALL PASSING ✓' : 'FAILURES — see below'}\n\n` +
      '```\n' + String(delivered.summary) + '\n```\n\n' +
      '*Written in a write/judge loop, re-verified after delivery. The test results above ran against the exact committed code.*',
  })
  console.log('  → commented with test evidence')

  console.log(`\n━━ verdict ${'━'.repeat(49)}`)
  console.log(`  spec issue:  ${issue.html_url}`)
  console.log(`  delivery:    ${codeUrl}`)
  console.log(`  test report: allPassed=${delivered.allPassed} — ${String(delivered.summary).slice(0, 80)}`)
  console.log('  every delivery ships with receipts.')

  await pool.close()
}

main().catch(err => { console.error(err); process.exit(1) })
