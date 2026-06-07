import { test, expect } from 'vitest'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import { emitGraphKotlin } from '../emitters/android/emitKotlin'
import { validateRegistry, deserialize } from '../core/serializer'
import type { SerializedGraph } from '../core/serializer'
import graph from '../node/graphs/RefineLoop.graph.json'

const g = graph as SerializedGraph
const mockRegistry = {
  draft_writer:  async () => ({ response: '' }),
  quality_judge: async () => ({ response: '', continue: false, feedback: '' }),
}

test('RefineLoop graph has draft_writer and quality_judge as leaves', () => {
  const missing = validateRegistry(g, {})
  expect(missing).toContain('draft_writer')
  expect(missing).toContain('quality_judge')
  expect(missing).toHaveLength(2)
  expect(validateRegistry(g, mockRegistry)).toEqual([])
})

test('RefineLoop deserializes with a complete registry', () => {
  const eg = deserialize(g, mockRegistry)
  const refine = eg.nodes.get('refine')!
  expect(refine.loop).toBe(true)
  expect(refine.subgraph).toBeDefined()
  expect(refine.constraints?.maxIterations).toBe(5)
})

test('emitGraphJS emits a for-loop structure for the refine node', () => {
  const files = emitGraphJS(g)
  const refineJs = files['refine.js']
  expect(refineJs).toContain('for (let _i')
  expect(refineJs).toContain('_state')
  expect(refineJs).toContain('draft_writer')
  expect(refineJs).toContain('quality_judge')
  expect(refineJs).toContain('_out.continue')
})

test('emitGraphJS index.js imports and calls refine', () => {
  const files = emitGraphJS(g)
  expect(files['index.js']).toContain("from './refine.js'")
  expect(files['index.js']).toContain('refine(')
})

test('emitGraphKotlin emits a for-loop structure for the refine node', () => {
  const files = emitGraphKotlin(g)
  const refineKt = files['Refine.kt']
  expect(refineKt).toContain('for (_i in 0 until')
  expect(refineKt).toContain('_state')
  expect(refineKt).toContain('draft_writer')
  expect(refineKt).toContain('quality_judge')
})
