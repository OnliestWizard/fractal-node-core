import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const STORE = join(process.cwd(), '.fractal_memory.json')

async function load(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(STORE, 'utf8'))
  } catch {
    return {}
  }
}

export async function memory_write(inputs: Record<string, any>): Promise<{ key: string }> {
  const store = await load()
  store[String(inputs.key)] = String(inputs.value)
  await writeFile(STORE, JSON.stringify(store, null, 2), 'utf8')
  return { key: String(inputs.key) }
}
