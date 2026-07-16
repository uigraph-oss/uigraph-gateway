import { config } from '../lib/config'
import { ApiError } from '../lib/errors'

type Json = Record<string, unknown>

export class UigraphApi {
  private token: string
  private scheme: 'api-key' | 'bearer'
  private orgId?: string

  constructor(token: string, opts?: { scheme?: 'api-key' | 'bearer' }) {
    this.token = token
    this.scheme = opts?.scheme ?? 'api-key'
  }

  private authHeader(): Record<string, string> {
    if (this.scheme === 'bearer') {
      return { Authorization: `Bearer ${this.token}` }
    }
    if (this.scheme === 'api-key') {
      return { 'X-API-Key': this.token }
    }
    throw new Error(`unknown auth scheme: ${this.scheme}`)
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${config.UIGRAPH_API_URL}${path}`, {
      method,
      headers: {
        ...this.authHeader(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    if (!res.ok) {
      let message = text || `upstream error ${res.status}`
      try {
        const parsed = JSON.parse(text) as Json
        message =
          (parsed.message as string) || (parsed.error as string) || message
      } catch {
      }
      throw new ApiError(res.status, message)
    }

    return (text ? JSON.parse(text) : {}) as T
  }

  async getOrgId(): Promise<string> {
    if (this.orgId) return this.orgId
    const me = await this.request<{ orgId?: string }>('GET', '/api/v1/auth/me')
    if (!me.orgId) {
      throw new ApiError(403, 'token is not bound to an organization')
    }
    this.orgId = me.orgId
    return this.orgId
  }

  private async orgPath(suffix: string): Promise<string> {
    const orgId = await this.getOrgId()
    return `/api/v1/orgs/${orgId}${suffix}`
  }

  async listChatMessages(
    orgId: string,
    sessionId: string
  ): Promise<Array<{ role: string; content: string }>> {
    const res = await this.request<{
      messages?: Array<{ role: string; content: string }>
    }>('GET', `/api/v1/orgs/${orgId}/chat-sessions/${sessionId}/messages`)
    return res.messages ?? []
  }

  async createChatMessage(
    orgId: string,
    sessionId: string,
    body: {
      role: 'user' | 'assistant' | 'system'
      content: string
      parts?: unknown
    }
  ): Promise<{ id: string }> {
    return this.request(
      'POST',
      `/api/v1/orgs/${orgId}/chat-sessions/${sessionId}/messages`,
      body
    )
  }

  async updateChatSession(
    orgId: string,
    sessionId: string,
    body: { title?: string; isPinned?: boolean }
  ): Promise<{ id: string }> {
    return this.request(
      'PUT',
      `/api/v1/orgs/${orgId}/chat-sessions/${sessionId}`,
      body
    )
  }

  async listServices(): Promise<Array<{ id: string; name: string; teamId?: string }>> {
    const res = await this.request<{
      services?: Array<{ id: string; name: string; teamId?: string }>
    }>('GET', await this.orgPath('/services'))
    return res.services ?? []
  }

  async findServiceByName(name: string): Promise<string | null> {
    const svc = (await this.listServices()).find((s) => s.name === name)
    return svc?.id ?? null
  }

  async findService(name: string): Promise<{ id: string; teamId?: string } | null> {
    const svc = (await this.listServices()).find((s) => s.name === name)
    return svc ? { id: svc.id, teamId: svc.teamId } : null
  }

  async createService(body: Json): Promise<{ id: string }> {
    return this.request('POST', await this.orgPath('/services'), body)
  }

  async updateService(serviceId: string, body: Json): Promise<unknown> {
    return this.request('PUT', await this.orgPath(`/services/${serviceId}`), body)
  }

  async listServiceDiagrams(
    serviceId: string
  ): Promise<Array<{ diagram?: { id: string; name: string } }>> {
    const res = await this.request<{
      diagrams?: Array<{ diagram?: { id: string; name: string } }>
    }>('GET', await this.orgPath(`/services/${serviceId}/diagrams`))
    return res.diagrams ?? []
  }

  async createServiceDiagram(serviceId: string, body: Json): Promise<unknown> {
    return this.request(
      'POST',
      await this.orgPath(`/services/${serviceId}/diagrams`),
      body
    )
  }

  async syncDiagram(
    body: Json
  ): Promise<{ diagramId: string; versionCreated: boolean }> {
    return this.request('POST', await this.orgPath('/diagrams/sync'), body)
  }

  async createDiagram(body: Json): Promise<{ id: string }> {
    return this.request('POST', await this.orgPath('/diagrams'), body)
  }

  async updateDiagram(diagramId: string, body: Json): Promise<unknown> {
    return this.request('PUT', await this.orgPath(`/diagrams/${diagramId}`), body)
  }

  async listDBs(
    serviceId: string
  ): Promise<Array<{ id: string; dbName: string; schemaJson?: unknown }>> {
    const res = await this.request<{
      dbs?: Array<{ id: string; dbName: string; schemaJson?: unknown }>
    }>('GET', await this.orgPath(`/services/${serviceId}/dbs`))
    return res.dbs ?? []
  }

  async createDB(serviceId: string, body: Json): Promise<unknown> {
    return this.request('POST', await this.orgPath(`/services/${serviceId}/dbs`), body)
  }

  async updateDB(serviceId: string, dbId: string, body: Json): Promise<unknown> {
    return this.request(
      'PUT',
      await this.orgPath(`/services/${serviceId}/dbs/${dbId}`),
      body
    )
  }

  async syncSavedQuery(
    serviceId: string,
    dbId: string,
    body: Json
  ): Promise<{ id: string; created: boolean }> {
    return this.request<{ id: string; created: boolean }>(
      'POST',
      await this.orgPath(`/services/${serviceId}/dbs/${dbId}/queries/sync`),
      body
    )
  }

  async syncServiceDependencies(serviceId: string, body: Json): Promise<unknown> {
    return this.request(
      'POST',
      await this.orgPath(`/services/${serviceId}/dependencies/sync`),
      body
    )
  }

  async listAPIGroups(serviceId: string): Promise<Array<{ id: string; name: string }>> {
    const res = await this.request<{ apiGroups?: Array<{ id: string; name: string }> }>(
      'GET',
      await this.orgPath(`/services/${serviceId}/api-groups`)
    )
    return res.apiGroups ?? []
  }

  async syncAPIGroup(
    serviceId: string,
    body: Json
  ): Promise<{ apiGroupId: string; versionCreated: boolean }> {
    return this.request(
      'POST',
      await this.orgPath(`/services/${serviceId}/api-groups/sync`),
      body
    )
  }

  async listAPIEndpoints(
    serviceId: string,
    apiGroupId: string
  ): Promise<Array<{ id: string; operationId: string; method: string }>> {
    const res = await this.request<{
      endpoints?: Array<{ id: string; operationId: string; method: string }>
    }>(
      'GET',
      await this.orgPath(`/services/${serviceId}/api-groups/${apiGroupId}/endpoints`)
    )
    return res.endpoints ?? []
  }

  async listTestPacks(serviceId: string): Promise<Array<{ testPackId: string; name: string }>> {
    const res = await this.request<{ testPacks?: Array<{ testPackId: string; name: string }> }>(
      'GET',
      await this.orgPath(`/services/${serviceId}/test-packs`)
    )
    return res.testPacks ?? []
  }

  async createTestPack(serviceId: string, body: Json): Promise<{ testPackId: string }> {
    return this.request(
      'POST',
      await this.orgPath(`/services/${serviceId}/test-pack`),
      body
    )
  }

  async listTestCases(
    serviceId: string,
    testPackId: string
  ): Promise<Array<{ testCaseId: string; title: string }>> {
    const res = await this.request<{
      testCases?: Array<{ testCaseId: string; title: string }>
    }>(
      'GET',
      await this.orgPath(`/services/${serviceId}/test-cases?testPackId=${testPackId}`)
    )
    return res.testCases ?? []
  }

  async createTestCase(serviceId: string, body: Json): Promise<unknown> {
    return this.request(
      'POST',
      await this.orgPath(`/services/${serviceId}/test-case`),
      body
    )
  }

  async updateTestCase(serviceId: string, testCaseId: string, body: Json): Promise<unknown> {
    return this.request(
      'POST',
      await this.orgPath(`/services/${serviceId}/test-case/${testCaseId}`),
      body
    )
  }

  async listDocs(
    serviceId: string
  ): Promise<Array<{ id: string; fileName: string; contentHash: string }>> {
    const res = await this.request<{
      docs?: Array<{
        docId: string
        doc?: { id: string; fileName: string; contentHash: string }
      }>
    }>('GET', await this.orgPath(`/services/${serviceId}/docs`))
    return (res.docs ?? [])
      .filter((d) => d.doc !== undefined)
      .map((d) => ({
        id: d.doc!.id,
        fileName: d.doc!.fileName,
        contentHash: d.doc!.contentHash,
      }))
  }

  async createDoc(serviceId: string, body: Json): Promise<unknown> {
    return this.request('POST', await this.orgPath(`/services/${serviceId}/docs`), body)
  }

  async updateDoc(docId: string, body: Json): Promise<unknown> {
    return this.request('PUT', await this.orgPath(`/docs/${docId}`), body)
  }

  async listMaps(): Promise<Array<{ id: string; name: string }>> {
    const res = await this.request<{ maps?: Array<{ id: string; name: string }> }>(
      'GET',
      await this.orgPath('/maps')
    )
    return res.maps ?? []
  }

  async createMap(body: Json): Promise<{ id: string }> {
    return this.request('POST', await this.orgPath('/maps'), body)
  }

  async listFrames(mapId: string): Promise<Array<{ id: string; name: string }>> {
    const res = await this.request<{ frames?: Array<{ id: string; name: string }> }>(
      'GET',
      await this.orgPath(`/maps/${mapId}/frames`)
    )
    return res.frames ?? []
  }

  async syncFrame(mapId: string, body: Json): Promise<{ frameId: string }> {
    return this.request('POST', await this.orgPath(`/maps/${mapId}/frames/sync`), body)
  }

  async listFocalPoints(
    mapId: string,
    frameId: string
  ): Promise<Array<{ id: string; name: string }>> {
    const res = await this.request<{ focalPoints?: Array<{ id: string; name: string }> }>(
      'GET',
      await this.orgPath(`/maps/${mapId}/frames/${frameId}/focal-points`)
    )
    return res.focalPoints ?? []
  }

  async createFocalPoint(mapId: string, frameId: string, body: Json): Promise<{ id: string }> {
    return this.request(
      'POST',
      await this.orgPath(`/maps/${mapId}/frames/${frameId}/focal-points`),
      body
    )
  }

  async updateFocalPoint(
    mapId: string,
    frameId: string,
    fpId: string,
    body: Json
  ): Promise<unknown> {
    return this.request(
      'PUT',
      await this.orgPath(`/maps/${mapId}/frames/${frameId}/focal-points/${fpId}`),
      body
    )
  }

  async createMeta(
    mapId: string,
    frameId: string,
    fpId: string,
    body: Json
  ): Promise<unknown> {
    return this.request(
      'POST',
      await this.orgPath(
        `/maps/${mapId}/frames/${frameId}/focal-points/${fpId}/meta`
      ),
      body
    )
  }

  async listMeta(
    mapId: string,
    frameId: string,
    fpId: string
  ): Promise<Array<{ id: string; componentId: string }>> {
    const res = await this.request<{
      meta?: Array<{ id: string; componentId: string }>
    }>(
      'GET',
      await this.orgPath(
        `/maps/${mapId}/frames/${frameId}/focal-points/${fpId}/meta`
      )
    )
    return res.meta ?? []
  }

  async updateMeta(
    mapId: string,
    frameId: string,
    fpId: string,
    metaId: string,
    body: Json
  ): Promise<unknown> {
    return this.request(
      'PUT',
      await this.orgPath(
        `/maps/${mapId}/frames/${frameId}/focal-points/${fpId}/meta/${metaId}`
      ),
      body
    )
  }
}
