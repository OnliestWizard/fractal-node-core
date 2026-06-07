import OpenAI from 'openai'

const client = new OpenAI()

const REFINE_INSTRUCTIONS = `After writing your response, you MUST do the following before adding a marker:

CONSTRAINT CHECK:
- List every explicit constraint from the prompt (format, structure, word count, tone, required elements)
- For each one, write "MET" or "UNMET" with a one-line reason

Then add exactly one marker on its own line:
[DONE] — every constraint is marked MET
[CONTINUE] — any constraint is marked UNMET

Do not skip the constraint check. Do not rationalize. Be strict.`

export async function refine_draft(inputs: Record<string, any>): Promise<{ response: string; continue: boolean }> {
  const hasDraft = Boolean(inputs.response)
  const userContent = hasDraft
    ? `Original prompt: ${inputs.prompt}\n\nPrevious draft:\n${inputs.response}\n\nImprove this draft.`
    : String(inputs.prompt)

  const systemPrompt = inputs.system
    ? `${inputs.system}\n\n${REFINE_INSTRUCTIONS}`
    : REFINE_INSTRUCTIONS

  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  })

  let raw = ''
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '')
    raw += chunk.choices[0]?.delta?.content ?? ''
  }

  const shouldContinue = /\[CONTINUE\]\s*$/.test(raw) && !/\[DONE\]\s*$/.test(raw)
  // Strip the constraint check block and the marker — keep only the draft
  const response = raw
    .replace(/CONSTRAINT CHECK:[\s\S]*?\[(?:DONE|CONTINUE)\]\s*$/, '')
    .replace(/\[(DONE|CONTINUE)\]\s*$/, '')
    .trimEnd()

  return { response, continue: shouldContinue }
}
