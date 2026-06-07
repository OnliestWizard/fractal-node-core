import OpenAI from 'openai'

const client = new OpenAI()

export async function research_answer(inputs: Record<string, any>): Promise<{ response: string }> {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      {
        role: 'system',
        content: 'Answer the question using only the provided content. Be concise and accurate.',
      },
      {
        role: 'user',
        content: `Content:\n${inputs.content}\n\nQuestion: ${inputs.question}`,
      },
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
