import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UIGRAPH_API_URL = 'http://backend.test'
process.env.STORAGE_ENDPOINT = 'http://minio.test:9000'
process.env.STORAGE_BUCKET = 'test-bucket'
process.env.STORAGE_ACCESS_KEY = 'test'
process.env.STORAGE_SECRET_KEY = 'test'
process.env.AI_PROVIDER_API_KEY = 'test-key'
process.env.AI_PROVIDER_MODEL = 'test-model'

const generateObjectMock = vi.hoisted(() => vi.fn())
const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
  generateText: generateTextMock,
  stepCountIs: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@uigraph/ai-sdk', () => ({
  resolveAiModel: vi.fn(() => ({ modelId: 'test-model' })),
}))

const { createApp } = await import('../src/app')
const {
  applyStylePlan,
  buildDiagramDigest,
  stylePlanSchema,
} = await import('../src/lib/diagram-style')

const app = createApp()

const emptyPlan = {
  theme: 'Cool slate',
  summary: 'Recolored the diagram.',
  layout: 'none' as const,
  nodes: [],
  edges: [],
}

function shapeNode(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'shape',
    position: { x: 0, y: 0 },
    width: 150,
    height: 60,
    data: {
      shape: 'rectangle',
      fill: '#FFFFFF',
      componentFields: [
        { componentFieldId: 'name', type: 'Text Input', data: [{ value: id }] },
      ],
    },
    ...extra,
  }
}

describe('buildDiagramDigest', () => {
  it('extracts labels, sizes and colors, and drops empty keys', () => {
    const digest = buildDiagramDigest(
      [
        shapeNode('api'),
        {
          id: 'grp',
          type: 'group',
          position: { x: 0, y: 0 },
          style: { width: 400, height: 200 },
          data: { backgroundColor: '#111111', borderColor: '#222222' },
        },
        {
          id: 'db',
          type: 'shape',
          position: { x: 0, y: 0 },
          parentId: 'grp',
          measured: { width: 120, height: 40 },
          data: { label: 'Postgres' },
        },
      ],
      [
        {
          id: 'e1',
          source: 'api',
          target: 'db',
          label: 'query',
          style: { stroke: '#2C5CF6' },
        },
      ]
    )

    expect(digest.nodes[0]).toEqual({
      id: 'api',
      type: 'shape',
      shape: 'rectangle',
      label: 'api',
      x: 0,
      y: 0,
      width: 150,
      height: 60,
      fill: '#FFFFFF',
    })
    expect(digest.nodes[1]).toEqual({
      id: 'grp',
      type: 'group',
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      fill: '#111111',
      stroke: '#222222',
    })
    expect(digest.nodes[2]).toEqual({
      id: 'db',
      type: 'shape',
      label: 'Postgres',
      parent: 'grp',
      x: 0,
      y: 0,
      width: 120,
      height: 40,
    })
    expect(digest.edges[0]).toEqual({
      id: 'e1',
      from: 'api',
      to: 'db',
      label: 'query',
      stroke: '#2C5CF6',
    })
  })

  it('reports rounded node positions', () => {
    const digest = buildDiagramDigest(
      [shapeNode('api', { position: { x: 120.4, y: -80.6 } })],
      []
    )

    expect(digest.nodes[0]).toMatchObject({ x: 120, y: -81 })
  })
})

describe('stylePlanSchema', () => {
  it('rejects non-hex colors and unknown shapes', () => {
    expect(
      stylePlanSchema.safeParse({
        ...emptyPlan,
        nodes: [{ id: 'api', fill: 'red' }],
      }).success
    ).toBe(false)

    expect(
      stylePlanSchema.safeParse({
        ...emptyPlan,
        nodes: [{ id: 'api', shape: 'blob' }],
      }).success
    ).toBe(false)

    expect(
      stylePlanSchema.safeParse({
        ...emptyPlan,
        nodes: [{ id: 'api', fill: 'transparent', stroke: '#1E293B' }],
      }).success
    ).toBe(true)
  })
})

describe('applyStylePlan', () => {
  it('writes shape-node styles and clamps out-of-range numbers', () => {
    const { nodes } = applyStylePlan([shapeNode('api')], [], {
      ...emptyPlan,
      nodes: [
        {
          id: 'api',
          fill: '#1E293B',
          stroke: '#38BDF8',
          strokeWidth: 99,
          strokeStyle: 'dashed',
          cornerRadius: 999,
          textColor: '#F8FAFC',
          textFontSize: 2,
          shape: 'cylinder',
          width: 10,
          height: 5000,
        },
      ],
    })

    expect(nodes[0].data).toMatchObject({
      fill: '#1E293B',
      stroke: '#38BDF8',
      strokeWidth: 10,
      strokeStyle: 'dashed',
      cornerRadius: 64,
      textColor: '#F8FAFC',
      textFontSize: 8,
      shape: 'cylinder',
    })
    expect(nodes[0].width).toBe(40)
    expect(nodes[0].height).toBe(2000)
  })

  it('preserves structure and untouched fields', () => {
    const original = shapeNode('api')
    const { nodes } = applyStylePlan([original], [], {
      ...emptyPlan,
      nodes: [{ id: 'api', fill: '#1E293B' }],
    })

    expect(nodes[0].id).toBe('api')
    expect(nodes[0].type).toBe('shape')
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(
      (nodes[0].data as { componentFields: unknown }).componentFields
    ).toEqual(
      (original.data as { componentFields: unknown }).componentFields
    )
    expect((nodes[0].data as { shape: string }).shape).toBe('rectangle')
    expect(original.data.fill).toBe('#FFFFFF')
  })

  it('ignores ids that are not in the diagram', () => {
    const { nodes, edges } = applyStylePlan(
      [shapeNode('api')],
      [{ id: 'e1', source: 'api', target: 'api' }],
      {
        ...emptyPlan,
        nodes: [{ id: 'ghost', fill: '#000000' }],
        edges: [{ id: 'ghost-edge', stroke: '#000000' }],
      }
    )

    expect((nodes[0].data as { fill: string }).fill).toBe('#FFFFFF')
    expect(edges[0]).toEqual({ id: 'e1', source: 'api', target: 'api' })
  })

  it('remaps colors for group, text, c4 and sequence nodes', () => {
    const { nodes } = applyStylePlan(
      [
        { id: 'grp', type: 'group', data: {} },
        { id: 'txt', type: 'text', data: {} },
        { id: 'c4', type: 'c4', data: {} },
        { id: 'other', type: 'builder', data: {} },
      ],
      [],
      {
        ...emptyPlan,
        nodes: [
          { id: 'grp', fill: '#0F172A', stroke: '#334155' },
          {
            id: 'txt',
            textColor: '#F8FAFC',
            textFontSize: 18,
            cornerRadius: 12,
          },
          { id: 'c4', fill: '#1D4ED8', textColor: '#FFFFFF' },
          { id: 'other', fill: '#1D4ED8' },
        ],
      }
    )

    expect(nodes[0].data).toEqual({
      backgroundColor: '#0F172A',
      borderColor: '#334155',
    })
    expect(nodes[1].data).toEqual({
      color: '#F8FAFC',
      fontSize: 18,
      borderRadius: 12,
    })
    expect(nodes[2].data).toEqual({ fill: '#1D4ED8', fontColor: '#FFFFFF' })
    expect(nodes[3].data).toEqual({})
  })

  it('drops geometry and forces layout none on sequence diagrams', () => {
    const { nodes, layout } = applyStylePlan(
      [
        { id: 'p1', type: 'sequenceParticipant', width: 120, data: {} },
        shapeNode('msg'),
      ],
      [],
      {
        ...emptyPlan,
        layout: 'TB',
        nodes: [
          { id: 'p1', stroke: '#38BDF8', textColor: '#F8FAFC' },
          { id: 'msg', fill: '#1E293B', shape: 'cylinder', width: 400 },
        ],
      }
    )

    expect(nodes[0].data).toEqual({ color: '#38BDF8', textColor: '#F8FAFC' })
    expect(nodes[0].width).toBe(120)
    expect((nodes[1].data as { shape: string }).shape).toBe('rectangle')
    expect(nodes[1].width).toBe(150)
    expect(layout).toBe('none')
  })

  it('maps edge stroke styles, markers and label colors', () => {
    const { edges } = applyStylePlan(
      [],
      [
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          label: 'query',
          style: { stroke: '#000000', strokeDasharray: '4 2' },
          markerEnd: { type: 'arrowclosed', color: '#000000' },
        },
        { id: 'e2', source: 'a', target: 'b', style: {} },
      ],
      {
        ...emptyPlan,
        edges: [
          {
            id: 'e1',
            stroke: '#38BDF8',
            strokeWidth: 3,
            strokeStyle: 'solid',
            animated: true,
            labelColor: '#F8FAFC',
          },
          { id: 'e2', strokeStyle: 'dotted' },
        ],
      }
    )

    expect(edges[0].style).toEqual({
      stroke: '#38BDF8',
      strokeWidth: 3,
      strokeDasharray: undefined,
    })
    expect(edges[0].animated).toBe(true)
    expect(edges[0].markerEnd).toEqual({
      type: 'arrowclosed',
      color: '#38BDF8',
    })
    expect(edges[0].labelStyle).toEqual({ color: '#F8FAFC' })
    expect(edges[1].style).toEqual({ strokeDasharray: '1' })
  })
})

describe('POST /v1/ai/diagrams/beautify', () => {
  beforeEach(() => {
    generateObjectMock.mockReset()
    generateTextMock.mockReset()
  })

  function request(body: unknown) {
    return app.request('/v1/ai/diagrams/beautify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer session-token',
      },
      body: JSON.stringify(body),
    })
  }

  it('returns styled nodes and edges from the model plan', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        theme: 'Cool slate',
        summary: 'Gave services a slate palette.',
        layout: 'LR',
        nodes: [{ id: 'api', fill: '#1E293B', textColor: '#F8FAFC' }],
        edges: [{ id: 'e1', stroke: '#38BDF8' }],
      },
    })

    const res = await request({
      prompt: 'dark and high contrast',
      nodes: [shapeNode('api')],
      edges: [{ id: 'e1', source: 'api', target: 'api' }],
    })

    expect(res.status).toBe(200)
    const out = (await res.json()) as {
      nodes: Array<{ id: string; data: { fill: string } }>
      layout: string
      theme: string
      summary: string
    }
    expect(out.nodes[0].data.fill).toBe('#1E293B')
    expect(out.layout).toBe('LR')
    expect(out.theme).toBe('Cool slate')
    expect(out.summary).toBe('Gave services a slate palette.')

    const call = generateObjectMock.mock.calls[0][0] as { prompt: string }
    expect(call.prompt).toContain('dark and high contrast')
    expect(call.prompt).toContain('"id":"api"')
  })

  it('uses the default prompt when none is given', async () => {
    generateObjectMock.mockResolvedValue({ object: emptyPlan })

    await request({ nodes: [shapeNode('api')], edges: [] })

    const call = generateObjectMock.mock.calls[0][0] as { prompt: string }
    expect(call.prompt).toContain('clean, modern and professional')
  })

  it('falls back to text generation when structured output fails', async () => {
    generateObjectMock.mockRejectedValue(new Error('no structured outputs'))
    generateTextMock.mockResolvedValue({
      text: `Here you go:\n${JSON.stringify({
        ...emptyPlan,
        nodes: [{ id: 'api', fill: '#1E293B' }],
      })}`,
    })

    const res = await request({ nodes: [shapeNode('api')], edges: [] })

    expect(res.status).toBe(200)
    const out = (await res.json()) as {
      nodes: Array<{ data: { fill: string } }>
    }
    expect(out.nodes[0].data.fill).toBe('#1E293B')
  })

  it('returns 502 when the model output cannot be parsed', async () => {
    generateObjectMock.mockRejectedValue(new Error('no structured outputs'))
    generateTextMock.mockResolvedValue({ text: 'sorry, I cannot do that' })

    const res = await request({ nodes: [shapeNode('api')], edges: [] })

    expect(res.status).toBe(502)
    expect(((await res.json()) as { message: string }).message).toMatch(
      /unusable style plan/
    )
  })

  it('rejects oversized diagrams', async () => {
    const nodes = Array.from({ length: 301 }, (_, i) => shapeNode(`n${i}`))
    const res = await request({ nodes, edges: [] })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(
      /too large/
    )
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('requires a bearer token', async () => {
    const res = await app.request('/v1/ai/diagrams/beautify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [shapeNode('api')], edges: [] }),
    })

    expect(res.status).toBe(401)
  })
})
