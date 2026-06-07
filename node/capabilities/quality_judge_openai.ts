import OpenAI from 'openai'

const client = new OpenAI()

const JUDGE_SYSTEM = `You are a strict quality judge. Given an original prompt and a response draft:

1. Extract every explicit requirement from the prompt (format rules, structural elements, word count, tone, required content).
2. For each requirement, check the draft and write: "- [requirement]: MET" or "- [requirement]: UNMET — [one-line reason]"
3. Then output your verdict.

Respond in exactly this format:

CHECKLIST:
- [requirement 1]: MET
- [requirement 2]: UNMET — [reason]
...

VERDICT: DONE
or
VERDICT: CONTINUE
FEEDBACK: [paste only the UNMET lines from your checklist, comma-separated]

Rules:
- Do not invent requirements that are not in the prompt.
- Do not mark a requirement MET unless you can quote evidence from the draft.
- If all requirements are MET, verdict is DONE. If any are UNMET, verdict is CONTINUE.`

export async function quality_judge(inputs: Record<string, any>): Promise<{ response: string; continue: boolean; feedback: string }> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 512,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: `Original prompt:\n${inputs.prompt}\n\nDraft:\n${inputs.draft}` },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? 'VERDICT: CONTINUE\nFEEDBACK: Unknown issue.'
  const verdictMatch = raw.match(/VERDICT:\s*(DONE|CONTINUE)/i)
  const feedbackMatch = raw.match(/FEEDBACK:\s*([\s\S]+)/i)

  const verdict  = verdictMatch?.[1]?.toUpperCase() ?? 'CONTINUE'
  const feedback = feedbackMatch?.[1]?.trim() ?? ''

  return {
    response: String(inputs.draft),
    continue: verdict !== 'DONE',
    feedback,
  }
}
