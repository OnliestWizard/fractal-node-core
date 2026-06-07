import OpenAI from 'openai'

const client = new OpenAI()

export async function draft_writer(inputs: Record<string, any>): Promise<{ response: string }> {
  const hasDraft = Boolean(inputs.draft)
  const userContent = hasDraft
    ? `Original prompt:\n${inputs.prompt}\n\nPrevious draft:\n${inputs.draft}\n\nRequired fixes from quality review:\n${inputs.feedback}`
    : String(inputs.prompt)

  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      ...(inputs.system ? [{ role: 'system' as const, content: String(inputs.system) }] : []),
      { role: 'user' as const, content: userContent },
    ],
  })

  let response = ''
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? ''
    process.stdout.write(token)
    response += token
  }

  return { response }
}
