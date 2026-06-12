// Margins — annotate history without rewriting it, via git notes.
//
// A note attaches to an existing commit AFTER the fact and never changes the
// commit's hash: the now comments on the then without overwriting it. The
// canonical store is the `refs/notes/plant` ref (kept separate from git's
// default notes namespace); each note holds one JSON entry per line, so
// annotations are append-only the same way the version history is.
//
// GitHub stopped displaying git notes in its UI, so the visible surface is
// rendered markdown (renderAnnotationsMarkdown → ANNOTATIONS.md), paper-
// dashboard style: the ref is the database, the markdown is the view.

import { execFileSync } from 'child_process'

export const NOTES_REF = 'refs/notes/plant'

export interface Annotation {
  /** ISO timestamp of when the note was written (not when the commit was made). */
  ts?: string
  /** Free-form category: 'note' | 'verdict' | 'correction' | 'context' | ... */
  kind?: string
  /** What the note concerns — a path, a skill name, a trace file. */
  about?: string
  author?: string
  message: string
}

export interface AnnotatedCommit {
  sha: string
  shortSha: string
  subject: string
  /** Committer date, ISO. */
  date: string
  annotations: Annotation[]
}

function git(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.toString().trim()
    throw new Error(stderr || (err instanceof Error ? err.message : String(err)))
  }
}

function resolveCommit(target: string, cwd?: string): string {
  try {
    return git(['rev-parse', '--verify', `${target}^{commit}`], cwd)
  } catch {
    throw new Error(`"${target}" is not a commit in this repository — pass a sha, branch, tag, or HEAD~n`)
  }
}

function parseEntries(raw: string): Annotation[] {
  const entries: Annotation[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        entries.push(parsed as Annotation)
        continue
      }
    } catch {
      // hand-written note line — keep it as a bare message
    }
    entries.push({ message: trimmed })
  }
  return entries
}

export interface AddAnnotationOptions {
  /** Commit-ish to annotate. Default HEAD. */
  target?: string
  kind?: string
  about?: string
  cwd?: string
}

/** Append one annotation to a commit's note. Returns the resolved sha and the
 *  entry as written. Never touches the commit itself. */
export function addAnnotation(message: string, opts: AddAnnotationOptions = {}): { sha: string; entry: Annotation } {
  if (!message.trim()) throw new Error('annotation message is empty')
  const sha = resolveCommit(opts.target ?? 'HEAD', opts.cwd)

  let author: string | undefined
  try {
    author = git(['config', 'user.name'], opts.cwd) || undefined
  } catch {
    author = undefined
  }

  const entry: Annotation = { ts: new Date().toISOString(), kind: opts.kind ?? 'note', message }
  if (opts.about) entry.about = opts.about
  if (author) entry.author = author

  git(['notes', `--ref=${NOTES_REF}`, 'append', '-m', JSON.stringify(entry), sha], opts.cwd)
  return { sha, entry }
}

/** All annotations on one commit, oldest first. Empty array when there are none. */
export function readAnnotations(target = 'HEAD', cwd?: string): Annotation[] {
  const sha = resolveCommit(target, cwd)
  try {
    return parseEntries(git(['notes', `--ref=${NOTES_REF}`, 'show', sha], cwd))
  } catch {
    return [] // no note on this commit (or no notes ref yet)
  }
}

/** Every annotated commit, newest commit first. */
export function listAnnotated(cwd?: string): AnnotatedCommit[] {
  let listing: string
  try {
    listing = git(['notes', `--ref=${NOTES_REF}`, 'list'], cwd)
  } catch {
    return [] // notes ref doesn't exist yet
  }
  if (!listing) return []

  const commits: AnnotatedCommit[] = []
  for (const line of listing.split('\n')) {
    const sha = line.trim().split(/\s+/)[1]
    if (!sha) continue
    const meta = git(['show', '-s', '--format=%H%x09%h%x09%cI%x09%s', sha], cwd).split('\t')
    commits.push({
      sha: meta[0],
      shortSha: meta[1],
      subject: meta[3] ?? '',
      date: meta[2] ?? '',
      annotations: readAnnotations(sha, cwd),
    })
  }
  commits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  return commits
}

/** Push or pull the notes ref. Notes don't travel with normal push/fetch, so
 *  sharing the margins is an explicit act. Pull only fast-forwards — diverged
 *  notes surface as an error rather than silently losing a side. */
export function syncNotes(direction: 'push' | 'pull', remote = 'origin', cwd?: string): void {
  if (direction === 'push') {
    git(['push', remote, NOTES_REF], cwd)
  } else {
    git(['fetch', remote, `${NOTES_REF}:${NOTES_REF}`], cwd)
  }
}

const minute = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim()

export interface AnnotationsRenderOptions {
  title?: string
  /** Injectable so renders are deterministic in tests. Defaults to now. */
  generatedAt?: Date
}

export function renderAnnotationsMarkdown(commits: AnnotatedCommit[], opts: AnnotationsRenderOptions = {}): string {
  const generatedAt = opts.generatedAt ?? new Date()
  const totalNotes = commits.reduce((n, c) => n + c.annotations.length, 0)

  const lines: string[] = []
  lines.push(`# ${opts.title ?? 'Margins — annotations on history'}`)
  lines.push('')
  lines.push(
    `**${totalNotes} note${totalNotes === 1 ? '' : 's'} on ${commits.length} commit${commits.length === 1 ? '' : 's'}** · ` +
    `rendered ${minute(generatedAt.toISOString())} UTC`,
  )
  lines.push('')
  lines.push(
    'Notes attach to commits after the fact without changing their hashes — the now',
    'comments on the then without overwriting it. Canonical store: `' + NOTES_REF + '`',
    '(git notes); GitHub no longer displays notes, so this file is the rendered',
    'surface. Regenerate with `npx tsx annotate.ts --render`.',
  )

  if (commits.length === 0) {
    lines.push('', '*no annotations yet — add one with `npx tsx annotate.ts -m "..."`*')
  }

  for (const c of commits) {
    lines.push('', `## \`${c.shortSha}\` ${oneLine(c.subject)} — ${c.date.slice(0, 10)}`, '')
    for (const a of c.annotations) {
      const when = a.ts ? minute(a.ts) : undefined
      const who = a.author
      const stamp = [when, who].filter(Boolean).join(', ')
      const about = a.about ? ` — re \`${oneLine(a.about)}\`` : ''
      lines.push(`- **${a.kind ?? 'note'}**${stamp ? ` (${stamp})` : ''}${about}: ${oneLine(a.message)}`)
    }
  }

  lines.push('', '---', '')
  lines.push('*Generated from the notes ref. The history these notes describe is immutable; the margins are not.*')
  lines.push('')
  return lines.join('\n')
}
