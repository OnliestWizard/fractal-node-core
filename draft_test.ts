// Draft a contract test from a failed trace — the failure-becomes-a-test loop.
//
//   npx tsx draft_test.ts --trace bad_trace.json --graph graphs/skill.json
//   npx tsx draft_test.ts --trace bad_trace.json --graph graphs/skill.json --add
//   npx tsx draft_test.ts --trace bad_trace.json --expect-error
//
// Prints the drafted GraphTestCase for review. --add appends it to the graph
// file's "tests" array; the gate enforces it on the next save_graph.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { draftTestFromTrace } from './lib/test-draft'
import type { TraceFile } from './lib/trace-markdown'
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

function readJson<T>(path: string, what: string): T {
  if (!existsSync(path)) {
    console.error(`${what} not found: ${path}`)
    process.exit(1)
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.error(`${what} is not valid JSON (${path}): ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (typeof args.trace !== 'string') {
    console.error('Usage: npx tsx draft_test.ts --trace trace.json [--graph graphs/skill.json] [--expect-error] [--add]')
    process.exit(1)
  }

  const trace = readJson<TraceFile>(args.trace, 'Trace file')
  const graphPath = typeof args.graph === 'string' ? args.graph : undefined
  const graph = graphPath ? readJson<SerializedGraph>(graphPath, 'Graph file') : undefined

  const result = draftTestFromTrace(trace, graph, { expectError: args['expect-error'] === true })

  if (!result.drafted || !result.test) {
    console.error(`Nothing drafted: ${result.reason}`)
    process.exit(1)
  }

  console.log(`── drafted test (${result.reason}) ${'─'.repeat(20)}`)
  console.log(JSON.stringify(result.test, null, 2))

  if (args.add) {
    if (!graph || !graphPath) {
      console.error('\n--add needs --graph so the test has a suite to join.')
      process.exit(1)
    }
    graph.tests = [...(graph.tests ?? []), result.test]
    writeFileSync(graphPath, JSON.stringify(graph, null, 2))
    console.log(`\nappended to ${graphPath} (${graph.tests.length} test(s) total) — the gate enforces it on the next save_graph`)
  } else {
    console.log('\nreview it, then re-run with --add to append it to the graph file.')
  }
}

try {
  main()
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
