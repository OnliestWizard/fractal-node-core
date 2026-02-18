export function emitGraphJS(graph, nodes) {
  return `
async function run() {
  const audio = await capture_audio()
  const text = await transcribe_audio(audio)
  return text
}
`
}
