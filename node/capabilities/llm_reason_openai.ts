import OpenAI from 'openai'

const client = new OpenAI()

export async function llm_reason(inputs: Record<string, any>): Promise<{ response: string }> {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      ...(inputs.system ? [{ role: 'system' as const, content: String(inputs.system) }] : []),
      { role: 'user' as const, content: String(inputs.prompt) },
    ],
  })

  let response = ''
  for await (const chunk of stream) {
    response += chunk.choices[0]?.delta?.content ?? ''
  }

  return { response }
}
