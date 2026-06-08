import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'fs'

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

export async function loadMcpCatalog(configPath = 'mcp.json'): Promise<CatalogNode[]> {
  let config: McpConfig
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return []
  }

  const nodes: CatalogNode[] = []

  for (const server of config.servers) {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
    })

    const client = new Client({ name: 'fractal-plant', version: '0.1.0' }, { timeout: 30000 })

    try {
      await client.connect(transport)
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
