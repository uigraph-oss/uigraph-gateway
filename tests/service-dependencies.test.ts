import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UIGRAPH_API_URL = 'http://backend.test'
process.env.STORAGE_ENDPOINT = 'http://minio.test:9000'
process.env.STORAGE_BUCKET = 'test-bucket'
process.env.STORAGE_ACCESS_KEY = 'test'
process.env.STORAGE_SECRET_KEY = 'test'

const { createApp } = await import('../src/app')
const app = createApp()

describe('service dependency sync', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('resolves the source service and forwards dependencies unchanged', async () => {
    const captured: Array<{ url: string; method: string; body?: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      captured.push({ url, method: init?.method ?? 'GET', body })
      if (url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ orgId: 'org1' }))
      if (url.endsWith('/api/v1/orgs/org1/services')) return new Response(JSON.stringify({ services: [{ id: 'svc1', name: 'payments' }] }))
      if (url.endsWith('/api/v1/orgs/org1/services/svc1/dependencies/sync')) return new Response(JSON.stringify({}))
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 })
    }))

    const dependency = { name: 'payment-provider', service: 'Stripe Payments', type: 'http', criticality: 'hard', description: 'Charges cards', apiGroupName: 'payments-v1', apiEndpointNames: ['CreatePayment'] }
    const res = await app.request('/v1/sync/service/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ serviceName: 'payments', dependencies: [dependency] }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'dependencies synced' })
    expect(captured.find((request) => request.url.endsWith('/services/svc1/dependencies/sync'))).toMatchObject({ method: 'POST', body: { dependencies: [dependency] } })
  })

  it('forwards a database dependency and an untyped dependency unchanged', async () => {
    const captured: Array<{ url: string; method: string; body?: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      captured.push({ url, method: init?.method ?? 'GET', body })
      if (url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ orgId: 'org1' }))
      if (url.endsWith('/api/v1/orgs/org1/services')) return new Response(JSON.stringify({ services: [{ id: 'svc1', name: 'payments' }] }))
      if (url.endsWith('/api/v1/orgs/org1/services/svc1/dependencies/sync')) return new Response(JSON.stringify({}))
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 })
    }))

    const dbDependency = { name: 'orders-store', service: 'Orders DB', type: 'database', criticality: 'hard', databaseName: 'orders' }
    const bareDependency = { name: 'some-service', service: 'Unknown Service', criticality: 'soft' }
    const res = await app.request('/v1/sync/service/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ serviceName: 'payments', dependencies: [dbDependency, bareDependency] }),
    })

    expect(res.status).toBe(200)
    expect(captured.find((request) => request.url.endsWith('/services/svc1/dependencies/sync'))).toMatchObject({ method: 'POST', body: { dependencies: [dbDependency, bareDependency] } })
  })

  it('rejects duplicate api endpoint names within a dependency', async () => {
    const res = await app.request('/v1/sync/service/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ serviceName: 'payments', dependencies: [{ name: 'x', service: 'Y', type: 'http', criticality: 'hard', apiGroupName: 'v1', apiEndpointNames: ['CreatePayment', 'CreatePayment'] }] }),
    })
    expect(res.status).toBe(400)
  })
})
