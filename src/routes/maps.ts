import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { presignPut } from '../clients/storage'
import { ApiError } from '../lib/errors'
import type { UigraphApi } from '../clients/uigraph-api'

export const mapRoutes = new Hono<AppEnv>()

async function resolveMap(api: UigraphApi, mapName: string): Promise<string> {
  const m = (await api.listMaps()).find((x) => x.name === mapName)
  if (!m) throw new ApiError(404, `map "${mapName}" not found`)
  return m.id
}

async function resolveFrame(
  api: UigraphApi,
  mapId: string,
  frameName: string
): Promise<string> {
  const f = (await api.listFrames(mapId)).find((x) => x.name === frameName)
  if (!f) throw new ApiError(404, `frame "${frameName}" not found`)
  return f.id
}

// ── Map upsert ──────────────────────────────────────────────────────────────────
const mapSchema = z.object({
  mapName: z.string().min(1),
  description: z.string().optional(),
})

mapRoutes.post('/map', zValidator('json', mapSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')

  const existing = (await api.listMaps()).find((m) => m.name === body.mapName)
  if (existing) {
    return c.json({ mapId: existing.id, message: 'map exists' })
  }
  const created = await api.createMap({
    name: body.mapName,
    description: body.description ?? '',
  })
  return c.json({ mapId: created.id, message: 'map created' })
})

// ── Frame prepare ─────────────────────────────────────────────────────────────────
const framePrepareSchema = z.object({
  mapName: z.string().min(1),
  frameName: z.string().min(1),
  description: z.string().optional(),
  contentHash: z.string().optional(),
  fileSize: z.number().optional(),
  imagePath: z.string().optional(),
})

mapRoutes.post('/frame/prepare', zValidator('json', framePrepareSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const mapId = await resolveMap(api, body.mapName)

  // Upsert the frame metadata.
  const frame = await api.syncFrame(mapId, {
    name: body.frameName,
    description: body.description ?? '',
    templateType: 'blank',
  })
  const pageId = frame.id

  // No image → metadata-only.
  if (!body.imagePath || !body.contentHash) {
    return c.json({ action: 'done', pageId })
  }

  const orgId = await api.getOrgId()
  const fileId = `gateway-uploads/${orgId}/frames/${randomUUID()}`
  const uploadUrl = await presignPut(fileId, 'image/png')
  return c.json({ action: 'upload', pageId, uploadUrl, fileId })
})

// ── Frame complete ──────────────────────────────────────────────────────────────
const frameCompleteSchema = z.object({
  mapName: z.string().min(1),
  frameName: z.string().min(1),
  fileId: z.string().min(1),
  contentHash: z.string().min(1),
  description: z.string().optional(),
})

mapRoutes.post('/frame/complete', zValidator('json', frameCompleteSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const mapId = await resolveMap(api, body.mapName)

  const frame = await api.syncFrame(mapId, {
    name: body.frameName,
    description: body.description ?? '',
    templateType: 'blank',
    screenshot: body.fileId,
  })
  return c.json({ pageId: frame.id, message: 'frame synced' })
})

// ── Focal point upsert ────────────────────────────────────────────────────────────
const focalSchema = z.object({
  mapName: z.string().min(1),
  frameName: z.string().min(1),
  focalPointName: z.string().min(1),
  x: z.number(),
  y: z.number(),
  visibility: z.string().optional(),
})

mapRoutes.post('/focal-point', zValidator('json', focalSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const mapId = await resolveMap(api, body.mapName)
  const frameId = await resolveFrame(api, mapId, body.frameName)

  const existing = (await api.listFocalPoints(mapId, frameId)).find(
    (f) => f.name === body.focalPointName
  )
  const payload = {
    name: body.focalPointName,
    locationX: body.x,
    locationY: body.y,
    visibility: body.visibility ?? 'public',
    isActive: true,
  }

  let focalPointId: string
  if (existing) {
    await api.updateFocalPoint(mapId, frameId, existing.id, payload)
    focalPointId = existing.id
  } else {
    const created = await api.createFocalPoint(mapId, frameId, payload)
    focalPointId = created.id
  }

  return c.json({ focalPointId, pageId: frameId, message: 'focal point synced' })
})

// ── Focal point meta (component link) ───────────────────────────────────────────────
const metaSchema = z.object({
  mapName: z.string().min(1),
  frameName: z.string().min(1),
  focalPointName: z.string().min(1),
  componentId: z.string().min(1),
  componentLinkId: z.string().optional(),
  componentModalFields: z.array(z.unknown()).optional(),
  serviceName: z.string().optional(),
  architectureDiagramName: z.string().optional(),
})

mapRoutes.post('/focal-point-meta', zValidator('json', metaSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const mapId = await resolveMap(api, body.mapName)
  const frameId = await resolveFrame(api, mapId, body.frameName)
  const fp = (await api.listFocalPoints(mapId, frameId)).find(
    (f) => f.name === body.focalPointName
  )
  if (!fp) throw new ApiError(404, `focal point "${body.focalPointName}" not found`)

  const payload: Record<string, unknown> = { componentId: body.componentId }
  if (body.componentLinkId) payload.componentLinkId = body.componentLinkId
  if (body.componentModalFields) payload.componentModalFields = body.componentModalFields

  // Backend-flow-diagram link resolved by diagram name within the service.
  if (body.architectureDiagramName && body.serviceName && !body.componentLinkId) {
    const serviceId = await api.findServiceByName(body.serviceName)
    if (serviceId) {
      const diagram = (await api.listServiceDiagrams(serviceId)).find(
        (d) => d.diagram?.name === body.architectureDiagramName
      )
      if (diagram?.diagram?.id) payload.componentFlowDiagram = diagram.diagram.id
    }
  }

  const res = (await api.createMeta(mapId, frameId, fp.id, payload)) as {
    id?: string
  }
  return c.json({
    focalPointMetaId: res.id ?? '',
    focalPointId: fp.id,
    componentId: body.componentId,
    message: 'meta synced',
  })
})
