import { test, expect } from 'vitest'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import { emitGraphKotlin } from '../emitters/android/emitKotlin'
import { validateRegistry, deserialize } from '../core/serializer'
import type { SerializedGraph } from '../core/serializer'
import graph from '../node/graphs/RefineLoop.graph.json'

const g = graph as SerializedGraph

test('RefineLoop graph has refine_draft as the only leaf', () => {
  expect(validateRegistry(g, {})).toEqual(['refine_draft'])
  expect(validateRegistry(g, { refine_draft: () => {} })).toEqual([])
})

test('RefineLoop deserializes with a complete registry', () => {
  const eg = deserialize(g, { refine_draft: async () => ({ response: '', continue: false }) })
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
  expect(refineJs).toContain('refine_draft')
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
  expect(refineKt).toContain('refine_draft')
})
