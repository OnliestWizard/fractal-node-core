import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

const REFINE_INSTRUCTIONS = `After your response, add exactly one marker on its own line:
[DONE] — the response fully answers the prompt and needs no further refinement
[CONTINUE] — the response could be meaningfully improved with another pass`

export async function refine_draft(inputs: Record<string, any>): Promise<{ response: string; continue: boolean }> {
  const hasDraft = Boolean(inputs.response)
  const userContent = hasDraft
    ? `Original prompt: ${inputs.prompt}\n\nPrevious draft:\n${inputs.response}\n\nImprove this draft.`
    : String(inputs.prompt)

  const systemPrompt = inputs.system
    ? `${inputs.system}\n\n${REFINE_INSTRUCTIONS}`
    : REFINE_INSTRUCTIONS

  const stream = client.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })

  const message = await stream.finalMessage()
  const textBlock = message.content.find(b => b.type === 'text')
  const raw = textBlock?.type === 'text' ? textBlock.text : ''

  const shouldContinue = /\[CONTINUE\]\s*$/.test(raw) && !/\[DONE\]\s*$/.test(raw)
  const response = raw.replace(/\[(DONE|CONTINUE)\]\s*$/, '').trimEnd()

  return { response, continue: shouldContinue }
}
