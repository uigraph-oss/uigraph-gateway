import {
  contextSchema,
  convertMermaidToReactFlow,
  convertMermaidToReactFlowWithContext,
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

    const serviceId = await api.findServiceByName(body.serviceName)
    if (!serviceId) {
      throw new ApiError(
        404,
        `service "${body.serviceName}" not found — sync the service first`
      )
    }

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

      const serviceIdByName = new Map<string, string | null>()
      const dbsByServiceId = new Map<string, Array<{ id: string; dbName: string }>>()

      reactFlow = await convertMermaidToReactFlowWithContext(
        body.mermaidContent,
        context,
        {
          resolveDbConfig: async (service, database) => {
            if (!serviceIdByName.has(service)) {
              serviceIdByName.set(service, await api.findServiceByName(service))
            }
            const dbServiceId = serviceIdByName.get(service)
            if (!dbServiceId) return undefined

            if (!dbsByServiceId.has(dbServiceId)) {
              dbsByServiceId.set(dbServiceId, await api.listDBs(dbServiceId))
            }
            const db = dbsByServiceId
              .get(dbServiceId)
              ?.find((d) => d.dbName === database)

            return { serviceId: dbServiceId, serviceDbId: db?.id }
          },
        }
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
      })
      versionCreated = res.versionCreated
    } else {
      await api.createServiceDiagram(serviceId, {
        name: body.name,
        content,
        source: 'ci',
      })
    }

    return c.json({ name: body.name, versionCreated })
  }
)
