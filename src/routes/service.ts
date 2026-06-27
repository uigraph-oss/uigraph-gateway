import {
  AstToUiConverter,
  convertNoSQLToAst,
  generateUUID,
  SqlToAstParser,
  type ColumnAST,
  type SchemaAST,
  type SchemaDialect,
} from '@uigraph/sdk'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { ApiError } from '../lib/errors'

export const serviceRoutes = new Hono<AppEnv>()

const serviceSchema = z.object({
  service: z.object({
    name: z.string().min(1),
    category: z.string().optional(),
    description: z.string().optional(),
    repository: z.object({ provider: z.string(), url: z.string() }).optional(),
    ownership: z.object({
      team: z.string().min(1),
      email: z.string().optional(),
    }),
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
    teamName: service.ownership.team,
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

function parseNoSQLSchema(content: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new ApiError(400, 'schemaFileContent is not valid JSON')
  }
  return convertNoSQLToAst(parsed)
}

function buildDataModelDiagramContent(
  ast: SchemaAST,
  dataSourceId: string,
  dbName: string,
  dialect: SchemaDialect
): string {
  const { nodes, edges } = AstToUiConverter.toReactFlow(ast, dataSourceId)
  const dataSource = {
    id: dataSourceId,
    name: dbName,
    dialect,
    schemaAst: ast,
    sourceType: 'file',
    createdAt: Date.now(),
    modifiedAt: null,
  }
  return JSON.stringify({ nodes, edges, dataSources: [dataSource] })
}

function extractDbDiagramId(schemaJson: unknown): string | undefined {
  let parsed: unknown = schemaJson
  if (typeof schemaJson === 'string') {
    try {
      parsed = JSON.parse(schemaJson)
    } catch {
      return undefined
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const id = (parsed as { dbDiagramId?: unknown }).dbDiagramId
  return typeof id === 'string' ? id : undefined
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

  const existing = (await api.listDBs(serviceId)).find(
    (d) => d.dbName === body.dbName
  )

  let schemaJson: unknown
  if (body.dialect === 'dynamodb' || body.dialect === 'mongodb') {
    schemaJson = parseNoSQLSchema(body.schemaFileContent)
  } else {
    const sqlDialect = (sqlDialectMap[body.dialect] ?? 'mysql') as SchemaDialect
    const ast = new SqlToAstParser(sqlDialect).parse(body.schemaFileContent)

    const dataSourceId = generateUUID()
    const diagramContent = buildDataModelDiagramContent(
      ast,
      dataSourceId,
      body.dbName,
      sqlDialect
    )

    const existingDiagramId = extractDbDiagramId(existing?.schemaJson)
    let dbDiagramId: string | undefined
    if (existingDiagramId) {
      try {
        await api.updateDiagram(existingDiagramId, {
          content: diagramContent,
          source: 'ci',
        })
        dbDiagramId = existingDiagramId
      } catch (error) {
        if (!(error instanceof ApiError && error.statusCode === 404)) throw error
        dbDiagramId = undefined
      }
    }
    if (!dbDiagramId) {
      const created = await api.createDiagram({
        name: `${body.dbName} Schema Diagram`,
        content: diagramContent,
        source: 'ci',
      })
      dbDiagramId = created.id
    }

    schemaJson = { ...(normalizeDefaultValues(ast) as object), dbDiagramId }
  }

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
