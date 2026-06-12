import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addAnnotation,
  readAnnotations,
  listAnnotated,
  renderAnnotationsMarkdown,
  syncNotes,
  NOTES_REF,
} from '../lib/annotations'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function commit(cwd: string, subject: string): string {
  writeFileSync(join(cwd, 'state.txt'), subject)
  git(cwd, 'add', 'state.txt')
  git(cwd, 'commit', '-q', '-m', subject)
  return git(cwd, 'rev-parse', 'HEAD')
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fractal-margins-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 'Margin Tester')
  git(dir, 'config', 'user.email', 'margins@test.local')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('addAnnotation / readAnnotations', () => {
  it('round-trips an annotation without changing the commit hash', () => {
    const sha = commit(dir, 'first')
    const { sha: annotated, entry } = addAnnotation('turned out fine', { kind: 'verdict', about: 'state.txt', cwd: dir })

    expect(annotated).toBe(sha)
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(sha) // history untouched
    expect(entry.author).toBe('Margin Tester')
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const read = readAnnotations('HEAD', dir)
    expect(read).toHaveLength(1)
    expect(read[0]).toMatchObject({ kind: 'verdict', about: 'state.txt', message: 'turned out fine', author: 'Margin Tester' })
  })

  it('appends — a second note never overwrites the first', () => {
    commit(dir, 'first')
    addAnnotation('initial impression', { cwd: dir })
    addAnnotation('later correction', { kind: 'correction', cwd: dir })

    const read = readAnnotations('HEAD', dir)
    expect(read.map(a => a.message)).toEqual(['initial impression', 'later correction'])
    expect(read[1].kind).toBe('correction')
  })

  it('annotates a past commit by sha while HEAD moves on', () => {
    const old = commit(dir, 'the then')
    commit(dir, 'the now')
    addAnnotation('hindsight about the then', { target: old, cwd: dir })

    expect(readAnnotations(old, dir)).toHaveLength(1)
    expect(readAnnotations('HEAD', dir)).toHaveLength(0)
  })

  it('tolerates hand-written (non-JSON) note lines as bare messages', () => {
    commit(dir, 'first')
    git(dir, 'notes', `--ref=${NOTES_REF}`, 'append', '-m', 'scribbled by hand')
    addAnnotation('structured entry', { cwd: dir })

    const read = readAnnotations('HEAD', dir)
    expect(read.map(a => a.message)).toEqual(['scribbled by hand', 'structured entry'])
    expect(read[0].kind).toBeUndefined()
  })

  it('returns [] for an un-annotated commit and rejects unknown targets', () => {
    commit(dir, 'first')
    expect(readAnnotations('HEAD', dir)).toEqual([])
    expect(() => addAnnotation('x', { target: 'not-a-ref', cwd: dir })).toThrow(/not a commit/)
    expect(() => addAnnotation('   ', { cwd: dir })).toThrow(/empty/)
  })
})

describe('listAnnotated', () => {
  it('returns annotated commits newest-first with subjects, skipping clean ones', { timeout: 30000 }, () => {
    const a = commit(dir, 'ancient')
    commit(dir, 'middle — never annotated')
    const c = commit(dir, 'recent')
    addAnnotation('note on ancient', { target: a, cwd: dir })
    addAnnotation('note on recent', { target: c, cwd: dir })

    const listed = listAnnotated(dir)
    expect(listed.map(e => e.subject)).toEqual(['recent', 'ancient'])
    expect(listed[0].sha).toBe(c)
    expect(listed[0].shortSha).toBe(c.slice(0, 7))
    expect(listed[1].annotations[0].message).toBe('note on ancient')
  })

  it('returns [] when the notes ref does not exist yet', () => {
    commit(dir, 'first')
    expect(listAnnotated(dir)).toEqual([])
  })
})

describe('renderAnnotationsMarkdown', () => {
  it('renders grouped notes with counts, kinds, and about links', () => {
    const sha = commit(dir, 'feijoa')
    addAnnotation('the haiku contract was too weak', { kind: 'correction', about: 'graphs/haiku_writer.json', cwd: dir })
    addAnnotation('second thought', { target: sha, cwd: dir })

    const md = renderAnnotationsMarkdown(listAnnotated(dir), { generatedAt: new Date('2026-06-12T10:00:00Z') })
    expect(md).toContain('**2 notes on 1 commit**')
    expect(md).toContain('rendered 2026-06-12 10:00 UTC')
    expect(md).toContain(`\`${sha.slice(0, 7)}\` feijoa`)
    expect(md).toContain('**correction**')
    expect(md).toContain('re `graphs/haiku_writer.json`')
    expect(md).toContain('the haiku contract was too weak')
  })

  it('renders an honest empty state', () => {
    const md = renderAnnotationsMarkdown([], { generatedAt: new Date('2026-06-12T10:00:00Z') })
    expect(md).toContain('**0 notes on 0 commits**')
    expect(md).toContain('no annotations yet')
  })

  it('flattens multi-line messages so list items stay list items', () => {
    commit(dir, 'first')
    addAnnotation('line one\nline two', { cwd: dir })
    const md = renderAnnotationsMarkdown(listAnnotated(dir))
    expect(md).toContain('line one line two')
  })
})

describe('syncNotes', () => {
  it('pushes and pulls the notes ref through a bare remote', { timeout: 30000 }, () => {
    const remote = mkdtempSync(join(tmpdir(), 'fractal-margins-remote-'))
    const clone = mkdtempSync(join(tmpdir(), 'fractal-margins-clone-'))
    try {
      git(remote, 'init', '-q', '--bare')
      git(dir, 'remote', 'add', 'origin', remote)
      commit(dir, 'shared history')
      git(dir, 'push', '-q', 'origin', 'HEAD:main')
      addAnnotation('travels explicitly', { cwd: dir })

      syncNotes('push', 'origin', dir)
      expect(git(dir, 'ls-remote', remote, NOTES_REF)).toContain(NOTES_REF)

      git(clone, 'clone', '-q', remote, '.')
      expect(listAnnotated(clone)).toEqual([]) // notes don't travel with clone
      syncNotes('pull', 'origin', clone)
      expect(listAnnotated(clone)[0].annotations[0].message).toBe('travels explicitly')
    } finally {
      rmSync(remote, { recursive: true, force: true })
      rmSync(clone, { recursive: true, force: true })
    }
  })
})
