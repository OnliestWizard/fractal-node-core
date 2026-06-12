import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  listFileCommits,
  showFileAt,
  sliceRange,
  bisectFile,
  makeContractVerdict,
  type FileCommit,
  type Verdict,
} from '../lib/bisect'
import type { GraphTestReport } from '../lib/graph-tests'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const PATH = 'graphs/skill.json'

function commitVersion(cwd: string, subject: string, content: string): string {
  writeFileSync(join(cwd, PATH), content)
  git(cwd, 'add', PATH)
  git(cwd, 'commit', '-q', '-m', subject)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** Commit a sequence of file states named v1..vN; content marks state. */
function history(cwd: string, states: string[]): string[] {
  return states.map((state, i) => commitVersion(cwd, `v${i + 1}`, state))
}

// Verdict by content marker — no engine, no network.
const markerVerdict = (content: string): Verdict =>
  content.includes('poisoned') ? 'bad' : content.includes('unreadable') ? 'skip' : 'good'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fractal-bisect-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 'Bisect Tester')
  git(dir, 'config', 'user.email', 'bisect@test.local')
  mkdirSync(join(dir, 'graphs'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('listFileCommits / showFileAt / sliceRange', () => {
  it('lists only commits touching the file, oldest first, and reads content at each', { timeout: 30000 }, () => {
    const v1 = commitVersion(dir, 'v1', 'clean one')
    writeFileSync(join(dir, 'other.txt'), 'unrelated')
    git(dir, 'add', 'other.txt')
    git(dir, 'commit', '-q', '-m', 'unrelated change')
    const v2 = commitVersion(dir, 'v2', 'clean two')

    const commits = listFileCommits(PATH, dir)
    expect(commits.map(c => c.subject)).toEqual(['v1', 'v2'])
    expect(commits.map(c => c.sha)).toEqual([v1, v2])
    expect(showFileAt(v1, PATH, dir)).toEqual({ content: 'clean one', found: true })
    expect(showFileAt(v1, 'graphs/nope.json', dir).found).toBe(false)
  })

  it('sliceRange brackets by sha prefix and rejects inside-out ranges', { timeout: 30000 }, () => {
    history(dir, ['a', 'b', 'c'])
    const commits = listFileCommits(PATH, dir)
    expect(sliceRange(commits, commits[1].shortSha).map(c => c.subject)).toEqual(['v2', 'v3'])
    expect(sliceRange(commits, undefined, commits[1].sha).map(c => c.subject)).toEqual(['v1', 'v2'])
    expect(() => sliceRange(commits, commits[2].sha, commits[0].sha)).toThrow(/inside out/)
    expect(() => sliceRange(commits, 'deadbeef')).toThrow(/not among the commits/)
  })
})

describe('bisectFile', () => {
  it('finds the exact commit where the poison entered', { timeout: 60000 }, async () => {
    history(dir, ['clean', 'clean 2', 'clean 3', 'poisoned', 'poisoned 2', 'poisoned 3'])
    const commits = listFileCommits(PATH, dir)
    const result = await bisectFile(PATH, commits, markerVerdict, { cwd: dir })

    expect(result.kind).toBe('transition')
    expect(result.culprit!.subject).toBe('v4')
    expect(result.before!.subject).toBe('v3')
    expect(result.probes.length).toBeLessThan(commits.length) // log2, not linear
  })

  it('find: fix hunts the first passing version instead', { timeout: 60000 }, async () => {
    history(dir, ['poisoned', 'poisoned 2', 'clean', 'clean 2'])
    const commits = listFileCommits(PATH, dir)
    const result = await bisectFile(PATH, commits, markerVerdict, { cwd: dir, find: 'fix' })

    expect(result.kind).toBe('transition')
    expect(result.culprit!.subject).toBe('v3')
    expect(result.before!.subject).toBe('v2')
  })

  it('reports no-transition when every version is fine', { timeout: 30000 }, async () => {
    history(dir, ['clean', 'clean 2', 'clean 3'])
    const result = await bisectFile(PATH, listFileCommits(PATH, dir), markerVerdict, { cwd: dir })
    expect(result.kind).toBe('no-transition')
    expect(result.probes).toHaveLength(1) // newest probe settles it
  })

  it('reports from-birth when the oldest version is already bad', { timeout: 30000 }, async () => {
    history(dir, ['poisoned', 'poisoned 2', 'poisoned 3'])
    const result = await bisectFile(PATH, listFileCommits(PATH, dir), markerVerdict, { cwd: dir })
    expect(result.kind).toBe('from-birth')
    expect(result.culprit!.subject).toBe('v1')
  })

  it('steps past skips and still converges', { timeout: 60000 }, async () => {
    history(dir, ['clean', 'unreadable', 'unreadable 2', 'clean 2', 'poisoned', 'poisoned 2'])
    const commits = listFileCommits(PATH, dir)
    const result = await bisectFile(PATH, commits, markerVerdict, { cwd: dir })
    expect(result.kind).toBe('transition')
    expect(result.culprit!.subject).toBe('v5')
    expect(result.before!.subject).toBe('v4')
  })

  it('reports an honest inconclusive when skips block the boundary', { timeout: 60000 }, async () => {
    history(dir, ['clean', 'unreadable', 'poisoned'])
    const result = await bisectFile(PATH, listFileCommits(PATH, dir), markerVerdict, { cwd: dir })
    expect(result.kind).toBe('inconclusive')
    expect(result.uncertain!.before.subject).toBe('v1')
    expect(result.uncertain!.after.subject).toBe('v3')
    expect(result.uncertain!.skipped.map(c => c.subject)).toEqual(['v2'])
  })

  it('caches verdicts — no commit is probed twice', { timeout: 60000 }, async () => {
    history(dir, ['clean', 'clean 2', 'clean 3', 'clean 4', 'poisoned', 'poisoned 2', 'poisoned 3', 'poisoned 4'])
    const commits = listFileCommits(PATH, dir)
    let calls = 0
    const counting = (content: string): Verdict => {
      calls++
      return markerVerdict(content)
    }
    const result = await bisectFile(PATH, commits, counting, { cwd: dir })
    expect(result.kind).toBe('transition')
    expect(result.culprit!.subject).toBe('v5')
    expect(calls).toBe(result.probes.length)
    expect(calls).toBeLessThanOrEqual(5) // endpoints + ~log2(8)
  })
})

describe('makeContractVerdict', () => {
  const report = (passed: boolean): GraphTestReport =>
    ({ passed, total: 1, failed: passed ? 0 : 1, summary: '', results: [] })

  const commit: FileCommit = { sha: 'x', shortSha: 'x', date: '2026-06-12T00:00:00Z', subject: 'x' }
  const graphJson = (tests?: unknown) =>
    JSON.stringify({ nodes: [{ id: '$input', inputs: [], outputs: [] }], edges: [], ...(tests ? { tests } : {}) })

  it("head mode judges every version by today's tests", async () => {
    const seen: unknown[] = []
    const verdict = makeContractVerdict({
      testsFrom: 'head',
      headTests: [{ inputs: {}, expect: [{ port: 'out', exists: true }] }],
      runner: async g => {
        seen.push(g.tests)
        return report(false)
      },
    })
    expect(await verdict(graphJson(), commit)).toBe('bad')
    expect(seen[0]).toEqual([{ inputs: {}, expect: [{ port: 'out', exists: true }] }])
  })

  it('historical mode uses each version’s own tests and skips untested ones', async () => {
    const verdict = makeContractVerdict({ testsFrom: 'historical', runner: async () => report(true) })
    expect(await verdict(graphJson([{ inputs: {} }]), commit)).toBe('good')
    expect(await verdict(graphJson(), commit)).toBe('skip')
  })

  it('skips unparseable and non-graph content instead of guessing', async () => {
    const verdict = makeContractVerdict({ testsFrom: 'historical', runner: async () => report(true) })
    expect(await verdict('not json at all {', commit)).toBe('skip')
    expect(await verdict('{"message": "json but not a graph"}', commit)).toBe('skip')
  })

  it('refuses head mode without head tests', () => {
    expect(() => makeContractVerdict({ testsFrom: 'head', runner: async () => report(true) }))
      .toThrow(/no contract tests/)
  })
})
