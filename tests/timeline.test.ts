import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UIGRAPH_API_URL = 'http://backend.test'
process.env.STORAGE_ENDPOINT = 'http://minio.test:9000'
process.env.STORAGE_BUCKET = 'test-bucket'
process.env.STORAGE_ACCESS_KEY = 'test'
process.env.STORAGE_SECRET_KEY = 'test'

const { createApp } = await import('../src/app')
const app = createApp()

type Captured = { url: string; method: string; body?: unknown }

function mockBackend(captured: Captured[], createdBySourceRef: Record<string, boolean>) {
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
    if (url.endsWith('/services/svc1/timeline/sync')) {
      const sourceRef = (body as { sourceRef: string }).sourceRef
      return json({
        created: createdBySourceRef[sourceRef],
        event: { id: `evt-${sourceRef}`, title: (body as { title: string }).title },
      })
    }
    return json({ message: `unexpected ${method} ${url}` }, 500)
  })
}

describe('timeline sync', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('upserts every event and reports created vs updated', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, { 'adr:docs/adr/0001-db.md': true, 'incident:docs/pm/outage.md': false })
    )

    const res = await app.request('/v1/sync/service/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        commitHash: 'abc123',
        events: [
          {
            sourceRef: 'adr:docs/adr/0001-db.md',
            type: 'decision',
            title: 'Use Postgres',
            eventDate: '2026-01-02T00:00:00Z',
            adrNumber: '0001',
            decisionStatus: 'accepted',
          },
          {
            sourceRef: 'incident:docs/pm/outage.md',
            type: 'incident',
            title: 'Checkout outage',
            summary: 'Connection pool exhausted',
            eventDate: '2026-02-03T00:00:00Z',
          },
        ],
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ synced: 2, created: 1, updated: 1 })

    const syncs = captured.filter((c) => c.url.endsWith('/timeline/sync'))
    expect(syncs).toHaveLength(2)
    expect(syncs[0].body).toEqual({
      sourceRef: 'adr:docs/adr/0001-db.md',
      type: 'decision',
      title: 'Use Postgres',
      summary: '',
      eventDate: '2026-01-02T00:00:00Z',
      adrNumber: '0001',
      decisionStatus: 'accepted',
      touches: [],
      commitHash: 'abc123',
    })
  })

  it('404s when the service has not been synced yet', async () => {
    vi.stubGlobal('fetch', mockBackend([], {}))

    const res = await app.request('/v1/sync/service/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'unknown',
        events: [
          {
            sourceRef: 'release:v1.0.0',
            type: 'release',
            title: 'v1.0.0',
            eventDate: '2026-01-02T00:00:00Z',
          },
        ],
      }),
    })

    expect(res.status).toBe(404)
  })

  it('rejects duplicate sourceRefs in one payload', async () => {
    vi.stubGlobal('fetch', mockBackend([], {}))

    const event = {
      sourceRef: 'release:v1.0.0',
      type: 'release',
      title: 'v1.0.0',
      eventDate: '2026-01-02T00:00:00Z',
    }
    const res = await app.request('/v1/sync/service/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ serviceName: 'payments', events: [event, event] }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects an unknown event type', async () => {
    vi.stubGlobal('fetch', mockBackend([], {}))

    const res = await app.request('/v1/sync/service/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        events: [
          {
            sourceRef: 'x:1',
            type: 'deployment',
            title: 'nope',
            eventDate: '2026-01-02T00:00:00Z',
          },
        ],
      }),
    })

    expect(res.status).toBe(400)
  })
})
