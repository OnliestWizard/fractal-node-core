import { test, expect, vi, beforeEach } from 'vitest'

const { mockFinalMessage, mockStream } = vi.hoisted(() => {
  const mockFinalMessage = vi.fn()
  const mockStream = vi.fn().mockReturnValue({ finalMessage: mockFinalMessage })
  return { mockFinalMessage, mockStream }
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: mockStream }
  },
}))

import { llm_reason } from '../node/capabilities/llm'

beforeEach(() => {
  mockFinalMessage.mockResolvedValue({
    content: [{ type: 'text', text: 'Paris is the capital of France.' }],
  })
})

test('llm_reason returns response text', async () => {
  const result = await llm_reason({ prompt: 'What is the capital of France?' })
  expect(result.response).toBe('Paris is the capital of France.')
})

test('llm_reason passes system prompt when provided', async () => {
  await llm_reason({ prompt: 'Hello', system: 'You are a pirate.' })
  expect(mockStream).toHaveBeenCalledWith(
    expect.objectContaining({ system: 'You are a pirate.' })
  )
})

test('llm_reason omits system when not provided', async () => {
  await llm_reason({ prompt: 'Hello' })
  const call = mockStream.mock.calls[mockStream.mock.calls.length - 1][0]
  expect(call).not.toHaveProperty('system')
})

test('llm_reason returns empty string when no text block', async () => {
  mockFinalMessage.mockResolvedValueOnce({ content: [] })
  const result = await llm_reason({ prompt: 'Hello' })
  expect(result.response).toBe('')
})
