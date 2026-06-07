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

// ── Module emitter: one file per subgraph, leaves inline ─────────────────────
// Returns the import line the parent should use for this module.

function emitModule(
  graph: SerializedGraph,
  moduleName: string,
  files: EmittedFiles
): string {
  const order = topologicalSort(graph.nodes.map(n => n.id), graph.edges)
    .filter(id => id !== '$input' && id !== '$output')

  const importLines:    string[] = []
  const localFunctions: string[] = []

  for (const nodeId of order) {
    const node = graph.nodes.find(n => n.id === nodeId)!

    if (node.subgraph) {
      // Subgraph → its own file. Recurse, collect import line.
      const importLine = emitModule(node.subgraph, nodeId, files)
      importLines.push(importLine)
    } else {
      // Leaf → inline in this file.
      localFunctions.push(emitLeafNode(node))
    }
  }

  const hasInputBoundary = graph.nodes.some(n => n.id === '$input')
  const param   = hasInputBoundary ? 'inputs' : 'inputs = {}'
  const body    = emitCallChain(graph, order)
  const wrapper = `export async function ${moduleName}(${param}) {\n${body}\n}`

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
