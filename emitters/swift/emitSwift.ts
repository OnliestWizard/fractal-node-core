import { topologicalSort } from '../../core/topo'
import type { SerializedGraph, SerializedNode } from '../../core/serializer'

export type EmittedFiles = Record<string, string>

// ── Node body: dispatch on sideEffects ──────────────────────────────────────

function nodeBody(node: SerializedNode): string {
  const fx = node.sideEffects ?? []

  if (node.agent) {
    return [
      `    // Agent node: tool-calling loop — requires fractal-node-core executor`,
      `    throw NSError(domain: "FractalNode", code: -1, userInfo: [NSLocalizedDescriptionKey: "${node.id}: agent nodes must be run via the fractal executor"])`,
    ].join('\n')
  }

  if (fx.includes('microphone')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `    let ${out} = try await AudioCapture.record()`,
      `    return ["${out}": ${out}]`,
    ].join('\n')
  }

  if (fx.includes('camera')) {
    const out = node.outputs[0]?.id ?? 'out'
    return [
      `    let ${out} = try await CameraCapture.captureFrame()`,
      `    return ["${out}": ${out}]`,
    ].join('\n')
  }

  if (fx.includes('network_access')) {
    return [
      `    guard let _url = URL(string: inputs["url"] as? String ?? "") else { throw URLError(.badURL) }`,
      `    let (_data, _response) = try await URLSession.shared.data(from: _url)`,
      `    let body = String(data: _data, encoding: .utf8) ?? ""`,
      `    let status = (_response as? HTTPURLResponse)?.statusCode ?? 0`,
      `    return ["body": body, "status": status]`,
    ].join('\n')
  }

  if (fx.includes('filesystem_write')) {
    return [
      `    var _store = (UserDefaults.standard.dictionary(forKey: "fractal_memory") as? [String: String]) ?? [:]`,
      `    _store[inputs["key"] as? String ?? ""] = inputs["value"] as? String ?? ""`,
      `    UserDefaults.standard.set(_store, forKey: "fractal_memory")`,
      `    return ["key": inputs["key"] as Any]`,
    ].join('\n')
  }

  if (fx.includes('filesystem_read')) {
    return [
      `    let _store = (UserDefaults.standard.dictionary(forKey: "fractal_memory") as? [String: String]) ?? [:]`,
      `    let _key = inputs["key"] as? String ?? ""`,
      `    if let _value = _store[_key] { return ["value": _value, "found": true] }`,
      `    return ["value": "", "found": false]`,
    ].join('\n')
  }

  if (fx.includes('llm')) {
    return [
      `    // LLM: integrate with your preferred Swift AI SDK`,
      `    throw NSError(domain: "FractalNode", code: -1, userInfo: [NSLocalizedDescriptionKey: "${node.id}: LLM not implemented"])`,
    ].join('\n')
  }

  return [
    `    // TODO: implement ${node.id}`,
    `    throw NSError(domain: "FractalNode", code: -1, userInfo: [NSLocalizedDescriptionKey: "${node.id}: not implemented"])`,
  ].join('\n')
}

function emitLeafNode(node: SerializedNode): string {
  return [
    `private func ${node.id}(inputs: [String: Any?] = [:]) async throws -> [String: Any?] {`,
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
        return `        "${e.to.portId}": ${expr}`
      })

    const inputArg = inputEntries.length
      ? `[\n${inputEntries.join(',\n')}\n    ]`
      : '[:]'

    lines.push(`    let ${resultVar} = try await ${nodeId}(inputs: ${inputArg})`)

    const node = graph.nodes.find(n => n.id === nodeId)!
    for (const port of node.outputs) {
      varMap.set(`${nodeId}:${port.id}`, `${resultVar}["${port.id}"]`)
    }
  }

  const outputEdges = graph.edges.filter(e => e.to.nodeId === '$output')
  if (outputEdges.length) {
    const entries = outputEdges.map(e => {
      const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`) ?? 'nil'
      return `        "${e.to.portId}": ${expr}`
    })
    lines.push(`    return [\n${entries.join(',\n')}\n    ]`)
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
        return `            "${e.to.portId}": ${expr}`
      })
    const inputArg = inputEntries.length
      ? `[\n${inputEntries.join(',\n')}\n        ]`
      : '[:]'
    inner.push(`        let ${resultVar} = try await ${nodeId}(inputs: ${inputArg})`)
    const node = graph.nodes.find(n => n.id === nodeId)!
    for (const port of node.outputs) {
      varMap.set(`${nodeId}:${port.id}`, `${resultVar}["${port.id}"]`)
    }
  }

  const outputEdges = graph.edges.filter(e => e.to.nodeId === '$output')
  if (outputEdges.length) {
    const entries = outputEdges.map(e => {
      const expr = varMap.get(`${e.from.nodeId}:${e.from.portId}`) ?? 'nil'
      return `            "${e.to.portId}": ${expr}`
    })
    inner.push(`        _out = [\n${entries.join(',\n')}\n        ]`)
  }

  return [
    `    var _state = inputs`,
    `    var _out: [String: Any?] = [:]`,
    `    for _ in 0..<${maxIter} {`,
    ...inner,
    `        if _out["continue"] as? Bool != true { break }`,
    `        _state.merge(_out) { _, new in new }`,
    `        _state.removeValue(forKey: "continue")`,
    `    }`,
    `    return _out.filter { $0.key != "continue" }`,
  ].join('\n')
}

// ── Module emitter ───────────────────────────────────────────────────────────

function swiftFilename(moduleName: string): string {
  if (moduleName === 'run') return 'Main.swift'
  return moduleName.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + '.swift'
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
        .map(name => `    if inputs["condition"] as? String == ${JSON.stringify(name)} { return try await ${nodeId}_${name}(inputs: inputs) }`)
        .join('\n')
      localFunctions.push(
        `private func ${nodeId}(inputs: [String: Any?] = [:]) async throws -> [String: Any?] {\n${cases}\n    throw NSError(domain: "FractalNode", code: -1, userInfo: [NSLocalizedDescriptionKey: "${nodeId}: unknown branch \\(inputs[\\"condition\\"] ?? \\"\\")"])\n}`
      )
    } else {
      localFunctions.push(emitLeafNode(node))
    }
  }

  let wrapper: string
  if (loopMaxIter !== undefined) {
    const body = emitLoopBody(graph, order, loopMaxIter)
    wrapper = `func ${moduleName}(inputs: [String: Any?]) async throws -> [String: Any?] {\n${body}\n}`
  } else {
    const hasInputBoundary = graph.nodes.some(n => n.id === '$input')
    const param = hasInputBoundary
      ? 'inputs: [String: Any?]'
      : 'inputs: [String: Any?] = [:]'
    const body = emitCallChain(graph, order)
    wrapper = `func ${moduleName}(${param}) async throws -> [String: Any?] {\n${body}\n}`
  }

  const header = `// === ${moduleName} ===`
  const sections = [header, ...localFunctions, wrapper]
  files[swiftFilename(moduleName)] = sections.join('\n\n')
}

// ── Public API ───────────────────────────────────────────────────────────────

export function emitGraphSwift(graph: SerializedGraph): EmittedFiles {
  const files: EmittedFiles = {}
  emitModule(graph, 'run', files)
  return files
}
