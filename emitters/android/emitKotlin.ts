import { ExecutionNode } from '../../node/NodeSchema'

export function emitKotlin(node: ExecutionNode): string {
  if (!node.sideEffects.includes('microphone')) {
    throw new Error('Unsupported node for Android emitter')
  }

  return `
fun ${node.id}(): ByteArray {
    // Permission check omitted for brevity
    return AudioRecorder.capture()
}
`
}
