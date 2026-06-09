import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SerializedGraph } from '../core/serializer'

const GRAPHS_DIR = join(process.cwd(), 'graphs')

function ensureDir() {
  if (!existsSync(GRAPHS_DIR)) mkdirSync(GRAPHS_DIR, { recursive: true })
}

export function saveGraph(name: string, graph: SerializedGraph): void {
  ensureDir()
  writeFileSync(join(GRAPHS_DIR, `${name}.json`), JSON.stringify(graph, null, 2))
}

export function loadGraph(name: string): { graph: SerializedGraph | null; found: boolean } {
  const path = join(GRAPHS_DIR, `${name}.json`)
  if (!existsSync(path)) return { graph: null, found: false }
  return { graph: JSON.parse(readFileSync(path, 'utf8')), found: true }
}

export function listGraphs(): string[] {
  if (!existsSync(GRAPHS_DIR)) return []
  return readdirSync(GRAPHS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
}
