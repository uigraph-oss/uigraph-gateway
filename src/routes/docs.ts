import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { getObjectBytes, presignPut } from '../clients/storage'
import { ApiError } from '../lib/errors'

export const docsRoutes = new Hono<AppEnv>()

const contentTypeByFileType: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html',
  markdown: 'text/markdown',
  doc: 'application/msword',
  txt: 'text/plain',
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
}

async function resolveService(
  api: AppEnv['Variables']['api'],
  serviceName: string
): Promise<string> {
  const id = await api.findServiceByName(serviceName)
  if (!id) {
    throw new ApiError(404, `service "${serviceName}" not found — sync the service first`)
  }
  return id
}

// prepare: decide upload vs skip, return a presigned PUT URL for the CLI.
const prepareSchema = z.object({
  serviceName: z.string().min(1),
  docName: z.string().min(1),
  contentHash: z.string().min(1),
  fileSize: z.number().optional(),
  filePath: z.string().optional(),
  fileType: z.string().optional(),
  description: z.string().optional(),
})

docsRoutes.post('/service/doc/prepare', zValidator('json', prepareSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const serviceId = await resolveService(api, body.serviceName)

  const existing = (await api.listDocs(serviceId)).find(
    (d) => d.fileName === body.docName
  )
  if (existing && existing.contentHash === body.contentHash) {
    return c.json({ action: 'skip', existingHash: existing.contentHash })
  }

  const orgId = await api.getOrgId()
  const fileId = `gateway-uploads/${orgId}/docs/${randomUUID()}`
  const contentType =
    contentTypeByFileType[body.fileType ?? ''] ?? 'application/octet-stream'
  const uploadUrl = await presignPut(fileId, contentType)

  return c.json({ action: 'upload', uploadUrl, fileId })
})

// complete: pull uploaded bytes from S3, register the doc with the backend.
const completeSchema = z.object({
  serviceName: z.string().min(1),
  docName: z.string().min(1),
  fileId: z.string().min(1),
  contentHash: z.string().min(1),
  fileType: z.string().optional(),
  description: z.string().optional(),
  commitHash: z.string().optional(),
})

docsRoutes.post('/service/doc/complete', zValidator('json', completeSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const serviceId = await resolveService(api, body.serviceName)

  const bytes = await getObjectBytes(body.fileId)
  const docBody = {
    fileName: body.docName,
    fileType: body.fileType,
    description: body.description,
    contentBase64: bytes.toString('base64'),
  }

  const existing = (await api.listDocs(serviceId)).find(
    (d) => d.fileName === body.docName
  )
  if (existing) {
    await api.updateDoc(existing.id, docBody)
  }
  if (!existing) {
    await api.createDoc(serviceId, { ...docBody, commitHash: body.commitHash ?? null })
  }

  return c.json({ name: body.docName, message: 'synced' })
})
