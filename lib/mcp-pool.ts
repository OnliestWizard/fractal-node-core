import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'fs'

interface McpServerConfig {
  name: string
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

// Lazy pool: connect() only reads the config — each server process spawns on
// the first callTool that needs it, so a run touching one server costs one
// npx child instead of all of them (RAM matters on this laptop).
export class McpPool {
  private clients = new Map<string, Client>()
  private configs = new Map<string, McpServerConfig>()
  private connecting = new Map<string, Promise<Client | null>>()

  async connect(configPath = 'mcp.json'): Promise<void> {
    let config: { servers: McpServerConfig[] }
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch {
      return
    }
    for (const server of config.servers) {
      this.configs.set(server.name, server)
    }
  }

  // Failed spawns are not cached — npx cold starts can time out once and
  // succeed on retry, so the next call gets a fresh attempt.
  private clientFor(serverId: string): Promise<Client | null> {
    const existing = this.clients.get(serverId)
    if (existing) return Promise.resolve(existing)

    const pending = this.connecting.get(serverId)
    if (pending) return pending

    const server = this.configs.get(serverId)
    if (!server) return Promise.resolve(null)

    const attempt = (async () => {
      // server.env values and args may reference host env vars as ${NAME} so
      // mcp.json never holds secrets or machine-specific paths
      const expand = (v: string) => v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
      const serverEnv = Object.fromEntries(Object.entries(server.env ?? {}).map(([k, v]) => [k, expand(v)]))
      const env = { ...(process.env as Record<string, string>), ...serverEnv }
      const args = (server.args ?? []).map(expand)
      const transport = new StdioClientTransport({ command: server.command, args, env })
      const client = new Client({ name: 'fractal-execute', version: '0.1.0' })
      try {
        await client.connect(transport, { timeout: 30000 })
        this.clients.set(server.name, client)
        console.log(`[pool] connected: ${server.name}`)
        return client
      } catch (err) {
        console.warn(`[pool] could not connect to "${server.name}": ${err}`)
        // a timed-out spawn may still come up later — kill it or it lingers
        try { await client.close() } catch { /* ignore cleanup errors */ }
        return null
      } finally {
        this.connecting.delete(serverId)
      }
    })()

    this.connecting.set(serverId, attempt)
    return attempt
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.clientFor(serverId)
    if (!client) throw new Error(`No MCP connection for server "${serverId}"`)

    const result = await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: 60000 })

    if (Array.isArray(result.content)) {
      const texts = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text)
      return texts.length === 1 ? texts[0] : texts.join('\n')
    }
    return result.content
  }

  // The agent node's tool list needs every server, so this is the one path
  // that still brings the whole pool up.
  async listTools(): Promise<Array<{ id: string; description: string; inputSchema: Record<string, unknown> }>> {
    for (const name of this.configs.keys()) {
      await this.clientFor(name)
    }
    const results: Array<{ id: string; description: string; inputSchema: Record<string, unknown> }> = []
    for (const [serverId, client] of this.clients) {
      try {
        const { tools } = await client.listTools()
        for (const tool of tools) {
          results.push({
            id: `${serverId}__${tool.name}`,
            description: tool.description ?? '',
            inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
          })
        }
      } catch { /* skip unreachable servers */ }
    }
    return results
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      try { await client.close() } catch { /* ignore cleanup errors */ }
    }
    this.clients.clear()
    this.configs.clear()
    this.connecting.clear()
  }
}
