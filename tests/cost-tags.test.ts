import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UIGRAPH_API_URL = 'http://backend.test'
process.env.STORAGE_ENDPOINT = 'http://minio.test:9000'
process.env.STORAGE_BUCKET = 'test-bucket'
process.env.STORAGE_ACCESS_KEY = 'test'
process.env.STORAGE_SECRET_KEY = 'test'

const { createApp } = await import('../src/app')
const app = createApp()

type Captured = { url: string; method: string; body?: unknown }
type Rule = { id: string; tagKey: string; tagValue: string }

function mockBackend(captured: Captured[], rules: Rule[]) {
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
    if (url.endsWith('/services/svc1/costs/tag-rules') && method === 'GET')
      return json({ tagRules: rules })
    if (url.endsWith('/services/svc1/costs/tag-rules') && method === 'POST')
      return json({ id: 'new-rule' })
    if (url.includes('/services/svc1/costs/tag-rules/') && method === 'DELETE')
      return json({})
    return json({ message: `unexpected ${method} ${url}` }, 500)
  })
}

describe('cost tag sync', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('creates missing rules and deletes the ones not in the payload', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, [
        { id: 'r1', tagKey: 'team', tagValue: 'checkout' },
        { id: 'r2', tagKey: 'stale', tagValue: 'gone' },
      ])
    )

    const res = await app.request('/v1/sync/service/cost-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        tags: [
          { key: 'team', value: 'checkout' },
          { key: 'Service', value: 'booking-api' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ created: 1, deleted: 1, unchanged: 1 })

    const creates = captured.filter(
      (c) => c.method === 'POST' && c.url.endsWith('/costs/tag-rules')
    )
    expect(creates).toHaveLength(1)
    expect(creates[0].body).toEqual({ tagKey: 'Service', tagValue: 'booking-api' })

    const deletes = captured.filter((c) => c.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('/costs/tag-rules/r2')
  })

  it('is a no-op when the backend already matches the config', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, [{ id: 'r1', tagKey: 'team', tagValue: 'checkout' }])
    )

    const res = await app.request('/v1/sync/service/cost-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        tags: [{ key: 'team', value: 'checkout' }],
      }),
    })

    expect(await res.json()).toEqual({ created: 0, deleted: 0, unchanged: 1 })
    expect(captured.filter((c) => c.method === 'POST' || c.method === 'DELETE')).toEqual([])
  })

  it('clears every rule when tags is empty', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, [
        { id: 'r1', tagKey: 'team', tagValue: 'checkout' },
        { id: 'r2', tagKey: 'env', tagValue: 'prod' },
      ])
    )

    const res = await app.request('/v1/sync/service/cost-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ serviceName: 'payments', tags: [] }),
    })

    expect(await res.json()).toEqual({ created: 0, deleted: 2, unchanged: 0 })
  })

  it('404s when the service has not been synced yet', async () => {
    const captured: Captured[] = []
    vi.stubGlobal('fetch', mockBackend(captured, []))

    const res = await app.request('/v1/sync/service/cost-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ serviceName: 'unknown', tags: [] }),
    })

    expect(res.status).toBe(404)
  })

  it('rejects duplicate key/value pairs', async () => {
    const captured: Captured[] = []
    vi.stubGlobal('fetch', mockBackend(captured, []))

    const res = await app.request('/v1/sync/service/cost-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        tags: [
          { key: 'team', value: 'checkout' },
          { key: 'team', value: 'checkout' },
        ],
      }),
    })

    expect(res.status).toBe(400)
  })
})
