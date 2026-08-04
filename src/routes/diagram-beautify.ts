import { zValidator } from '@hono/zod-validator'
import { resolveAiModel } from '@uigraph/ai-sdk'
import { generateObject, generateText } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import {
  DEFAULT_BEAUTIFY_PROMPT,
  DIAGRAM_BEAUTIFY_SYSTEM_PROMPT,
} from '../constants/system-prompt'
import { config } from '../lib/config'
import {
  applyStylePlan,
  buildDiagramDigest,
  stylePlanSchema,
  type StylePlan,
} from '../lib/diagram-style'
import { ApiError } from '../lib/errors'

export const diagramBeautifyRoutes = new Hono<AppEnv>()

const MAX_NODES = 300
const MAX_EDGES = 600

const beautifySchema = z.object({
  prompt: z.string().max(2000).optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).min(1),
  edges: z.array(z.record(z.string(), z.unknown())),
})

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new ApiError(
      502,
      'AI provider returned an unusable style plan',
      'AI_INVALID_RESPONSE'
    )
  }

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new ApiError(
      502,
      'AI provider returned an unusable style plan',
      'AI_INVALID_RESPONSE'
    )
  }
}

diagramBeautifyRoutes.post(
  '/diagrams/beautify',
  zValidator('json', beautifySchema),
  async (c) => {
    const { prompt, nodes, edges } = c.req.valid('json')

    if (!config.AI_PROVIDER_NPM && !config.AI_PROVIDER_API_URL) {
      throw new ApiError(
        500,
        'AI provider is not configured',
        'AI_PROVIDER_NOT_CONFIGURED'
      )
    }
    if (!config.AI_PROVIDER_API_KEY) {
      throw new ApiError(
        500,
        'AI provider is not configured',
        'AI_PROVIDER_NOT_CONFIGURED'
      )
    }
    if (!config.AI_PROVIDER_MODEL) {
      throw new ApiError(
        500,
        'AI provider is not configured',
        'AI_PROVIDER_NOT_CONFIGURED'
      )
    }

    if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) {
      throw new ApiError(
        400,
        `diagram is too large to beautify — limit is ${MAX_NODES} nodes and ${MAX_EDGES} edges`,
        'DIAGRAM_TOO_LARGE'
      )
    }

    const model = resolveAiModel({
      npm: config.AI_PROVIDER_NPM,
      model: config.AI_PROVIDER_BEAUTIFY_MODEL ?? config.AI_PROVIDER_MODEL,
      apiKey: config.AI_PROVIDER_API_KEY,
      apiUrl: config.AI_PROVIDER_API_URL,
      options: config.AI_PROVIDER_OPTIONS,
    })

    const digest = buildDiagramDigest(nodes, edges)
    const styleRequest = prompt?.trim() ? prompt.trim() : DEFAULT_BEAUTIFY_PROMPT

    const userPrompt = `Style request:\n${styleRequest}\n\nDiagram digest:\n${JSON.stringify(digest)}`

    let plan: StylePlan
    try {
      const { object } = await generateObject({
        model,
        schema: stylePlanSchema,
        system: DIAGRAM_BEAUTIFY_SYSTEM_PROMPT,
        prompt: userPrompt,
      })
      plan = object
    } catch {
      const { text } = await generateText({
        model,
        system: DIAGRAM_BEAUTIFY_SYSTEM_PROMPT,
        prompt: `${userPrompt}\n\nRespond with a single JSON object matching this shape and nothing else:\n{"theme":string,"summary":string,"layout":"LR"|"TB"|"none","nodes":[{"id":string,"fill"?:string,"stroke"?:string,"strokeWidth"?:number,"strokeStyle"?:"solid"|"dashed"|"dotted","cornerRadius"?:number,"textColor"?:string,"textFontSize"?:number,"shape"?:string,"width"?:number,"height"?:number}],"edges":[{"id":string,"stroke"?:string,"strokeWidth"?:number,"strokeStyle"?:"solid"|"dashed"|"dotted","animated"?:boolean,"labelColor"?:string}]}`,
      })

      const parsed = stylePlanSchema.safeParse(extractJsonObject(text))
      if (!parsed.success) {
        throw new ApiError(
          502,
          'AI provider returned an unusable style plan',
          'AI_INVALID_RESPONSE'
        )
      }
      plan = parsed.data
    }

    const styled = applyStylePlan(nodes, edges, plan)

    return c.json({
      nodes: styled.nodes,
      edges: styled.edges,
      layout: styled.layout,
      theme: plan.theme,
      summary: plan.summary,
    })
  }
)
