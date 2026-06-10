import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { SPEC_VERSION, type SerializedGraph } from '../core/serializer'

// Overridable so tests can point the store at a temp directory
const graphsDir = () => process.env.FRACTAL_GRAPHS_DIR ?? join(process.cwd(), 'graphs')
const versionsDir = (name: string) => join(graphsDir(), '.versions', name)

export interface GraphVersion {
  version: string // "<epochMs>_<hash8>" — the version file's basename
  hash: string
  timestamp: number
}

const hashGraph = (json: string) => createHash('sha256').update(json).digest('hex').slice(0, 8)

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Saves as current and appends to version history (skipped if content is
// identical to the latest version). Returns the version id.
export function saveGraph(name: string, graph: SerializedGraph): string {
  ensureDir(graphsDir())
  graph.specVersion ??= SPEC_VERSION
  const json = JSON.stringify(graph, null, 2)
  writeFileSync(join(graphsDir(), `${name}.json`), json)

  const hash = hashGraph(json)
  const latest = listVersions(name)[0]
  if (latest?.hash === hash) return latest.version

  const version = `${Date.now()}_${hash}`
  ensureDir(versionsDir(name))
  writeFileSync(join(versionsDir(name), `${version}.json`), json)
  return version
}

// Newest first
export function listVersions(name: string): GraphVersion[] {
  const dir = versionsDir(name)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const version = f.replace(/\.json$/, '')
      const [ts, hash] = version.split('_')
      return { version, hash, timestamp: Number(ts) }
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

// version accepts either a full version id or a bare content hash
export function loadGraph(name: string, version?: string): { graph: SerializedGraph | null; found: boolean } {
  if (version) {
    const match = listVersions(name).find(v => v.version === version || v.hash === version)
    if (!match) return { graph: null, found: false }
    return { graph: JSON.parse(readFileSync(join(versionsDir(name), `${match.version}.json`), 'utf8')), found: true }
  }
  const path = join(graphsDir(), `${name}.json`)
  if (!existsSync(path)) return { graph: null, found: false }
  return { graph: JSON.parse(readFileSync(path, 'utf8')), found: true }
}

// Restores a prior version as current and records the restore in history.
// No version → the one before the latest save.
export function rollbackGraph(
  name: string,
  version?: string,
): { graph: SerializedGraph | null; restored: boolean; version: string } {
  const versions = listVersions(name)
  const target = version
    ? versions.find(v => v.version === version || v.hash === version)
    : versions[1]
  if (!target) return { graph: null, restored: false, version: '' }

  const graph = JSON.parse(readFileSync(join(versionsDir(name), `${target.version}.json`), 'utf8'))
  const newVersion = saveGraph(name, graph)
  return { graph, restored: true, version: newVersion }
}

export function listGraphs(): string[] {
  if (!existsSync(graphsDir())) return []
  return readdirSync(graphsDir())
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
}

export interface LibraryEntry {
  name: string
  description?: string
  /** The graph's callable interface: $input's outputs / $output's inputs. */
  inputs: Array<{ id: string; type: string; optional?: boolean }>
  outputs: Array<{ id: string; type: string; optional?: boolean }>
  /** Number of contract tests the graph carries (run by save_graph). */
  tested: number
}

// The library as a catalog of composable skills — what Plant reads to decide
// whether a saved graph already covers part of a task.
export function libraryCatalog(): LibraryEntry[] {
  const entries: LibraryEntry[] = []
  for (const name of listGraphs()) {
    const { graph } = loadGraph(name)
    if (!graph) continue
    entries.push({
      name,
      description: graph.description,
      inputs: graph.nodes.find(n => n.id === '$input')?.outputs ?? [],
      outputs: graph.nodes.find(n => n.id === '$output')?.inputs ?? [],
      tested: graph.tests?.length ?? 0,
    })
  }
  return entries
}
