import { convertUiGraphToMermaid } from '@uigraph/sdk'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { ApiError } from '../lib/errors'

const toMermaidSchema = z.object({
  content: z.string().min(1),
})

export const conversionRoutes = new Hono<AppEnv>()

conversionRoutes.post(
  '/diagrams/to-mermaid',
  zValidator('json', toMermaidSchema),
  async (c) => {
    const body = c.req.valid('json')

    let parsed: unknown
    try {
      parsed = JSON.parse(body.content)
    } catch {
      throw new ApiError(400, 'content is not valid JSON')
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { nodes?: unknown }).nodes) ||
      !Array.isArray((parsed as { edges?: unknown }).edges)
    ) {
      throw new ApiError(400, 'content is not a ReactFlow diagram { nodes, edges }')
    }

    const { nodes, edges } = parsed as { nodes: unknown[]; edges: unknown[] }
    const { mermaid } = convertUiGraphToMermaid({
      nodes: nodes as never,
      edges: edges as never,
    })

    return c.json({ mermaid })
  }
)
