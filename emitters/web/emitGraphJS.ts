import { topologicalSort } from '../../core/topo'
import type { SerializedGraph, SerializedNode } from '../../core/serializer'

export type EmittedFiles = Record<string, string>

// ── Node body: dispatch on sideEffects ──────────────────────────────────────

function nodeBody(node: SerializedNode): string {
  const fx = node.sideEffects ?? []

  if (fx.includes('microphone')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })`,
      `  const ${out} = await recordAudio(stream)`,
      `  return { ${out} }`,
    ].join('\n')
  }

  if (fx.includes('camera')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `  const stream = await navigator.mediaDevices.getUserMedia({ video: true })`,
      `  const ${out} = await captureFrame(stream)`,
      `  return { ${out} }`,
    ].join('\n')
  }

  if (fx.includes('network_access')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `  const response = await fetch(inputs.url)`,
      `  const ${out} = await response.json()`,
      `  return { ${out} }`,
    ].join('\n')
  }

  if (fx.includes('filesystem_write')) {
    return [
      `  localStorage.setItem(inputs.key, JSON.stringify(inputs.value))`,
      `  return {}`,
    ].join('\n')
  }

  if (fx.includes('llm')) {
    return [
      `  const stream = anthropic.messages.stream({`,
      `    model: 'claude-opus-4-8',`,
      `    max_tokens: 64000,`,
      `    thinking: { type: 'adaptive' },`,
      `    ...(inputs.system ? { system: inputs.system } : {}),`,
      `    messages: [{ role: 'user', content: inputs.prompt }],`,
      `  })`,
      `  const msg = await stream.finalMessage()`,
      `  const tb = msg.content.find(b => b.type === 'text')`,
      `  const response = tb?.text ?? ''`,
      `  return { response }`,
    ].join('\n')
  }

  return [
    `  // TODO: implement ${node.id}`,
    `  throw new Error('${node.id}: not implemented')`,
  ].join('\n')
}

function emitLeafNode(node: SerializedNode): string {
  return `async function ${node.id}(inputs) {\n${nodeBody(node)}\n}`
}

// ── Call chain: the body of a wrapper/run function ───────────────────────────

function emitCallChain(graph: SerializedGraph, order: string[]): string {
  const lines: string[] = []
  const varMap = new Map<string, string>()

  const inputNode = graph.nodes.find(n => n.id === '$input')
  if (inputNode) {
    for (const port of inputNode.outputs) {
      varMap.set(`$input:${port.id}`, `inputs.${port.id}`)
    }
  }

  for (const nodeId of order) {
    const resultVar = `${nodeId}_out`

    const inputEntries = graph.edges
      .filter(e => e.to.nodeId === nodeId)
      .map(e => {
        const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`)
          ?? `${e.from.nodeId}_out.${e.from.portId}`
        return `    ${e.to.portId}: ${expr}`
      })

    const inputArg = inputEntries.length
      ? `{\n${inputEntries.join(',\n')}\n  }`
      : '{}'

    lines.push(`  const ${resultVar} = await ${nodeId}(${inputArg})`)

    const node = graph.nodes.find(n => n.id === nodeId)!
    for (const port of node.outputs) {
      varMap.set(`${nodeId}:${port.id}`, `${resultVar}.${port.id}`)
    }
  }

  const outputEdges = graph.edges.filter(e => e.to.nodeId === '$output')
  if (outputEdges.length) {
    const entries = outputEdges.map(e => {
      const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`) ?? 'undefined'
      return `    ${e.to.portId}: ${expr}`
    })
    lines.push(`  return {\n${entries.join(',\n')}\n  }`)
  } else if (order.length) {
    lines.push(`  return ${order[order.length - 1]}_out`)
  }

  return lines.join('\n')
}

// ── Loop body emitter ────────────────────────────────────────────────────────
// Builds the function body for a loop node: feeds $output back into $input
// on each iteration until $output.continue is false or maxIter is reached.

function emitLoopBody(graph: SerializedGraph, order: string[], maxIter: number): string {
  const inner: string[] = []
  const varMap = new Map<string, string>()

  const inputNode = graph.nodes.find(n => n.id === '$input')
  if (inputNode) {
    for (const port of inputNode.outputs) {
      varMap.set(`$input:${port.id}`, `_state.${port.id}`)
    }
  }

  for (const nodeId of order) {
    const resultVar = `${nodeId}_out`
    const inputEntries = graph.edges
      .filter(e => e.to.nodeId === nodeId)
      .map(e => {
        const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`)
          ?? `${e.from.nodeId}_out.${e.from.portId}`
        return `      ${e.to.portId}: ${expr}`
      })
    const inputArg = inputEntries.length
      ? `{\n${inputEntries.join(',\n')}\n    }`
      : '{}'
    inner.push(`    const ${resultVar} = await ${nodeId}(${inputArg})`)
    const node = graph.nodes.find(n => n.id === nodeId)!
    for (const port of node.outputs) {
      varMap.set(`${nodeId}:${port.id}`, `${resultVar}.${port.id}`)
    }
  }

  const outputEdges = graph.edges.filter(e => e.to.nodeId === '$output')
  if (outputEdges.length) {
    const entries = outputEdges.map(e => {
      const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`) ?? 'undefined'
      return `      ${e.to.portId}: ${expr}`
    })
    inner.push(`    _out = {\n${entries.join(',\n')}\n    }`)
  }

  return [
    `  let _state = { ...inputs }`,
    `  let _out = {}`,
    `  for (let _i = 0; _i < ${maxIter}; _i++) {`,
    ...inner,
    `    if (!_out.continue) break`,
    `    Object.assign(_state, _out)`,
    `    delete _state.continue`,
    `  }`,
    `  const { continue: _c, ..._final } = _out`,
    `  return _final`,
  ].join('\n')
}

// ── Module emitter: one file per subgraph, leaves inline ─────────────────────
// Returns the import line the parent should use for this module.

function emitModule(
  graph: SerializedGraph,
  moduleName: string,
  files: EmittedFiles,
  loopMaxIter?: number
): string {
  const order = topologicalSort(graph.nodes.map(n => n.id), graph.edges)
    .filter(id => id !== '$input' && id !== '$output')

  const importLines:    string[] = []
  const localFunctions: string[] = []

  for (const nodeId of order) {
    const node = graph.nodes.find(n => n.id === nodeId)!

    if (node.subgraph) {
      // Subgraph → its own file. Recurse, collect import line.
      const childMaxIter = node.loop ? (node.constraints?.maxIterations ?? 10) : undefined
      const importLine = emitModule(node.subgraph, nodeId, files, childMaxIter)
      importLines.push(importLine)
    } else {
      // Leaf → inline in this file.
      localFunctions.push(emitLeafNode(node))
    }
  }

  let wrapper: string
  if (loopMaxIter !== undefined) {
    const body = emitLoopBody(graph, order, loopMaxIter)
    wrapper = `export async function ${moduleName}(inputs) {\n${body}\n}`
  } else {
    const hasInputBoundary = graph.nodes.some(n => n.id === '$input')
    const param = hasInputBoundary ? 'inputs' : 'inputs = {}'
    const body  = emitCallChain(graph, order)
    wrapper = `export async function ${moduleName}(${param}) {\n${body}\n}`
  }

  const header   = `// === ${moduleName} ===`
  const sections = [header, ...importLines, ...localFunctions, wrapper]
  const filename = moduleName === 'run' ? 'index.js' : `${moduleName}.js`

  files[filename] = sections.join('\n\n')

  return `import { ${moduleName} } from './${moduleName}.js'`
}

// ── Public API ───────────────────────────────────────────────────────────────

export function emitGraphJS(graph: SerializedGraph): EmittedFiles {
  const files: EmittedFiles = {}
  emitModule(graph, 'run', files)
  return files
}
