// Forensics — binary-search a tracked file's history for the commit where it
// changed state: the first version that fails (or first that passes) a
// verdict, typically today's contract tests.
//
// Deliberately NOT `git bisect`: bisect checks out the whole tree at every
// probe, which churns the working copy and runs old engine code against old
// graphs. Here each probe reads the file as it was (`git show sha:path`) and
// judges it with the CURRENT engine and (by default) the CURRENT contract
// tests — yesterday's artifact held to today's standards. The working tree is
// never touched. O(log n) probes over the commits that touched the file.

import { execFileSync } from 'child_process'
import type { SerializedGraph, GraphTestCase } from '../core/serializer'
import type { GraphTestReport } from './graph-tests'

export interface FileCommit {
  sha: string
  shortSha: string
  /** Committer date, ISO. */
  date: string
  subject: string
}

export type Verdict = 'good' | 'bad' | 'skip'
export type VerdictFn = (content: string, commit: FileCommit) => Verdict | Promise<Verdict>

export interface BisectProbe {
  commit: FileCommit
  verdict: Verdict
}

export interface BisectResult {
  /** transition: culprit found mid-history. from-birth: the oldest candidate is
   *  already in the target state. no-transition: nothing to find in the range.
   *  inconclusive: skips around the boundary block convergence. */
  kind: 'transition' | 'from-birth' | 'no-transition' | 'inconclusive'
  /** First commit in the target state (the one the search hunts). */
  culprit?: FileCommit
  /** Last commit still in the prior state. */
  before?: FileCommit
  /** When inconclusive: the boundary lies somewhere in (before, after]. */
  uncertain?: { before: FileCommit; after: FileCommit; skipped: FileCommit[] }
  probes: BisectProbe[]
  candidates: number
}

function git(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.toString().trim()
    throw new Error(stderr || (err instanceof Error ? err.message : String(err)))
  }
}

const normalize = (path: string) => path.replace(/\\/g, '/')

/** Commits that touched the file, oldest first — the only points where the
 *  verdict can change, so the only candidates worth probing. */
export function listFileCommits(path: string, cwd?: string): FileCommit[] {
  const out = git(['log', '--reverse', '--format=%H%x09%h%x09%cI%x09%s', '--', normalize(path)], cwd)
  if (!out) return []
  return out.split('\n').map(line => {
    const [sha, shortSha, date, ...subject] = line.split('\t')
    return { sha, shortSha, date, subject: subject.join('\t') }
  })
}

/** The file's content as it was at a commit. found=false when the commit
 *  doesn't carry the file (e.g. the commit that deleted it). */
export function showFileAt(sha: string, path: string, cwd?: string): { content: string; found: boolean } {
  try {
    return { content: git(['show', `${sha}:${normalize(path)}`], cwd), found: true }
  } catch {
    return { content: '', found: false }
  }
}

/** Narrow candidates to [good, bad] by sha (full or unique prefix). */
export function sliceRange(commits: FileCommit[], good?: string, bad?: string): FileCommit[] {
  const indexOf = (ish: string): number => {
    const i = commits.findIndex(c => c.sha.startsWith(ish) || c.shortSha === ish)
    if (i === -1) throw new Error(`"${ish}" is not among the commits that touched this file`)
    return i
  }
  const lo = good ? indexOf(good) : 0
  const hi = bad ? indexOf(bad) : commits.length - 1
  if (lo > hi) throw new Error('--good is newer than --bad — the range is inside out')
  return commits.slice(lo, hi + 1)
}

export interface BisectOptions {
  /** break: hunt the first BAD version (regression / poisoning forensics).
   *  fix: hunt the first GOOD version (when did it start passing). */
  find?: 'break' | 'fix'
  cwd?: string
  /** Called per probe, for narration. */
  onProbe?: (probe: BisectProbe) => void
}

/** Binary search over the file's history for the first commit in the target
 *  state. Assumes the history is monotone across the range (one transition);
 *  pick endpoints that bracket the question. Verdicts are cached per commit;
 *  'skip' steps outward like `git bisect skip`. */
export async function bisectFile(
  path: string,
  commits: FileCommit[],
  verdict: VerdictFn,
  opts: BisectOptions = {},
): Promise<BisectResult> {
  const find = opts.find ?? 'break'
  const probes: BisectProbe[] = []
  const cache = new Map<string, Verdict>()

  const probe = async (i: number): Promise<Verdict> => {
    const c = commits[i]
    if (cache.has(c.sha)) return cache.get(c.sha)!
    const at = showFileAt(c.sha, path, opts.cwd)
    const v: Verdict = at.found ? await verdict(at.content, c) : 'skip'
    cache.set(c.sha, v)
    const p = { commit: c, verdict: v }
    probes.push(p)
    opts.onProbe?.(p)
    return v
  }

  // 'after' = the state the search hunts the first occurrence of.
  const isAfter = (v: Verdict) => (find === 'break' ? v === 'bad' : v === 'good')

  if (commits.length === 0) return { kind: 'no-transition', probes, candidates: 0 }

  const last = commits.length - 1
  const lastV = await probe(last)
  if (lastV === 'skip' || !isAfter(lastV)) {
    return { kind: 'no-transition', probes, candidates: commits.length }
  }
  if (commits.length === 1) {
    return { kind: 'from-birth', culprit: commits[0], probes, candidates: 1 }
  }

  // The oldest anchor must be testable — trim leading skips so the invariant
  // ("lo is in the prior state") rests on evidence, not assumption.
  let lo = 0 // last index known in the prior state
  let firstV = await probe(lo)
  while (firstV === 'skip' && lo < last - 1) {
    lo++
    firstV = await probe(lo)
  }
  if (firstV === 'skip' || isAfter(firstV)) {
    // every testable version is already in the target state
    const culprit = firstV === 'skip' ? commits[last] : commits[lo]
    return { kind: 'from-birth', culprit, probes, candidates: commits.length }
  }
  let hi = last // first index known in the target state

  while (hi - lo > 1) {
    const mid = lo + ((hi - lo) >> 1)
    // step outward from mid past skips, staying inside (lo, hi)
    let chosen = -1
    let v: Verdict = 'skip'
    for (let step = 0; step < hi - lo; step++) {
      const tryIdx = step % 2 === 0 ? mid + (step >> 1) : mid - ((step + 1) >> 1)
      if (tryIdx <= lo || tryIdx >= hi) continue
      const got = await probe(tryIdx)
      if (got !== 'skip') {
        chosen = tryIdx
        v = got
        break
      }
    }
    if (chosen === -1) {
      const skipped = commits.slice(lo + 1, hi).filter(c => cache.get(c.sha) === 'skip')
      return {
        kind: 'inconclusive',
        uncertain: { before: commits[lo], after: commits[hi], skipped },
        probes,
        candidates: commits.length,
      }
    }
    if (isAfter(v)) hi = chosen
    else lo = chosen
  }

  return { kind: 'transition', culprit: commits[hi], before: commits[lo], probes, candidates: commits.length }
}

export interface ContractVerdictOptions {
  /** head: judge every historical version by the CURRENT tests (default —
   *  "yesterday's artifact, today's standards"). historical: each version
   *  testifies under its own embedded tests. */
  testsFrom: 'head' | 'historical'
  /** Required for testsFrom: 'head'. */
  headTests?: GraphTestCase[]
  /** The actual test runner — inject runGraphTests bound to a pool. */
  runner: (graph: SerializedGraph) => Promise<GraphTestReport>
  onReport?: (report: GraphTestReport, commit: FileCommit) => void
}

/** Verdict for graph files: parse the historical content, attach the chosen
 *  test suite, run it. Unparseable content and (historical) untested versions
 *  return 'skip' — a version that can't testify isn't good or bad. */
export function makeContractVerdict(opts: ContractVerdictOptions): VerdictFn {
  if (opts.testsFrom === 'head' && (!opts.headTests || opts.headTests.length === 0)) {
    throw new Error("testsFrom 'head' needs headTests — the current graph carries no contract tests to judge history with")
  }
  return async (content, commit) => {
    let graph: SerializedGraph
    try {
      graph = JSON.parse(content) as SerializedGraph
      if (!graph || !Array.isArray(graph.nodes)) return 'skip'
    } catch {
      return 'skip'
    }
    const tests = opts.testsFrom === 'head' ? opts.headTests! : graph.tests ?? []
    if (tests.length === 0) return 'skip'
    const report = await opts.runner({ ...graph, tests })
    opts.onReport?.(report, commit)
    return report.passed ? 'good' : 'bad'
  }
}
