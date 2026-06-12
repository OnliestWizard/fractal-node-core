// Margins CLI — annotate a commit without rewriting history (git notes).
//
//   npx tsx annotate.ts -m "this version turned out to be wrong" [--target a398492] [--kind correction] [--about graphs/haiku_writer.json]
//   npx tsx annotate.ts --list
//   npx tsx annotate.ts --render [--out ANNOTATIONS.md]
//   npx tsx annotate.ts --push | --pull
//
// Notes live in refs/notes/plant and do NOT travel with normal push/fetch —
// share the margins explicitly with --push / --pull.

import { writeFileSync } from 'fs'
import {
  addAnnotation,
  listAnnotated,
  renderAnnotationsMarkdown,
  syncNotes,
  NOTES_REF,
} from './lib/annotations'

function parseArgs(argv: string[]) {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    let key: string
    if (argv[i] === '-m') key = 'message'
    else if (argv[i].startsWith('--')) key = argv[i].slice(2)
    else continue
    if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
      out[key] = argv[i + 1]
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

const USAGE = `Usage:
  npx tsx annotate.ts -m "message" [--target HEAD] [--kind note|verdict|correction|context] [--about path-or-skill]
  npx tsx annotate.ts --list
  npx tsx annotate.ts --render [--out ANNOTATIONS.md]
  npx tsx annotate.ts --push | --pull   (notes don't travel with normal push/fetch)`

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.push === true || args.pull === true) {
    const direction = args.push === true ? 'push' : 'pull'
    syncNotes(direction)
    console.log(`${direction === 'push' ? 'pushed' : 'pulled'} ${NOTES_REF} ${direction === 'push' ? 'to' : 'from'} origin`)
    return
  }

  if (args.list === true) {
    const commits = listAnnotated()
    if (commits.length === 0) {
      console.log('no annotations yet — add one with: npx tsx annotate.ts -m "..."')
      return
    }
    for (const c of commits) {
      console.log(`${c.shortSha} ${c.subject} (${c.date.slice(0, 10)})`)
      for (const a of c.annotations) {
        const stamp = [a.ts?.slice(0, 16).replace('T', ' '), a.author].filter(Boolean).join(', ')
        console.log(`  • [${a.kind ?? 'note'}]${a.about ? ` re ${a.about}` : ''}${stamp ? ` (${stamp})` : ''} ${a.message}`)
      }
    }
    return
  }

  if (args.render === true) {
    const out = typeof args.out === 'string' ? args.out : 'ANNOTATIONS.md'
    const markdown = renderAnnotationsMarkdown(listAnnotated())
    writeFileSync(out, markdown)
    console.log(`rendered the margins to ${out}`)
    return
  }

  if (typeof args.message !== 'string' || !args.message.trim()) {
    console.error(USAGE)
    process.exit(1)
  }

  const { sha, entry } = addAnnotation(args.message, {
    target: typeof args.target === 'string' ? args.target : undefined,
    kind: typeof args.kind === 'string' ? args.kind : undefined,
    about: typeof args.about === 'string' ? args.about : undefined,
  })
  console.log(`annotated ${sha.slice(0, 7)} [${entry.kind}]${entry.about ? ` re ${entry.about}` : ''}: ${entry.message}`)
  console.log(`(stored in ${NOTES_REF} — share with --push, render with --render)`)
}

try {
  main()
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
