import { connectMcpTools, type McpClient } from '@uigraph/ai-sdk'
import type { ToolSet } from 'ai'
import { config } from './config'

type CacheEntry = {
  client: McpClient
  tools: ToolSet
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

type GetMcpToolsConfig = {
  url: string
  orgId: string
  token: string
}

export async function getMcpTools(
  input: GetMcpToolsConfig
): Promise<{ client: McpClient; tools: ToolSet }> {
  const key = `${input.token}::${input.orgId}`
  const cached = cache.get(key)

  if (cached && cached.expiresAt > Date.now()) {
    return { client: cached.client, tools: cached.tools }
  }

  if (cached) {
    cache.delete(key)
    await cached.client.close()
  }

  const { client, tools } = await connectMcpTools({
    url: input.url,
    orgId: input.orgId,
    accessToken: input.token,
    authType: 'user',
    clientName: 'UiGraph AI Chat',
  })

  delete tools.get_current_user

  cache.set(key, {
    client,
    tools,
    expiresAt: Date.now() + config.MCP_CACHE_TTL_MS,
  })

  return { client, tools }
}
