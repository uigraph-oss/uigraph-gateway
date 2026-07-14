import {
  contextSchema,
  convertMermaidToReactFlow,
  convertMermaidToReactFlowWithContext,
  convertUiGraphToMermaid,
} from '@uigraph/sdk'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { ApiError } from '../lib/errors'

const bodySchema = z.object({
  serviceName: z.string().min(1),
  name: z.string().min(1),
  mermaidContent: z.string().min(1),
  contextContent: z.string().optional(),
  gitCommitHash: z.string().optional(),
})

export const diagramRoutes = new Hono<AppEnv>()

diagramRoutes.post(
  '/service/architecture-diagram',
  zValidator('json', bodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const api = c.get('api')

    const service = await api.findService(body.serviceName)
    if (!service) {
      throw new ApiError(
        404,
        `service "${body.serviceName}" not found — sync the service first`
      )
    }
    const serviceId = service.id

    // Mermaid (+ optional context) → ReactFlow. componentId on context nodes
    // is threaded onto node.data.componentId by the SDK, so components render.
    let reactFlow
    if (body.contextContent) {
      let parsed: unknown
      try {
        parsed = JSON.parse(body.contextContent)
      } catch {
        throw new ApiError(400, 'contextContent is not valid JSON')
      }
      const context = contextSchema.parse(parsed)

      reactFlow = await convertMermaidToReactFlowWithContext(
        body.mermaidContent,
        context
      )
    } else {
      reactFlow = await convertMermaidToReactFlow(body.mermaidContent)
    }

    const content = JSON.stringify(reactFlow)

    // Upsert by name within the service.
    const existing = (await api.listServiceDiagrams(serviceId)).find(
      (d) => d.diagram?.name === body.name
    )

    let versionCreated = true
    if (existing?.diagram?.id) {
      const res = await api.syncDiagram({
        diagramId: existing.diagram.id,
        name: body.name,
        content,
        source: 'ci',
        teamId: service.teamId,
      })
      versionCreated = res.versionCreated
    } else {
      await api.createServiceDiagram(serviceId, {
        name: body.name,
        content,
        source: 'ci',
        teamId: service.teamId,
      })
    }

    return c.json({ name: body.name, versionCreated })
  }
)

const toMermaidSchema = z.object({
  content: z.string().min(1),
})

diagramRoutes.post(
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
