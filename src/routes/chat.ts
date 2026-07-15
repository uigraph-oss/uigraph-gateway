import { resolveAiModel } from '@uigraph/ai-sdk'
import { zValidator } from '@hono/zod-validator'
import { generateText, stepCountIs, streamText, type ModelMessage } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { config } from '../lib/config'
import { ApiError } from '../lib/errors'
import { getMcpTools } from '../lib/mcp-cache'

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

  if (messages.length === 1 && messages[0].role === 'user') {
    const titleModel = resolveAiModel({
      npm: config.AI_PROVIDER_NPM,
      model: config.AI_PROVIDER_TITLE_MODEL ?? config.AI_PROVIDER_MODEL,
      apiKey: config.AI_PROVIDER_API_KEY,
      apiUrl: config.AI_PROVIDER_API_URL,
      options: config.AI_PROVIDER_OPTIONS,
    })
    const { text } = await generateText({
      model: titleModel,
      prompt: `Generate a short, concise title of 3 to 6 words for a conversation that begins with the following message. Respond with only the title, no quotes or punctuation.\n\n${messages[0].content}`,
    })
    await api.updateChatSession(orgId, sessionId, { title: text.trim() })
  }

  const { tools } = await getMcpTools({
    url: config.UIGRAPH_MCP_URL,
    orgId,
    token,
  })

  const result = streamText({
    model,
    messages,
    tools,
    stopWhen: stepCountIs(config.LLM_MAX_STEP),
  })

  result.consumeStream()

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      const text = responseMessage.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
      await api.createChatMessage(orgId, sessionId, {
        role: 'assistant',
        content: text,
        parts: responseMessage.parts,
      })
    },
  })
})
