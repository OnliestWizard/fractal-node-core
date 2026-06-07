import { topologicalSort } from '../../core/topo'
import type { SerializedGraph, SerializedNode } from '../../core/serializer'

export type EmittedFiles = Record<string, string>

// ── Node body: dispatch on sideEffects ──────────────────────────────────────

function nodeBody(node: SerializedNode): string {
  const fx = node.sideEffects ?? []

  if (node.agent) {
    return [
      `    // Agent node: tool-calling loop — requires fractal-node-core executor`,
      `    throw NotImplementedError("${node.id}: agent nodes must be run via the fractal executor")`,
    ].join('\n')
  }

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
    return [
      `    val _res = HttpClient().get(inputs["url"] as String)`,
      `    val body = _res.body<String>()`,
      `    val status = _res.status.value`,
      `    return mapOf("body" to body, "status" to status)`,
    ].join('\n')
  }

  if (fx.includes('filesystem_write')) {
    return [
      `    val _store = java.io.File("fractal_memory.json")`,
      `    val _data = if (_store.exists()) org.json.JSONObject(_store.readText()) else org.json.JSONObject()`,
      `    _data.put(inputs["key"] as String, inputs["value"] as String)`,
      `    _store.writeText(_data.toString())`,
      `    return mapOf("key" to inputs["key"])`,
    ].join('\n')
  }

  if (fx.includes('filesystem_read')) {
    return [
      `    val _store = java.io.File("fractal_memory.json")`,
      `    if (!_store.exists()) return mapOf("value" to "", "found" to false)`,
      `    val _data = org.json.JSONObject(_store.readText())`,
      `    val _key = inputs["key"] as String`,
      `    return if (_data.has(_key)) mapOf("value" to _data.getString(_key), "found" to true)`,
      `           else mapOf("value" to "", "found" to false)`,
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

// ── Loop body emitter ────────────────────────────────────────────────────────

function emitLoopBody(graph: SerializedGraph, order: string[], maxIter: number): string {
  const inner: string[] = []
  const varMap = new Map<string, string>()

  const inputNode = graph.nodes.find(n => n.id === '$input')
  if (inputNode) {
    for (const port of inputNode.outputs) {
      varMap.set(`$input:${port.id}`, `_state["${port.id}"]`)
    }
  }

  for (const nodeId of order) {
    const resultVar = `${nodeId}Out`
    const inputEntries = graph.edges
      .filter(e => e.to.nodeId === nodeId)
      .map(e => {
        const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`)
          ?? `${e.from.nodeId}Out["${e.from.portId}"]`
        return `            "${e.to.portId}" to ${expr}`
      })
    const inputArg = inputEntries.length
      ? `mapOf(\n${inputEntries.join(',\n')}\n        )`
      : 'emptyMap()'
    inner.push(`        val ${resultVar} = ${nodeId}(${inputArg})`)
    const node = graph.nodes.find(n => n.id === nodeId)!
    for (const port of node.outputs) {
      varMap.set(`${nodeId}:${port.id}`, `${resultVar}["${port.id}"]`)
    }
  }

  const outputEdges = graph.edges.filter(e => e.to.nodeId === '$output')
  if (outputEdges.length) {
    const entries = outputEdges.map(e => {
      const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`) ?? 'null'
      return `            "${e.to.portId}" to ${expr}`
    })
    inner.push(`        _out = mapOf(\n${entries.join(',\n')}\n        )`)
  }

  return [
    `    val _state = inputs.toMutableMap()`,
    `    var _out: Map<String, Any?> = emptyMap()`,
    `    for (_i in 0 until ${maxIter}) {`,
    ...inner,
    `        if (_out["continue"] != true) break`,
    `        _state.putAll(_out)`,
    `        _state.remove("continue")`,
    `    }`,
    `    return _out.filterKeys { it != "continue" }`,
  ].join('\n')
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
  files: EmittedFiles,
  loopMaxIter?: number
): void {
  const order = topologicalSort(graph.nodes.map(n => n.id), graph.edges)
    .filter(id => id !== '$input' && id !== '$output')

  const localFunctions: string[] = []

  for (const nodeId of order) {
    const node = graph.nodes.find(n => n.id === nodeId)!

    if (node.subgraph) {
      const childMaxIter = node.loop ? (node.constraints?.maxIterations ?? 10) : undefined
      emitModule(node.subgraph, nodeId, files, childMaxIter)
    } else if (node.branches) {
      for (const [branchName, branchGraph] of Object.entries(node.branches)) {
        emitModule(branchGraph, `${nodeId}_${branchName}`, files)
      }
      const cases = Object.keys(node.branches)
        .map(name => `    if (inputs["condition"] == ${JSON.stringify(name)}) return ${nodeId}_${name}(inputs)`)
        .join('\n')
      localFunctions.push(
        `private suspend fun ${nodeId}(inputs: Map<String, Any?> = emptyMap()): Map<String, Any?> {\n${cases}\n    throw IllegalArgumentException("${nodeId}: unknown branch \"\${inputs[\"condition\"]}\"")\n}`
      )
    } else {
      localFunctions.push(emitLeafNode(node))
    }
  }

  let wrapper: string
  if (loopMaxIter !== undefined) {
    const body = emitLoopBody(graph, order, loopMaxIter)
    wrapper = `suspend fun ${moduleName}(inputs: Map<String, Any?>): Map<String, Any?> {\n${body}\n}`
  } else {
    const hasInputBoundary = graph.nodes.some(n => n.id === '$input')
    const param = hasInputBoundary
      ? 'inputs: Map<String, Any?>'
      : 'inputs: Map<String, Any?> = emptyMap()'
    const body  = emitCallChain(graph, order)
    wrapper = `suspend fun ${moduleName}(${param}): Map<String, Any?> {\n${body}\n}`
  }

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
