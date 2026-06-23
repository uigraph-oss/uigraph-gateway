import {
  convertNoSQLToAst,
  SqlToAstParser,
  type ColumnAST,
  type SchemaAST,
} from '@uigraph/sdk'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { ApiError } from '../lib/errors'

export const serviceRoutes = new Hono<AppEnv>()

// ── Service upsert ────────────────────────────────────────────────────────────
const serviceSchema = z.object({
  service: z.object({
    name: z.string().min(1),
    category: z.string().optional(),
    description: z.string().optional(),
    repository: z.object({ provider: z.string(), url: z.string() }).optional(),
    ownership: z
      .object({ team: z.string().optional(), email: z.string().optional() })
      .optional(),
    labels: z.array(z.string()).optional(),
    integrations: z
      .object({
        jira: z.object({ url: z.string() }).optional(),
        slack: z.object({ url: z.string() }).optional(),
      })
      .optional(),
  }),
})

serviceRoutes.post('/service', zValidator('json', serviceSchema), async (c) => {
  const { service } = c.req.valid('json')
  const api = c.get('api')

  const body = {
    name: service.name,
    description: service.description ?? '',
    category: service.category ?? '',
    gitRepoUrl: service.repository?.url ?? null,
    jiraProjectUrl: service.integrations?.jira?.url ?? null,
    slackChannelUrl: service.integrations?.slack?.url ?? null,
    labels: service.labels ?? [],
  }

  const existingId = await api.findServiceByName(service.name)
  if (existingId) {
    await api.updateService(existingId, body)
  } else {
    await api.createService(body)
  }

  return c.json({ name: service.name })
})

// ── API group ─────────────────────────────────────────────────────────────────
const protocolByType: Record<string, string> = {
  openapi: 'REST',
  graphql: 'GraphQL',
  grpc: 'gRPC',
}

const apiGroupSchema = z.object({
  apiGroup: z.object({ name: z.string().min(1), type: z.string().min(1) }),
  spec: z.object({ content: z.string(), path: z.string().optional() }),
  serviceName: z.string().min(1),
})

serviceRoutes.post(
  '/service/api-group',
  zValidator('json', apiGroupSchema),
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

    const existing = (await api.listAPIGroups(serviceId)).find(
      (g) => g.name === body.apiGroup.name
    )

    const res = await api.syncAPIGroup(serviceId, {
      apiGroupId: existing?.id,
      name: body.apiGroup.name,
      version: 'v1',
      protocol: protocolByType[body.apiGroup.type] ?? 'REST',
      spec: body.spec.content,
    })

    return c.json({
      name: body.apiGroup.name,
      type: body.apiGroup.type,
      versionCreated: res.versionCreated,
    })
  }
)

// ── Database ────────────────────────────────────────────────────────────────────
const sqlDialectMap: Record<string, string> = {
  postgres: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite',
}

const dbSchema = z.object({
  serviceName: z.string().min(1),
  dbName: z.string().min(1),
  dialect: z.string().min(1),
  dbType: z.string().optional(),
  schemaFileContent: z.string().min(1),
})

function stringifyDefaultValue(column: ColumnAST): string | null {
  if (!column.defaultValue) return null
  if (column.defaultValue.raw != null) return column.defaultValue.raw
  if (column.defaultValue.value === null) return 'NULL'
  return String(column.defaultValue.value)
}

function normalizeDefaultValues(ast: SchemaAST): unknown {
  return {
    ...ast,
    tables: ast.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => ({
        ...column,
        defaultValue: stringifyDefaultValue(column),
      })),
    })),
  }
}

function parseSchema(dialect: string, content: string): unknown {
  if (dialect === 'dynamodb' || dialect === 'mongodb') {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new ApiError(400, 'schemaFileContent is not valid JSON')
    }
    return convertNoSQLToAst(parsed)
  }
  const sqlDialect = (sqlDialectMap[dialect] ?? 'mysql') as ConstructorParameters<
    typeof SqlToAstParser
  >[0]
  const ast = new SqlToAstParser(sqlDialect).parse(content)
  return normalizeDefaultValues(ast)
}

serviceRoutes.post('/service/database', zValidator('json', dbSchema), async (c) => {
  const body = c.req.valid('json')
  const api = c.get('api')

  const serviceId = await api.findServiceByName(body.serviceName)
  if (!serviceId) {
    throw new ApiError(
      404,
      `service "${body.serviceName}" not found — sync the service first`
    )
  }

  const schemaJson = parseSchema(body.dialect, body.schemaFileContent)

  const existing = (await api.listDBs(serviceId)).find(
    (d) => d.dbName === body.dbName
  )

  let versionCreated = true
  if (existing?.id) {
    await api.updateDB(serviceId, existing.id, {
      dbName: body.dbName,
      dbType: body.dbType ?? '',
      dialect: body.dialect,
      schemaJson,
      source: 'ci',
    })
  } else {
    await api.createDB(serviceId, {
      dbName: body.dbName,
      dbType: body.dbType ?? '',
      dialect: body.dialect,
      schemaJson,
      source: 'ci',
    })
  }

  return c.json({ dbName: body.dbName, versionCreated })
})
