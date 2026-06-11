// Render a saved trace JSON as a markdown replay receipt.
//
//   npx tsx render_trace.ts --trace playground_issue_trace.json
//   npx tsx render_trace.ts --trace trace.json --out docs/run.md --title "issue write"
//
// Default output path is the trace path with .json → .md, ready to commit
// next to the delivery it documents.

import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import { renderTraceMarkdown, type TraceFile } from './lib/trace-markdown'

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      out[argv[i].slice(2)] = argv[i + 1]
      i++
    }
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.trace) {
    console.error('Usage: npx tsx render_trace.ts --trace trace.json [--out trace.md] [--title "..."]')
    process.exit(1)
  }

  const trace = JSON.parse(readFileSync(args.trace, 'utf8')) as TraceFile
  const outPath = args.out ?? args.trace.replace(/\.json$/i, '.md')

  const markdown = renderTraceMarkdown(trace, {
    title: args.title,
    source: basename(args.trace),
  })
  writeFileSync(outPath, markdown)

  const events = trace.events?.length ?? 0
  console.log(`rendered ${args.trace} (${events} events) → ${outPath}`)
}

main()
