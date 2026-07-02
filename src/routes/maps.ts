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

  const existingFrameId = (await api.listFrames(mapId)).find(
    (f) => f.name === body.frameName
  )?.id
  const frame = await api.syncFrame(mapId, {
    frameId: existingFrameId,
    name: body.frameName,
    description: body.description ?? '',
    templateType: 'blank',
  })
  const pageId = frame.frameId ?? existingFrameId

  if (!body.imagePath || !body.contentHash) {
    return c.json({ action: 'done', pageId })
  }

  const orgId = await api.getOrgId()
  const fileId = `gateway-uploads/${orgId}/frames/${randomUUID()}`
  const uploadUrl = await presignPut(fileId, 'image/png')
  return c.json({ action: 'upload', pageId, uploadUrl, fileId })
})

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

  const existingFrameId = (await api.listFrames(mapId)).find(
    (f) => f.name === body.frameName
  )?.id
  const frame = await api.syncFrame(mapId, {
    frameId: existingFrameId,
    name: body.frameName,
    description: body.description ?? '',
    templateType: 'blank',
    screenshot: body.fileId,
  })
  return c.json({ pageId: frame.frameId ?? existingFrameId, message: 'frame synced' })
})

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

const metaSchema = z.object({
  mapName: z.string().min(1),
  frameName: z.string().min(1),
  focalPointName: z.string().min(1),
  componentId: z.string().min(1),
  componentModalFields: z.array(z.unknown()).optional(),
  serviceName: z.string().optional(),
  architectureDiagramName: z.string().optional(),
  testPackName: z.string().optional(),
  apiGroupName: z.string().optional(),
  operationId: z.string().optional(),
  docName: z.string().optional(),
  componentLinkDiagramId: z.string().optional(),
  componentLinkApiEndpointId: z.string().optional(),
  componentLinkTestPackId: z.string().optional(),
  componentLinkServiceDocId: z.string().optional(),
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
  if (body.componentModalFields) payload.componentModalFields = body.componentModalFields

  if (body.componentLinkDiagramId)
    payload.componentLinkDiagramId = body.componentLinkDiagramId
  if (body.componentLinkApiEndpointId)
    payload.componentLinkApiEndpointId = body.componentLinkApiEndpointId
  if (body.componentLinkTestPackId)
    payload.componentLinkTestPackId = body.componentLinkTestPackId
  if (body.componentLinkServiceDocId)
    payload.componentLinkServiceDocId = body.componentLinkServiceDocId

  if (!payload.componentLinkDiagramId && body.architectureDiagramName && body.serviceName) {
    const serviceId = await api.findServiceByName(body.serviceName)
    if (serviceId) {
      const diagram = (await api.listServiceDiagrams(serviceId)).find(
        (d) => d.diagram?.name === body.architectureDiagramName
      )
      if (diagram?.diagram?.id) payload.componentLinkDiagramId = diagram.diagram.id
    }
  }

  if (!payload.componentLinkTestPackId && body.testPackName && body.serviceName) {
    const serviceId = await api.findServiceByName(body.serviceName)
    if (serviceId) {
      const pack = (await api.listTestPacks(serviceId)).find(
        (t) => t.name === body.testPackName
      )
      if (pack?.testPackId) payload.componentLinkTestPackId = pack.testPackId
    }
  }

  if (
    !payload.componentLinkApiEndpointId &&
    body.apiGroupName &&
    body.operationId &&
    body.serviceName
  ) {
    const serviceId = await api.findServiceByName(body.serviceName)
    if (serviceId) {
      const group = (await api.listAPIGroups(serviceId)).find(
        (g) => g.name === body.apiGroupName
      )
      if (group) {
        const endpoint = (await api.listAPIEndpoints(serviceId, group.id)).find(
          (e) => e.operationId === body.operationId
        )
        if (endpoint) payload.componentLinkApiEndpointId = endpoint.id
      }
    }
  }

  if (!payload.componentLinkServiceDocId && body.docName && body.serviceName) {
    const serviceId = await api.findServiceByName(body.serviceName)
    if (serviceId) {
      const doc = (await api.listDocs(serviceId)).find(
        (d) => d.fileName === body.docName
      )
      if (doc) payload.componentLinkServiceDocId = doc.id
    }
  }

  const existingMeta = (await api.listMeta(mapId, frameId, fp.id)).find(
    (m) => m.componentId === body.componentId
  )
  if (existingMeta) {
    await api.updateMeta(mapId, frameId, fp.id, existingMeta.id, payload)
    return c.json({
      focalPointMetaId: existingMeta.id,
      focalPointId: fp.id,
      componentId: body.componentId,
      message: 'meta synced',
    })
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
