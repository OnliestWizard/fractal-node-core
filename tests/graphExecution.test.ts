import { test, expect } from 'vitest'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import type { SerializedGraph } from '../core/serializer'
import graph from '../node/graphs/CaptureAndTranscribe.graph.json'

test('graph preserves execution order', () => {
  const files = emitGraphJS(graph as SerializedGraph)
  const output = files['index.js']
  expect(output.indexOf('capture_audio')).toBeLessThan(output.indexOf('transcribe_audio'))
})
