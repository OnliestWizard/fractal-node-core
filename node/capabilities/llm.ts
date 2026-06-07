import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function llm_reason(inputs: Record<string, any>): Promise<{ response: string }> {
  const stream = client.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    ...(inputs.system ? { system: inputs.system } : {}),
    messages: [{ role: 'user', content: String(inputs.prompt) }],
  })

  const message = await stream.finalMessage()
  const textBlock = message.content.find(b => b.type === 'text')
  const response = textBlock?.type === 'text' ? textBlock.text : ''
  return { response }
}
