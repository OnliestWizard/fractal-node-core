// Graph contract tests — assertion helpers and report types. The runner
// itself (runGraphTests) lives in execute-engine.ts because it executes
// graphs; this module stays pure so the engine can import it without a cycle.

import type { GraphExpectation } from '../core/serializer'

export interface GraphTestResult {
  name: string
  passed: boolean
  failures: string[]
  durationMs: number
}

export interface GraphTestReport {
  passed: boolean
  total: number
  failed: number
  summary: string
  results: GraphTestResult[]
}

// Walk a dot-path into the outputs. JSON-string values are parsed mid-walk so
// paths can reach into MCP tool results (which arrive as JSON text).
export function valueAtPath(root: Record<string, unknown>, path: string): { value: unknown; found: boolean } {
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (typeof cur === 'string') {
      try { cur = JSON.parse(cur) } catch { return { value: undefined, found: false } }
    }
    if (cur === null || typeof cur !== 'object' || !(seg in (cur as object))) {
      return { value: undefined, found: false }
    }
    cur = (cur as Record<string, unknown>)[seg]
  }
  return { value: cur, found: true }
}

export function checkExpectation(exp: GraphExpectation, outputs: Record<string, unknown>): string[] {
  const { value, found } = valueAtPath(outputs, exp.port)
  const failures: string[] = []

  if (exp.exists !== undefined && found !== exp.exists) {
    failures.push(`${exp.port}: expected exists=${exp.exists}, got ${found}`)
  }
  if (exp.equals !== undefined) {
    if (!found) failures.push(`${exp.port}: missing (expected ${JSON.stringify(exp.equals)})`)
    else if (JSON.stringify(value) !== JSON.stringify(exp.equals)) {
      failures.push(`${exp.port}: expected ${JSON.stringify(exp.equals)}, got ${JSON.stringify(value)}`)
    }
  }
  if (exp.contains !== undefined) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (!found) failures.push(`${exp.port}: missing (expected to contain ${JSON.stringify(exp.contains)})`)
    else if (typeof text !== 'string' || !text.includes(exp.contains)) {
      failures.push(`${exp.port}: ${JSON.stringify(text?.slice(0, 120))} does not contain ${JSON.stringify(exp.contains)}`)
    }
  }
  return failures
}

export function buildReport(results: GraphTestResult[]): GraphTestReport {
  const failed = results.filter(r => !r.passed)
  const summary = failed.length === 0
    ? `${results.length}/${results.length} graph tests passed`
    : `${results.length - failed.length}/${results.length} passed; FAILED: ${failed
        .map(f => `${f.name} (${f.failures.join('; ')})`).join(' | ')}`
  return { passed: failed.length === 0, total: results.length, failed: failed.length, summary, results }
}
