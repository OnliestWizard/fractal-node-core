import { test, expect, vi } from 'vitest'
import { validateRegistry, deserialize } from '../core/serializer'
import type { SerializedGraph } from '../core/serializer'
import graph from '../node/graphs/CaptureAndTranscribe.graph.json'

const g = graph as SerializedGraph

test('validateRegistry returns missing leaf ids', () => {
  expect(validateRegistry(g, {})).toEqual(['capture_audio', 'transcribe_audio'])
  expect(validateRegistry(g, { capture_audio: () => {} })).toEqual(['transcribe_audio'])
  expect(validateRegistry(g, { capture_audio: () => {}, transcribe_audio: () => {} })).toEqual([])
})

test('deserialize warns on missing registry entries', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  deserialize(g, {})
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('capture_audio')
  )
  warn.mockRestore()
})

test('deserialize does not warn when registry is complete', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  deserialize(g, { capture_audio: () => {}, transcribe_audio: () => {} })
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})
