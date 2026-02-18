test('graph preserves execution order', () => {
  const output = emitGraphJS(graph, nodes)
  expect(output.indexOf('capture_audio')).toBeLessThan(
    output.indexOf('transcribe_audio')
  )
})
