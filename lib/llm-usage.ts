// LLM usage meter — every OpenAI call site records its response usage here,
// so a run can print what it spent and stamp it into the trace. Cost is a
// receipt like duration: visible at run end, persisted with the evidence.

export interface ModelUsage {
  requests: number
  promptTokens: number
  completionTokens: number
}

export interface UsageSummary {
  models: Record<string, ModelUsage>
  requests: number
  promptTokens: number
  completionTokens: number
  /** Estimated USD from the PRICES table — approximate, snapshot pricing. */
  estimatedCost: number
}

// USD per 1M tokens, OpenAI pricing as of 2026-06. Unknown models still
// count tokens; they just contribute $0 to the estimate.
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
}

const tally = new Map<string, ModelUsage>()

export function recordUsage(
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null,
): void {
  const entry = tally.get(model) ?? { requests: 0, promptTokens: 0, completionTokens: 0 }
  entry.requests += 1
  entry.promptTokens += usage?.prompt_tokens ?? 0
  entry.completionTokens += usage?.completion_tokens ?? 0
  tally.set(model, entry)
}

export function usageSummary(): UsageSummary {
  const models: Record<string, ModelUsage> = {}
  let requests = 0, promptTokens = 0, completionTokens = 0, estimatedCost = 0

  for (const [model, u] of tally) {
    models[model] = { ...u }
    requests += u.requests
    promptTokens += u.promptTokens
    completionTokens += u.completionTokens
    const price = PRICES[model]
    if (price) estimatedCost += (u.promptTokens * price.input + u.completionTokens * price.output) / 1_000_000
  }

  return { models, requests, promptTokens, completionTokens, estimatedCost }
}

export function resetUsage(): void {
  tally.clear()
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function formatCost(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

export function formatUsage(s: UsageSummary = usageSummary()): string {
  if (s.requests === 0) return 'LLM usage: none'
  const perModel = Object.entries(s.models)
    .map(([model, u]) => `${model} ${u.requests}× ${k(u.promptTokens)} in / ${k(u.completionTokens)} out`)
    .join(', ')
  return `LLM usage: ${perModel} ≈ ${formatCost(s.estimatedCost)}`
}

// One visible line per process, printed at exit by whichever run spent
// tokens — CLI, demo, or server. Quiet when nothing was spent.
process.on('exit', () => {
  const s = usageSummary()
  if (s.requests > 0) console.log(`\n${formatUsage(s)}`)
})
