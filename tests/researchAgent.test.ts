import { test, expect } from 'vitest'
import { emitGraphJS } from '../emitters/web/emitGraphJS'
import { emitGraphKotlin } from '../emitters/android/emitKotlin'
import { validateRegistry, deserialize } from '../core/serializer'
import { runGraph } from '../core/executor'
import type { SerializedGraph } from '../core/serializer'
import graph from '../node/graphs/ResearchAgent.graph.json'

const g = graph as SerializedGraph
const mockRegistry = {
  http_fetch:      async () => ({ body: '<html>hello</html>', status: 200 }),
  research_answer: async () => ({ response: 'mocked answer' }),
}

test('ResearchAgent has http_fetch and research_answer as leaves', () => {
  const missing = validateRegistry(g, {})
  expect(missing).toContain('http_fetch')
  expect(missing).toContain('research_answer')
  expect(missing).toHaveLength(2)
  expect(validateRegistry(g, mockRegistry)).toEqual([])
})

test('ResearchAgent executes fetch → answer in order', async () => {
  const order: string[] = []
  const eg = deserialize(g, mockRegistry)
  await runGraph(
    eg,
    {},
    (id) => { order.push(id) },
    { url: 'https://example.com', question: 'What is this?' }
  )
  expect(order.indexOf('http_fetch')).toBeLessThan(order.indexOf('research_answer'))
})

test('ResearchAgent pipes fetch body into research_answer', async () => {
  let capturedContent: string | undefined
  const registry = {
    http_fetch:      async () => ({ body: 'fractal content', status: 200 }),
    research_answer: async (inputs: Record<string, any>) => {
      capturedContent = inputs.content
      return { response: 'answer' }
    },
  }
  const eg = deserialize(g, registry)
  await runGraph(eg, {}, undefined, { url: 'https://example.com', question: 'What?' })
  expect(capturedContent).toBe('fractal content')
})

test('emitGraphJS emits network_access fetch for http_fetch', () => {
  const files = emitGraphJS(g)
  expect(files['index.js']).toContain('fetch(')
  expect(files['index.js']).toContain('http_fetch')
})

test('emitGraphKotlin emits HttpClient for http_fetch', () => {
  const files = emitGraphKotlin(g)
  expect(files['Main.kt']).toContain('HttpClient')
  expect(files['Main.kt']).toContain('http_fetch')
})
