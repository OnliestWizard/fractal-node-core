import { readFile } from 'fs/promises'
import { join } from 'path'

const STORE = join(process.cwd(), '.fractal_memory.json')

export async function memory_read(inputs: Record<string, any>): Promise<{ value: string; found: boolean }> {
  try {
    const store: Record<string, string> = JSON.parse(await readFile(STORE, 'utf8'))
    const value = store[String(inputs.key)]
    return value !== undefined ? { value, found: true } : { value: '', found: false }
  } catch {
    return { value: '', found: false }
  }
}
