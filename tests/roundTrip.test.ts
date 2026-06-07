import { test, expect } from 'vitest'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import { emitGraphKotlin } from '../emitters/android/emitKotlin'
import type { SerializedGraph } from '../core/serializer'
import graph from '../node/graphs/CaptureAndTranscribe.graph.json'

test('graph emits to both JS and Kotlin', () => {
  const js = emitGraphJS(graph as SerializedGraph)
  const kotlin = emitGraphKotlin(graph as SerializedGraph)

  expect(js['index.js']).toContain('capture_audio')
  expect(kotlin['Main.kt']).toContain('capture_audio')
})
