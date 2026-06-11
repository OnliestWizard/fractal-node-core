import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'fs'
import type { McpPool } from './mcp-pool'

interface McpServerConfig {
  name: string
  transport: 'stdio'
  command: string
  args?: string[]
}

interface McpConfig {
  servers: McpServerConfig[]
}

export interface CatalogNode {
  id: string
  description: string
  inputs: { id: string; type: string; optional?: true }[]
  outputs: { id: string; type: string; optional?: true }[]
}

// With a pool, tool lists come from its (lazily connected) clients — no extra
// child processes. Without one, each server is spawned transiently in turn.
export async function loadMcpCatalog(configPath = 'mcp.json', pool?: McpPool): Promise<CatalogNode[]> {
  if (pool) {
    const tools = await pool.listTools()
    return tools.map(t => ({
      id: t.id,
      description: t.description || t.id,
      inputs:  [{ id: 'params', type: 'object' }],
      outputs: [{ id: 'result', type: 'any' }],
    }))
  }

  let config: McpConfig
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return []
  }

  const nodes: CatalogNode[] = []

  for (const server of config.servers) {
    // args may reference host env vars as ${NAME} — same contract as mcp-pool
    const expand = (v: string) => v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
    const transport = new StdioClientTransport({
      command: server.command,
      args: (server.args ?? []).map(expand),
    })

    const client = new Client({ name: 'fractal-plant', version: '0.1.0' })

    try {
      await client.connect(transport, { timeout: 30000 })
      const { tools } = await client.listTools()

      for (const tool of tools) {
        nodes.push({
          id: `${server.name}__${tool.name}`,
          description: tool.description ?? tool.name,
          inputs:  [{ id: 'params', type: 'object' }],
          outputs: [{ id: 'result', type: 'any' }],
        })
      }
    } catch (err) {
      console.warn(`[mcp-catalog] could not connect to "${server.name}": ${err}`)
    } finally {
      await client.close()
    }
  }

  return nodes
}
