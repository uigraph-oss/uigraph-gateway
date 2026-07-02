import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UIGRAPH_API_URL = 'http://backend.test'
process.env.STORAGE_ENDPOINT = 'http://minio.test:9000'
process.env.STORAGE_BUCKET = 'test-bucket'
process.env.STORAGE_ACCESS_KEY = 'test'
process.env.STORAGE_SECRET_KEY = 'test'

const { createApp } = await import('../src/app')
const app = createApp()

type Captured = { url: string; method: string; body?: unknown }

function mockBackend(captured: Captured[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    captured.push({ url, method, body })

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (url.endsWith('/api/v1/auth/me')) return json({ orgId: 'org1' })
    if (url.endsWith('/api/v1/orgs/org1/services'))
      return json({ services: [{ id: 'svc1', name: 'payments' }] })
    if (url.endsWith('/api/v1/orgs/org1/services/svc1/dbs') && method === 'GET')
      return json({ dbs: [{ id: 'db1', dbName: 'primary' }] })
    if (url.endsWith('/api/v1/orgs/org1/services/svc1/dbs/db1/queries/sync'))
      return json({ id: 'q1', created: true })
    return json({ message: `unexpected ${method} ${url}` }, 500)
  })
}

describe('saved query sync', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('resolves service and db by name, then upserts by sourceRef', async () => {
    const captured: Captured[] = []
    vi.stubGlobal('fetch', mockBackend(captured))

    const res = await app.request('/v1/sync/service/database/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        dbName: 'primary',
        sourceRef: 'top-customers',
        title: 'Top Customers',
        queryText: 'select 1',
        tags: ['reporting'],
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sourceRef: 'top-customers',
      id: 'q1',
      created: true,
    })

    const sync = captured.find((c) =>
      c.url.endsWith('/services/svc1/dbs/db1/queries/sync')
    )
    expect(sync).toBeDefined()
    expect(sync!.body).toEqual({
      sourceRef: 'top-customers',
      title: 'Top Customers',
      description: '',
      queryText: 'select 1',
      tags: ['reporting'],
    })
  })

  it('404s when the database has not been synced yet', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const json = (data: unknown, status = 200) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { 'Content-Type': 'application/json' },
          })
        captured.push({ url, method: init?.method ?? 'GET' })
        if (url.endsWith('/api/v1/auth/me')) return json({ orgId: 'org1' })
        if (url.endsWith('/api/v1/orgs/org1/services'))
          return json({ services: [{ id: 'svc1', name: 'payments' }] })
        if (url.endsWith('/api/v1/orgs/org1/services/svc1/dbs'))
          return json({ dbs: [] })
        return json({ message: 'unexpected' }, 500)
      })
    )

    const res = await app.request('/v1/sync/service/database/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        dbName: 'missing-db',
        sourceRef: 'top-customers',
        title: 'Top Customers',
        queryText: 'select 1',
      }),
    })

    expect(res.status).toBe(404)
  })
})
