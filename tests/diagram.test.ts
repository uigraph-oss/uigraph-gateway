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
    if (url.endsWith('/api/v1/orgs/org1/services/svc1/diagrams') && method === 'GET')
      return json({ diagrams: [] })
    if (url.endsWith('/api/v1/orgs/org1/services/svc1/diagrams') && method === 'POST')
      return json({ diagram: { id: 'dg1', name: 'system' } }, 201)
    return json({ message: `unexpected ${method} ${url}` }, 500)
  })
}

describe('uigraph-gateway', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('healthz', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
  })

  it('rejects missing token with {message}', async () => {
    const res = await app.request('/v1/sync/service', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { message: string }).message).toMatch(
      /X-API-Token/
    )
  })

  it('converts mermaid+context and stores ReactFlow with componentId', async () => {
    const captured: Captured[] = []
    vi.stubGlobal('fetch', mockBackend(captured))

    const res = await app.request('/v1/sync/service/architecture-diagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        name: 'system',
        mermaidContent: 'flowchart LR\n  api[API]\n  db[(DB)]\n  api --> db',
        contextContent: JSON.stringify({
          nodes: {
            api: {
              type: 'component',
              componentId: 'flow_diagram_component_service',
              name: 'API',
            },
          },
        }),
      }),
    })

    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out).toEqual({ name: 'system', versionCreated: true })

    const create = captured.find(
      (c) => c.method === 'POST' && c.url.endsWith('/services/svc1/diagrams')
    )
    expect(create).toBeDefined()
    const content = JSON.parse((create!.body as { content: string }).content)
    const hasComponent = content.nodes.some(
      (n: { data?: { componentId?: string } }) =>
        n.data?.componentId === 'flow_diagram_component_service'
    )
    expect(hasComponent).toBe(true)
  })

  it('converts ReactFlow content to mermaid', async () => {
    const content = JSON.stringify({
      nodes: [
        { id: 'api', type: 'text', position: { x: 0, y: 0 }, data: { label: 'API' } },
        { id: 'db', type: 'text', position: { x: 200, y: 0 }, data: { label: 'DB' } },
      ],
      edges: [{ id: 'api-db', source: 'api', target: 'db' }],
    })

    const res = await app.request('/v1/sync/diagrams/to-mermaid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ content }),
    })

    expect(res.status).toBe(200)
    const out = (await res.json()) as { mermaid: string }
    expect(out.mermaid).toMatch(/^flowchart/)
  })

  it('rejects non-ReactFlow content with 400', async () => {
    const res = await app.request('/v1/sync/diagrams/to-mermaid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({ content: '{"foo":"bar"}' }),
    })

    expect(res.status).toBe(400)
  })
})
