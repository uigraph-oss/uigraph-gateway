import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'

export const mlRoutes = new Hono<AppEnv>()

const projectSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['model', 'training']),
  description: z.string().optional(),
  sourceType: z.string().optional(),
  sourceUrl: z.string().optional(),
  team: z.string().optional(),
  email: z.string().optional(),
})

const modelSchema = z
  .object({
    mlflowId: z.string().min(1),
    projectName: z.string().optional(),
    name: z.string().min(1),
  })
  .passthrough()

const versionSchema = z
  .object({
    mlflowId: z.string().min(1),
    modelMlflowId: z.string().min(1),
  })
  .passthrough()

const experimentSchema = z
  .object({
    mlflowId: z.string().min(1),
    projectName: z.string().optional(),
    name: z.string().min(1),
  })
  .passthrough()

const runSchema = z
  .object({
    mlflowId: z.string().min(1),
    experimentMlflowId: z.string().min(1),
  })
  .passthrough()

const seriesPointSchema = z
  .object({
    key: z.string().min(1),
    step: z.number(),
    value: z.number(),
  })
  .passthrough()

const artifactSchema = z
  .object({
    mlflowId: z.string().min(1),
    runMlflowId: z.string().min(1),
  })
  .passthrough()

const datasetSchema = z
  .object({
    mlflowId: z.string().min(1),
    experimentMlflowId: z.string().min(1),
  })
  .passthrough()

mlRoutes.post(
  '/ml/projects',
  zValidator('json', z.array(projectSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlProjects(c.req.valid('json'))
    return c.json(res)
  }
)

mlRoutes.post(
  '/ml/models',
  zValidator('json', z.array(modelSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlModels(c.req.valid('json'))
    return c.json(res)
  }
)

mlRoutes.post(
  '/ml/versions',
  zValidator('json', z.array(versionSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlVersions(c.req.valid('json'))
    return c.json(res)
  }
)

mlRoutes.post(
  '/ml/experiments',
  zValidator('json', z.array(experimentSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlExperiments(c.req.valid('json'))
    return c.json(res)
  }
)

mlRoutes.post('/ml/runs', zValidator('json', z.array(runSchema)), async (c) => {
  const api = c.get('api')
  const res = await api.syncMlRuns(c.req.valid('json'))
  return c.json(res)
})

mlRoutes.post(
  '/ml/runs/:runId/series',
  zValidator('json', z.array(seriesPointSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlRunSeries(
      c.req.param('runId'),
      c.req.valid('json')
    )
    return c.json(res)
  }
)

mlRoutes.post(
  '/ml/artifacts',
  zValidator('json', z.array(artifactSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlArtifacts(c.req.valid('json'))
    return c.json(res)
  }
)

mlRoutes.post(
  '/ml/datasets',
  zValidator('json', z.array(datasetSchema)),
  async (c) => {
    const api = c.get('api')
    const res = await api.syncMlDatasets(c.req.valid('json'))
    return c.json(res)
  }
)
