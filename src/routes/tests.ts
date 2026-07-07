import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { ApiError } from '../lib/errors'

export const testRoutes = new Hono<AppEnv>()

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

// ── Test pack ─────────────────────────────────────────────────────────────────
const packSchema = z.object({
  serviceName: z.string().min(1),
  testPack: z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    environment: z.string().optional(),
    releaseLabel: z.string().optional(),
  }),
  git: z.object({ commitHash: z.string().optional() }).optional(),
})

testRoutes.post('/service/test-pack', zValidator('json', packSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const serviceId = await resolveService(api, body.serviceName)

  const existing = (await api.listTestPacks(serviceId)).find(
    (p) => p.name === body.testPack.name
  )
  if (existing) {
    return c.json({
      testPackId: existing.testPackId,
      name: body.testPack.name,
      type: body.testPack.type,
    })
  }

  const created = await api.createTestPack(serviceId, {
    name: body.testPack.name,
    type: body.testPack.type,
    commitHash: body.git?.commitHash ?? null,
  })
  return c.json({
    testPackId: created.testPackId,
    name: body.testPack.name,
    type: body.testPack.type,
  })
})

// ── Test case ───────────────────────────────────────────────────────────────────
const caseSchema = z.object({
  serviceName: z.string().min(1),
  testPackId: z.string().min(1),
  git: z.object({ commitHash: z.string().optional() }).optional(),
  testCase: z
    .object({
      type: z.string().min(1),
      title: z.string().min(1),
      order: z.number().default(0),
      description: z.string().optional(),
      priority: z.string().optional(),
      labels: z.array(z.string()).optional(),
      linkedTicket: z.string().optional(),
      estimatedDurationMins: z.number().optional(),
      testOwner: z.string().optional(),
      isCritical: z.boolean().optional(),
      requiresEvidence: z.boolean().optional(),
      // manual
      stepsList: z
        .array(z.object({ action: z.string(), expectedResult: z.string().optional() }))
        .optional(),
      preconditions: z.string().optional(),
      testData: z.string().optional(),
      expectedOutcome: z.string().optional(),
      postconditions: z.string().optional(),
      // api
      apiGroupName: z.string().optional(),
      operationId: z.string().optional(),
      expectedStatusCode: z.number().optional(),
      requestTemplate: z.string().optional(),
      maxResponseTimeMs: z.number().optional(),
      responseBody: z.string().optional(),
      assertions: z
        .array(z.object({ field: z.string(), type: z.string(), value: z.string() }))
        .optional(),
    })
    .passthrough(),
})

async function resolveHttpMethod(
  api: AppEnv['Variables']['api'],
  serviceId: string,
  apiGroupName: string | undefined,
  operationId: string | undefined
): Promise<string> {
  if (!operationId) {
    return 'GET'
  }
  const groups = await api.listAPIGroups(serviceId)
  const candidates = apiGroupName ? groups.filter((g) => g.name === apiGroupName) : groups
  for (const group of candidates) {
    const endpoints = await api.listAPIEndpoints(serviceId, group.id)
    const match = endpoints.find((e) => e.operationId === operationId)
    if (match && match.method) {
      return match.method.toUpperCase()
    }
  }
  return 'GET'
}

testRoutes.post('/service/test-case', zValidator('json', caseSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')
  const serviceId = await resolveService(api, body.serviceName)
  const tc = body.testCase

  const payload: Record<string, unknown> = {
    testPackId: body.testPackId,
    title: tc.title,
    type: tc.type,
    order: tc.order ?? 0,
    description: tc.description,
    priority: tc.priority,
    labels: tc.labels,
    linkedTicket: tc.linkedTicket,
    estimatedDurationMins: tc.estimatedDurationMins,
    testOwner: tc.testOwner,
    isCritical: tc.isCritical ?? false,
    evidenceRequired: tc.requiresEvidence ?? false,
    commitHash: body.git?.commitHash ?? null,
  }

  if (tc.type === 'manual') {
    payload.manual = {
      preconditions: tc.preconditions,
      testData: tc.testData,
      steps: (tc.stepsList ?? []).map((s) => ({
        action: s.action,
        expectedResult: s.expectedResult,
      })),
      expectedOutcome: tc.expectedOutcome,
      postconditions: tc.postconditions,
    }
  } else if (tc.type === 'api') {
    payload.api = {
      httpMethod: await resolveHttpMethod(api, serviceId, tc.apiGroupName, tc.operationId),
      operationId: tc.operationId,
      requestBody: tc.requestTemplate,
      expectedStatusCode: tc.expectedStatusCode,
      maxResponseTimeMs: tc.maxResponseTimeMs,
      responseBody: tc.responseBody,
      assertions: tc.assertions,
    }
  }

  const existing = (await api.listTestCases(serviceId, body.testPackId)).find(
    (t) => t.title === tc.title
  )
  if (existing) {
    await api.updateTestCase(serviceId, existing.testCaseId, payload)
  }
  if (!existing) {
    await api.createTestCase(serviceId, payload)
  }
  return c.json({ title: tc.title })
})
