// Forensics CLI — find the commit where a graph started failing (or passing)
// contract tests, without touching the working tree.
//
//   npx tsx bisect.ts --graph graphs/haiku_writer.json                  # first commit failing TODAY's tests
//   npx tsx bisect.ts --graph graphs/skill.json --find fix              # first commit that PASSES
//   npx tsx bisect.ts --graph graphs/skill.json --tests historical      # judge each version by its own tests
//   npx tsx bisect.ts --graph graphs/skill.json --good 188881f --bad HEAD --annotate
//
// Probes read each historical version via `git show` and run it with the
// CURRENT engine. --annotate writes the verdict into the margins (git notes)
// on the culprit commit. Contract tests on LLM-bearing skills run those nodes
// for real — each probe costs what one gated save costs.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { existsSync, readFileSync } from 'fs'
import { McpPool } from './lib/mcp-pool'
import { runGraphTests } from './lib/execute-engine'
import { addAnnotation } from './lib/annotations'
import {
  listFileCommits,
  sliceRange,
  bisectFile,
  makeContractVerdict,
  type FileCommit,
} from './lib/bisect'
import type { SerializedGraph } from './core/serializer'

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

const USAGE = `Usage: npx tsx bisect.ts --graph graphs/skill.json
  [--find break|fix]        hunt the first failing version (default) or the first passing one
  [--tests head|historical] judge history by today's tests (default) or each version's own
  [--good sha] [--bad sha]  bracket the search (shas that touched the file)
  [--annotate]              write the verdict into the margins on the culprit commit`

const glyph = (v: string) => (v === 'good' ? '✓' : v === 'bad' ? '✗' : '−')
const line = (c: FileCommit) => `${c.shortSha} ${c.subject} (${c.date.slice(0, 10)})`

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (typeof args.graph !== 'string') {
    console.error(USAGE)
    process.exit(1)
  }
  const path = args.graph
  const find = args.find === 'fix' ? 'fix' : 'break'
  const testsFrom = args.tests === 'historical' ? 'historical' : 'head'

  const commits = sliceRange(
    listFileCommits(path),
    typeof args.good === 'string' ? args.good : undefined,
    typeof args.bad === 'string' ? args.bad : undefined,
  )
  if (commits.length === 0) {
    console.error(`No commits have touched ${path} — is it tracked?`)
    process.exit(1)
  }

  let headTests
  if (testsFrom === 'head') {
    if (!existsSync(path)) {
      console.error(`${path} not found in the working tree — pass --tests historical to judge versions by their own tests`)
      process.exit(1)
    }
    const current = JSON.parse(readFileSync(path, 'utf8')) as SerializedGraph
    headTests = current.tests
    if (!headTests || headTests.length === 0) {
      console.error(`${path} carries no contract tests today — add tests (draft_test.ts can help) or use --tests historical`)
      process.exit(1)
    }
  }

  console.log(`\n── bisect: first ${find === 'break' ? 'failing' : 'passing'} version of ${path} ` +
    `(${testsFrom === 'head' ? "today's tests" : 'own tests'}, ${commits.length} candidate commit${commits.length === 1 ? '' : 's'}) ${'─'.repeat(8)}`)

  const pool = new McpPool()
  await pool.connect()
  try {
    const verdict = makeContractVerdict({
      testsFrom,
      headTests,
      runner: g => runGraphTests(g, pool),
    })

    const result = await bisectFile(path, commits, verdict, {
      find,
      onProbe: p => console.log(`  ${glyph(p.verdict)} ${line(p.commit)}`),
    })

    console.log('')
    if (result.kind === 'no-transition') {
      console.log(`nothing to find: no probed version of ${path} is ${find === 'break' ? 'failing' : 'passing'} in this range.`)
    } else if (result.kind === 'inconclusive') {
      const u = result.uncertain!
      console.log(`inconclusive — untestable versions block the boundary.`)
      console.log(`  last ${find === 'break' ? 'passing' : 'failing'}: ${line(u.before)}`)
      console.log(`  first ${find === 'break' ? 'failing' : 'passing'}: ${line(u.after)}`)
      console.log(`  skipped between them: ${u.skipped.map(c => c.shortSha).join(', ') || '(none)'}`)
    } else {
      const culprit = result.culprit!
      if (result.kind === 'from-birth') {
        console.log(`${find === 'break' ? 'failing' : 'passing'} from birth — the oldest testable version already ${find === 'break' ? 'fails' : 'passes'}:`)
      } else {
        console.log(`found it — first ${find === 'break' ? 'failing' : 'passing'} version:`)
      }
      console.log(`  ${line(culprit)}`)
      if (result.before) {
        console.log(`  last ${find === 'break' ? 'passing' : 'failing'} before it: ${line(result.before)}`)
        console.log(`  see what changed: git diff ${result.before.shortSha} ${culprit.shortSha} -- ${path}`)
      }
      console.log(`  (${result.probes.length} probes over ${result.candidates} candidates)`)

      if (args.annotate === true) {
        const message = `bisect: first version that ${find === 'break' ? 'fails' : 'passes'} ` +
          `${testsFrom === 'head' ? "today's" : 'its own'} contract tests` +
          `${result.before ? ` (last ${find === 'break' ? 'passing' : 'failing'}: ${result.before.shortSha})` : ''} — ` +
          `${result.probes.length} probes over ${result.candidates} candidates.`
        addAnnotation(message, { target: culprit.sha, kind: 'forensics', about: path })
        console.log(`  margin written on ${culprit.shortSha} [forensics] — share with annotate.ts --push, render with --render`)
      }
    }
  } finally {
    await pool.close()
  }
}

main().catch(err => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
