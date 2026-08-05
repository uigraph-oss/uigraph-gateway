import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { ApiError } from '../lib/errors'

export const timelineRoutes = new Hono<AppEnv>()

const eventSchema = z.object({
  sourceRef: z.string().min(1),
  type: z.enum(['release', 'decision', 'incident']),
  title: z.string().min(1),
  summary: z.string().optional(),
  eventDate: z.string().datetime({ offset: true }),
  version: z.string().optional(),
  adrNumber: z.string().optional(),
  decisionStatus: z
    .enum(['proposed', 'accepted', 'superseded', 'deprecated'])
    .optional(),
  sourceLabel: z.string().optional(),
  sourceUrl: z.string().optional(),
  touches: z
    .array(z.object({ id: z.string(), label: z.string(), kind: z.string() }))
    .optional(),
})

const timelineSchema = z.object({
  serviceName: z.string().min(1),
  commitHash: z.string().optional(),
  events: z.array(eventSchema).refine(
    (events) => new Set(events.map((e) => e.sourceRef)).size === events.length,
    { message: 'event sourceRefs must be unique' }
  ),
})

// Each event is upserted by sourceRef. The create-vs-update decision is
// delegated whole to uigraph-api's ON CONFLICT upsert, which is race-free
// under concurrent syncs, so a re-scan of an unchanged repo is a no-op.
timelineRoutes.post(
  '/service/timeline',
  zValidator('json', timelineSchema),
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

    let created = 0
    let updated = 0
    for (const event of body.events) {
      const result = await api.syncTimelineEvent(serviceId, {
        ...event,
        summary: event.summary ?? '',
        touches: event.touches ?? [],
        commitHash: body.commitHash,
      })
      if (result.created) created++
      if (!result.created) updated++
    }

    return c.json({ synced: body.events.length, created, updated })
  }
)
