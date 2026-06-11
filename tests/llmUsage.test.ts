import { describe, it, expect, beforeEach } from 'vitest'
import { recordUsage, usageSummary, resetUsage, formatUsage, formatCost } from '../lib/llm-usage'
import { renderTraceMarkdown } from '../lib/trace-markdown'

beforeEach(() => resetUsage())

describe('usage meter', () => {
  it('accumulates per model and totals across models', () => {
    recordUsage('gpt-4o', { prompt_tokens: 1000, completion_tokens: 200 })
    recordUsage('gpt-4o', { prompt_tokens: 500, completion_tokens: 100 })
    recordUsage('gpt-4o-mini', { prompt_tokens: 2000, completion_tokens: 400 })

    const s = usageSummary()
    expect(s.models['gpt-4o']).toEqual({ requests: 2, promptTokens: 1500, completionTokens: 300 })
    expect(s.models['gpt-4o-mini']).toEqual({ requests: 1, promptTokens: 2000, completionTokens: 400 })
    expect(s.requests).toBe(3)
    expect(s.promptTokens).toBe(3500)
    expect(s.completionTokens).toBe(700)
  })

  it('estimates cost from the price table', () => {
    // 1M prompt + 1M completion on gpt-4o = $2.50 + $10.00
    recordUsage('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })
    expect(usageSummary().estimatedCost).toBeCloseTo(12.5)
  })

  it('counts tokens for unknown models but contributes $0', () => {
    recordUsage('some-future-model', { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })
    const s = usageSummary()
    expect(s.promptTokens).toBe(1_000_000)
    expect(s.estimatedCost).toBe(0)
  })

  it('tolerates a missing usage block (request still counted)', () => {
    recordUsage('gpt-4o', null)
    const s = usageSummary()
    expect(s.requests).toBe(1)
    expect(s.promptTokens).toBe(0)
  })

  it('resets', () => {
    recordUsage('gpt-4o', { prompt_tokens: 10, completion_tokens: 10 })
    resetUsage()
    expect(usageSummary().requests).toBe(0)
  })
})

describe('formatting', () => {
  it('formats a one-line summary with k-units and cost', () => {
    recordUsage('gpt-4o', { prompt_tokens: 38_200, completion_tokens: 5_100 })
    expect(formatUsage()).toBe('LLM usage: gpt-4o 1× 38.2k in / 5.1k out ≈ $0.15')
  })

  it('says none when nothing was spent', () => {
    expect(formatUsage()).toBe('LLM usage: none')
  })

  it('floors tiny costs at <$0.01 instead of lying with $0.00', () => {
    expect(formatCost(0.0004)).toBe('<$0.01')
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(2.05)).toBe('$2.05')
  })
})

describe('usage in trace receipts', () => {
  it('renders the usage line when the trace carries one', () => {
    const md = renderTraceMarkdown({
      events: [],
      usage: {
        models: { 'gpt-4o': { requests: 2, promptTokens: 20_000, completionTokens: 3_000 } },
        requests: 2, promptTokens: 20_000, completionTokens: 3_000, estimatedCost: 0.08,
      },
    })
    expect(md).toContain('*LLM usage: gpt-4o 2× 20.0k in / 3.0k out ≈ $0.08*')
  })

  it('omits the line for traces without usage (older traces)', () => {
    const md = renderTraceMarkdown({ events: [] })
    expect(md).not.toContain('LLM usage')
  })
})
