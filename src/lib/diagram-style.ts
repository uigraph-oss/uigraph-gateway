import { z } from 'zod'

export const SHAPE_IDS = [
  'rectangle',
  'rounded-rect',
  'ellipse',
  'diamond',
  'triangle',
  'parallelogram',
  'trapezoid',
  'hexagon',
  'document',
  'cylinder',
  'delay',
  'off-page-connector',
  'display',
  'collate',
  'sort',
  'terminator',
  'or',
  'database',
  'multiple-documents',
  'subroutine',
  'manual-input',
  'summing-junction',
  'internal-storage',
] as const

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const strokeStyle = z.enum(['solid', 'dashed', 'dotted'])

export const stylePlanSchema = z.object({
  theme: z.string(),
  summary: z.string(),
  layout: z.enum(['LR', 'TB', 'none']),
  nodes: z.array(
    z.object({
      id: z.string(),
      fill: z.union([hexColor, z.literal('transparent')]).optional(),
      stroke: hexColor.optional(),
      strokeWidth: z.number().optional(),
      strokeStyle: strokeStyle.optional(),
      cornerRadius: z.number().optional(),
      textColor: hexColor.optional(),
      textFontSize: z.number().optional(),
      shape: z.enum(SHAPE_IDS).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      stroke: hexColor.optional(),
      strokeWidth: z.number().optional(),
      strokeStyle: strokeStyle.optional(),
      animated: z.boolean().optional(),
      labelColor: hexColor.optional(),
    })
  ),
})

export type StylePlan = z.infer<typeof stylePlanSchema>
export type NodeStylePatch = StylePlan['nodes'][number]
export type EdgeStylePatch = StylePlan['edges'][number]

export type DiagramElement = Record<string, unknown>

const STROKE_DASHARRAY = {
  solid: undefined,
  dashed: '4 2',
  dotted: '1',
}

const GEOMETRY_NODE_TYPES = new Set(['shape', 'default', 'cloud', 'text', 'c4'])

const LABEL_FIELD_IDS = new Set(['name', 'text', 'code', 'label', 'title'])

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  if (typeof value !== 'object') return undefined
  if (Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined
  if (!Number.isFinite(value)) return undefined
  return value
}

function roundOrUndefined(value: number | undefined) {
  if (value === undefined) return undefined
  return Math.round(value)
}

function clamp(
  value: number | undefined,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

function dropUndefined(
  input: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    output[key] = value
  }
  return output
}

function resolveNodeLabel(data: Record<string, unknown> | undefined) {
  if (!data) return undefined

  if (Array.isArray(data.componentFields)) {
    for (const rawField of data.componentFields) {
      const field = toRecord(rawField)
      if (!field) continue

      const fieldId = pickString(field.componentFieldId)?.toLowerCase()
      const fieldLabel = pickString(field.label)?.toLowerCase()
      const isLabelField =
        (fieldId !== undefined && LABEL_FIELD_IDS.has(fieldId)) ||
        (fieldLabel !== undefined && LABEL_FIELD_IDS.has(fieldLabel))
      if (!isLabelField) continue

      if (!Array.isArray(field.data)) continue
      const value = pickString(toRecord(field.data[0])?.value)
      if (value !== undefined) return value
    }
  }

  return (
    pickString(data.label) ??
    pickString(data.title) ??
    pickString(data.name) ??
    pickString(data.description)
  )
}

function resolveNodeSize(node: DiagramElement) {
  const style = toRecord(node.style)
  const measured = toRecord(node.measured)

  return {
    width:
      pickNumber(node.width) ??
      pickNumber(style?.width) ??
      pickNumber(measured?.width),
    height:
      pickNumber(node.height) ??
      pickNumber(style?.height) ??
      pickNumber(measured?.height),
  }
}

export function isSequenceDiagram(nodes: DiagramElement[]): boolean {
  return nodes.some((node) => node.type === 'sequenceParticipant')
}

export function buildDiagramDigest(
  nodes: DiagramElement[],
  edges: DiagramElement[]
) {
  return {
    nodes: nodes.map((node) => {
      const data = toRecord(node.data)
      const size = resolveNodeSize(node)
      const position = toRecord(node.position)

      return dropUndefined({
        id: pickString(node.id),
        type: pickString(node.type),
        shape: pickString(data?.shape),
        label: resolveNodeLabel(data),
        parent: pickString(node.parentId),
        x: roundOrUndefined(pickNumber(position?.x)),
        y: roundOrUndefined(pickNumber(position?.y)),
        width: size.width,
        height: size.height,
        fill: pickString(data?.fill) ?? pickString(data?.backgroundColor),
        stroke: pickString(data?.stroke) ?? pickString(data?.borderColor),
      })
    }),
    edges: edges.map((edge) => {
      const style = toRecord(edge.style)

      return dropUndefined({
        id: pickString(edge.id),
        from: pickString(edge.source),
        to: pickString(edge.target),
        label: pickString(edge.label),
        stroke: pickString(style?.stroke),
      })
    }),
  }
}

function buildNodeDataPatch(
  type: string | undefined,
  patch: NodeStylePatch
): Record<string, unknown> {
  if (type === 'shape' || type === 'default') {
    return dropUndefined({
      fill: patch.fill,
      stroke: patch.stroke,
      strokeWidth: clamp(patch.strokeWidth, 0, 10),
      strokeStyle: patch.strokeStyle,
      cornerRadius: clamp(patch.cornerRadius, 0, 64),
      textColor: patch.textColor,
      textFontSize: clamp(patch.textFontSize, 8, 48),
      shape: patch.shape,
    })
  }

  if (type === 'cloud') {
    return dropUndefined({
      fill: patch.fill,
      stroke: patch.stroke,
      strokeWidth: clamp(patch.strokeWidth, 0, 10),
      strokeStyle: patch.strokeStyle,
    })
  }

  if (type === 'text') {
    return dropUndefined({
      fill: patch.fill,
      stroke: patch.stroke,
      strokeWidth: clamp(patch.strokeWidth, 0, 10),
      strokeStyle: patch.strokeStyle,
      borderRadius: clamp(patch.cornerRadius, 0, 64),
      color: patch.textColor,
      fontSize: clamp(patch.textFontSize, 8, 48),
    })
  }

  if (type === 'group') {
    return dropUndefined({
      backgroundColor: patch.fill,
      borderColor: patch.stroke,
    })
  }

  if (type === 'c4') {
    return dropUndefined({
      fill: patch.fill,
      stroke: patch.stroke,
      fontColor: patch.textColor,
    })
  }

  if (type === 'c4Boundary') {
    return dropUndefined({
      backgroundColor: patch.fill,
      borderColor: patch.stroke,
      fontColor: patch.textColor,
    })
  }

  if (type === 'sequenceParticipant') {
    return dropUndefined({
      color: patch.stroke,
      textColor: patch.textColor,
    })
  }

  return {}
}

function applyNodePatch(
  node: DiagramElement,
  patch: NodeStylePatch,
  allowGeometry: boolean
): DiagramElement {
  const type = pickString(node.type)
  const dataPatch = buildNodeDataPatch(type, patch)

  const geometry =
    allowGeometry && type !== undefined && GEOMETRY_NODE_TYPES.has(type)
      ? dropUndefined({
          width: clamp(patch.width, 40, 2000),
          height: clamp(patch.height, 20, 2000),
        })
      : {}

  if (
    Object.keys(dataPatch).length === 0 &&
    Object.keys(geometry).length === 0
  ) {
    return node
  }

  return {
    ...node,
    ...geometry,
    data: { ...toRecord(node.data), ...dataPatch },
  }
}

function applyEdgePatch(
  edge: DiagramElement,
  patch: EdgeStylePatch
): DiagramElement {
  const style = { ...toRecord(edge.style) }

  if (patch.stroke !== undefined) {
    style.stroke = patch.stroke
  }
  const strokeWidth = clamp(patch.strokeWidth, 0.5, 10)
  if (strokeWidth !== undefined) {
    style.strokeWidth = strokeWidth
  }
  if (patch.strokeStyle !== undefined) {
    style.strokeDasharray = STROKE_DASHARRAY[patch.strokeStyle]
  }

  const next: DiagramElement = { ...edge, style }

  if (patch.animated !== undefined) {
    next.animated = patch.animated
  }

  const markerEnd = toRecord(edge.markerEnd)
  if (markerEnd && patch.stroke !== undefined) {
    next.markerEnd = { ...markerEnd, color: patch.stroke }
  }

  const labelStyle = toRecord(edge.labelStyle)
  if (patch.labelColor !== undefined && labelStyle) {
    next.labelStyle = { ...labelStyle, color: patch.labelColor }
  }
  if (
    patch.labelColor !== undefined &&
    !labelStyle &&
    pickString(edge.label) !== undefined
  ) {
    next.labelStyle = { color: patch.labelColor }
  }

  return next
}

export function applyStylePlan(
  nodes: DiagramElement[],
  edges: DiagramElement[],
  plan: StylePlan
): {
  nodes: DiagramElement[]
  edges: DiagramElement[]
  layout: StylePlan['layout']
} {
  const sequence = isSequenceDiagram(nodes)

  const nodePatches = new Map(plan.nodes.map((patch) => [patch.id, patch]))
  const edgePatches = new Map(plan.edges.map((patch) => [patch.id, patch]))

  return {
    nodes: nodes.map((node) => {
      const id = pickString(node.id)
      if (id === undefined) return node

      const patch = nodePatches.get(id)
      if (patch === undefined) return node

      if (sequence) {
        return applyNodePatch(
          node,
          { ...patch, shape: undefined, width: undefined, height: undefined },
          false
        )
      }

      return applyNodePatch(node, patch, true)
    }),
    edges: edges.map((edge) => {
      const id = pickString(edge.id)
      if (id === undefined) return edge

      const patch = edgePatches.get(id)
      if (patch === undefined) return edge

      return applyEdgePatch(edge, patch)
    }),
    layout: sequence ? 'none' : plan.layout,
  }
}
