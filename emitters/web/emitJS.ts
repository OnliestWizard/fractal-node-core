import { ExecutionNode } from '../../node/NodeSchema'

export function emitJS(node: ExecutionNode): string {
  if (!node.sideEffects?.includes('microphone')) {
    throw new Error('Unsupported node for Web emitter')
  }

  return `
export async function ${node.id}() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  return await recordAudio(stream)
}
`
}
