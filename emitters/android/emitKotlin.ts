import { topologicalSort } from '../../core/topo'
import type { SerializedGraph, SerializedNode } from '../../core/serializer'

export type EmittedFiles = Record<string, string>

// ── Node body: dispatch on sideEffects ──────────────────────────────────────

function nodeBody(node: SerializedNode): string {
  const fx = node.sideEffects ?? []

  if (fx.includes('microphone')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `    val ${out} = AudioRecorder.capture()`,
      `    return mapOf("${out}" to ${out})`,
    ].join('\n')
  }

  if (fx.includes('camera')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `    val ${out} = CameraCapture.captureFrame()`,
      `    return mapOf("${out}" to ${out})`,
    ].join('\n')
  }

  if (fx.includes('network_access')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `    val response = HttpClient().get(inputs["url"] as String)`,
      `    val ${out} = response.body<String>()`,
      `    return mapOf("${out}" to ${out})`,
    ].join('\n')
  }

  if (fx.includes('filesystem_write')) {
    return [
      `    File(inputs["path"] as String).writeText(inputs["value"] as String)`,
      `    return emptyMap()`,
    ].join('\n')
  }

  if (fx.includes('llm')) {
    const out = node.outputs[0]?.id ?? 'response'
    return [
      `    val client = AnthropicOkHttpClient.builder().build()`,
      `    val msg = client.messages().create(`,
      `        MessageCreateParams.builder()`,
      `            .model(Model.CLAUDE_OPUS_4_8)`,
      `            .maxTokens(64000)`,
      `            .addUserMessage(inputs["prompt"] as String)`,
      `            .build()`,
      `    )`,
      `    val ${out} = msg.content().firstOrNull()?.text()?.text() ?: ""`,
      `    return mapOf("${out}" to ${out})`,
    ].join('\n')
  }

  return [
    `    // TODO: implement ${node.id}`,
    `    throw NotImplementedError("${node.id}: not implemented")`,
  ].join('\n')
}

function emitLeafNode(node: SerializedNode): string {
  return [
    `private suspend fun ${node.id}(inputs: Map<String, Any?> = emptyMap()): Map<String, Any?> {`,
    nodeBody(node),
    `}`,
  ].join('\n')
}

// ── Call chain ───────────────────────────────────────────────────────────────

function emitCallChain(graph: SerializedGraph, order: string[]): string {
  const lines: string[] = []
  const varMap = new Map<string, string>()

  const inputNode = graph.nodes.find(n => n.id === '$input')
  if (inputNode) {
    for (const port of inputNode.outputs) {
      varMap.set(`$input:${port.id}`, `inputs["${port.id}"]`)
    }
  }

  for (const nodeId of order) {
    const resultVar = `${nodeId}Out`

    const inputEntries = graph.edges
      .filter(e => e.to.nodeId === nodeId)
      .map(e => {
        const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`)
          ?? `${e.from.nodeId}Out["${e.from.portId}"]`
        return `        "${e.to.portId}" to ${expr}`
      })

    const inputArg = inputEntries.length
      ? `mapOf(\n${inputEntries.join(',\n')}\n    )`
      : 'emptyMap()'

    lines.push(`    val ${resultVar} = ${nodeId}(${inputArg})`)

    const node = graph.nodes.find(n => n.id === nodeId)!
    for (const port of node.outputs) {
      varMap.set(`${nodeId}:${port.id}`, `${resultVar}["${port.id}"]`)
    }
  }

  const outputEdges = graph.edges.filter(e => e.to.nodeId === '$output')
  if (outputEdges.length) {
    const entries = outputEdges.map(e => {
      const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`) ?? 'null'
      return `        "${e.to.portId}" to ${expr}`
    })
    lines.push(`    return mapOf(\n${entries.join(',\n')}\n    )`)
  } else if (order.length) {
    lines.push(`    return ${order[order.length - 1]}Out`)
  }

  return lines.join('\n')
}

// ── Module emitter ───────────────────────────────────────────────────────────
// Subgraph nodes → separate .kt file (same package, no import needed).
// Leaf nodes → private fun, inline in this file.

function ktFilename(moduleName: string): string {
  // run → Main.kt, everything else → PascalCase
  if (moduleName === 'run') return 'Main.kt'
  return moduleName.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + '.kt'
}

function emitModule(
  graph: SerializedGraph,
  moduleName: string,
  files: EmittedFiles
): void {
  const order = topologicalSort(graph.nodes.map(n => n.id), graph.edges)
    .filter(id => id !== '$input' && id !== '$output')

  const localFunctions: string[] = []

  for (const nodeId of order) {
    const node = graph.nodes.find(n => n.id === nodeId)!

    if (node.subgraph) {
      // Recurse — subgraph becomes its own file
      emitModule(node.subgraph, nodeId, files)
      // No local definition needed — same package, visible automatically
    } else {
      localFunctions.push(emitLeafNode(node))
    }
  }

  const hasInputBoundary = graph.nodes.some(n => n.id === '$input')
  const param   = hasInputBoundary
    ? 'inputs: Map<String, Any?>'
    : 'inputs: Map<String, Any?> = emptyMap()'
  const body    = emitCallChain(graph, order)
  const wrapper = `suspend fun ${moduleName}(${param}): Map<String, Any?> {\n${body}\n}`

  const header   = `// === ${moduleName} ===`
  const sections = [header, ...localFunctions, wrapper]
  files[ktFilename(moduleName)] = sections.join('\n\n')
}

// ── Public API ───────────────────────────────────────────────────────────────

export function emitGraphKotlin(graph: SerializedGraph): EmittedFiles {
  const files: EmittedFiles = {}
  emitModule(graph, 'run', files)
  return files
}
