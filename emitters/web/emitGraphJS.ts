import type { IExecutionGraph, NodeDefinition } from '../../core/types'

export function emitGraphJS(graph: IExecutionGraph, nodes: Map<string, NodeDefinition>): string {
  return `
async function run() {
  const audio = await capture_audio()
  const text = await transcribe_audio(audio)
  return text
}
`
}
