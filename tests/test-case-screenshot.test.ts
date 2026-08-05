import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UIGRAPH_API_URL = 'http://backend.test'
process.env.STORAGE_ENDPOINT = 'http://minio.test:9000'
process.env.STORAGE_BUCKET = 'test-bucket'
process.env.STORAGE_ACCESS_KEY = 'test'
process.env.STORAGE_SECRET_KEY = 'test'

const { createApp } = await import('../src/app')
const app = createApp()

const hash = 'a'.repeat(64)

type Captured = { url: string; method: string; body?: unknown }
type TestCase = { testCaseId: string; title: string; screenshotUrls?: string[] }

function mockBackend(captured: Captured[], testCases: TestCase[]) {
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
    if (url.includes('/services/svc1/test-cases?testPackId=')) return json({ testCases })
    if (url.endsWith('/api/v1/orgs/org1/assets') && method === 'POST') {
      const contentHash = (body as { contentHash?: string }).contentHash
      return json({
        assetId: `file_${contentHash}`,
        uploadUrl: `http://minio.test:9000/assets/file_${contentHash}?sig=x`,
      })
    }
    if (url.endsWith('/services/svc1/test-case') && method === 'POST') return json({})
    if (url.includes('/services/svc1/test-case/') && method === 'POST') return json({})
    return json({ message: `unexpected ${method} ${url}` }, 500)
  })
}

function prepare(body: unknown) {
  return app.request('/v1/sync/service/test-case/screenshot/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
    body: JSON.stringify(body),
  })
}

describe('test case screenshot prepare', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('presigns an upload when the test case does not reference the asset yet', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, [{ testCaseId: 'tc1', title: 'Login', screenshotUrls: [] }])
    )

    const res = await prepare({
      serviceName: 'payments',
      testPackId: 'pack1',
      testCaseTitle: 'Login',
      contentHash: hash,
      fileName: 'login.png',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      action: 'upload',
      assetId: `file_${hash}`,
      uploadUrl: `http://minio.test:9000/assets/file_${hash}?sig=x`,
    })
    expect(captured.find((c) => c.url.endsWith('/assets'))!.body).toEqual({
      contentHash: hash,
    })
  })

  it('presigns an upload when the test case does not exist yet', async () => {
    const captured: Captured[] = []
    vi.stubGlobal('fetch', mockBackend(captured, []))

    const res = await prepare({
      serviceName: 'payments',
      testPackId: 'pack1',
      testCaseTitle: 'Login',
      contentHash: hash,
      fileName: 'login.png',
    })

    expect(await res.json()).toMatchObject({ action: 'upload', assetId: `file_${hash}` })
  })

  it('skips the upload when the same content is already referenced', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, [
        { testCaseId: 'tc1', title: 'Login', screenshotUrls: [`file_${hash}`] },
      ])
    )

    const res = await prepare({
      serviceName: 'payments',
      testPackId: 'pack1',
      testCaseTitle: 'Login',
      contentHash: hash,
      fileName: 'login.png',
    })

    expect(await res.json()).toEqual({ action: 'skip', assetId: `file_${hash}` })
    expect(captured.find((c) => c.url.endsWith('/assets'))).toBeUndefined()
  })

  it('rejects a malformed content hash', async () => {
    vi.stubGlobal('fetch', mockBackend([], []))

    const res = await prepare({
      serviceName: 'payments',
      testPackId: 'pack1',
      testCaseTitle: 'Login',
      contentHash: 'not-a-hash',
      fileName: 'login.png',
    })

    expect(res.status).toBe(400)
  })
})

describe('test case screenshot urls', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('passes screenshotUrls through to the api on create', async () => {
    const captured: Captured[] = []
    vi.stubGlobal('fetch', mockBackend(captured, []))

    const res = await app.request('/v1/sync/service/test-case', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        testPackId: 'pack1',
        testCase: {
          type: 'manual',
          title: 'Login',
          screenshotUrls: [`file_${hash}`],
        },
      }),
    })

    expect(res.status).toBe(200)
    const create = captured.find(
      (c) => c.method === 'POST' && c.url.endsWith('/services/svc1/test-case')
    )
    expect(create!.body).toMatchObject({ screenshotUrls: [`file_${hash}`] })
  })

  it('passes screenshotUrls through to the api on update', async () => {
    const captured: Captured[] = []
    vi.stubGlobal(
      'fetch',
      mockBackend(captured, [{ testCaseId: 'tc1', title: 'Login', screenshotUrls: [] }])
    )

    await app.request('/v1/sync/service/test-case', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'uig_tok' },
      body: JSON.stringify({
        serviceName: 'payments',
        testPackId: 'pack1',
        testCase: {
          type: 'manual',
          title: 'Login',
          screenshotUrls: [`file_${hash}`],
        },
      }),
    })

    const update = captured.find((c) => c.url.endsWith('/services/svc1/test-case/tc1'))
    expect(update!.body).toMatchObject({ screenshotUrls: [`file_${hash}`] })
  })
})
