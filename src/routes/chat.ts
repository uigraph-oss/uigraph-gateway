import { connectMcpTools, resolveAiModel } from '@uigraph/ai-sdk'
import { zValidator } from '@hono/zod-validator'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { config } from '../lib/config'
import { ApiError } from '../lib/errors'

export const chatRoutes = new Hono<AppEnv>()

const chatSchema = z.object({
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})

chatRoutes.post('/chat', zValidator('json', chatSchema), async (c) => {
  const { orgId, sessionId } = c.req.valid('json')
  const api = c.get('api')
  const token = c.get('token')

  if (!config.AI_PROVIDER_API_KEY) {
    throw new ApiError(500, 'AI provider is not configured')
  }
  if (!config.AI_PROVIDER_MODEL) {
    throw new ApiError(500, 'AI provider is not configured')
  }
  if (!config.UIGRAPH_MCP_URL) {
    throw new ApiError(500, 'MCP server is not configured')
  }

  const history = await api.listChatMessages(orgId, sessionId)
  const messages = history.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  })) as ModelMessage[]

  const model = resolveAiModel({
    npm: config.AI_PROVIDER_NPM,
    model: config.AI_PROVIDER_MODEL,
    apiKey: config.AI_PROVIDER_API_KEY,
    apiUrl: config.AI_PROVIDER_API_URL,
    options: config.AI_PROVIDER_OPTIONS,
  })

  const { client, tools } = await connectMcpTools({
    url: config.UIGRAPH_MCP_URL,
    orgId,
    accessToken: token,
    authType: 'user',
  })

  const result = streamText({
    model,
    messages,
    tools,
    stopWhen: stepCountIs(config.LLM_MAX_STEP),
  })

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      const text = responseMessage.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
      await api.createChatMessage(orgId, sessionId, {
        role: 'assistant',
        content: text,
      })
      await client.close()
    },
  })
})
