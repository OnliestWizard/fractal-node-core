import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'fs'

interface McpServerConfig {
  name: string
  transport: 'stdio'
  command: string
  args?: string[]
}

export class McpPool {
  private clients = new Map<string, Client>()

  async connect(configPath = 'mcp.json'): Promise<void> {
    let config: { servers: McpServerConfig[] }
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch {
      return
    }

    for (const server of config.servers) {
      const transport = new StdioClientTransport({ command: server.command, args: server.args ?? [] })
      const client = new Client({ name: 'fractal-execute', version: '0.1.0' }, { timeout: 30000 })
      try {
        await client.connect(transport)
        this.clients.set(server.name, client)
        console.log(`[pool] connected: ${server.name}`)
      } catch (err) {
        console.warn(`[pool] could not connect to "${server.name}": ${err}`)
      }
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(serverId)
    if (!client) throw new Error(`No MCP connection for server "${serverId}"`)

    const result = await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: 60000 })

    if (Array.isArray(result.content)) {
      const texts = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text)
      return texts.length === 1 ? texts[0] : texts.join('\n')
    }
    return result.content
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      try { await client.close() } catch { /* ignore cleanup errors */ }
    }
    this.clients.clear()
  }
}
