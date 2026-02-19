const graph = new ExecutionGraph()

graph.addNode({
  id: 'capture',
  inputs: [],
  outputs: [{ id: 'audio', type: 'string' }]
})

graph.addNode({
  id: 'transcribe',
  inputs: [{ id: 'audio', type: 'string' }],
  outputs: [{ id: 'text', type: 'string' }]
})

graph.addEdge({
  from: { nodeId: 'capture', portId: 'audio' },
  to:   { nodeId: 'transcribe', portId: 'audio' }
})

await runGraph(graph, {
  capture: () => 'AUDIO',
  transcribe: ({ audio }) => audio + '_TEXT'
})
