import node from '../node/nodes/CaptureAudio.node.json'
import { emitKotlin } from '../emitters/android/emitKotlin'
import { emitJS } from '../emitters/web/emitJS'

test('node survives multi-runtime emission', () => {
  const kotlin = emitKotlin(node as any)
  const js = emitJS(node as any)

  expect(kotlin).toContain('capture_audio')
  expect(js).toContain('capture_audio')
})
