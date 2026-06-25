import { z } from 'zod'

export const COMPONENT_FLOW_DIAGRAM_ID = 'component_backend-flow-diagram'
export const COMPONENT_API_CONTRACT_ID = 'component_api-contract'
export const COMPONENT_TEST_SUITE_ID = 'component_test-case-suite'
export const COMPONENT_SUPPORT_KB_ID = 'component_support-kb-troubleshooting'

export const apiContractSchema = z.object({
  serviceId: z.string().min(1),
  apiGroupId: z.string().min(1),
  apiEndpointId: z.string().min(1),
})

export const testSuiteSchema = z.object({
  serviceId: z.string().min(1),
  testPackId: z.string().min(1),
})

export const serviceDocSchema = z.object({
  serviceId: z.string().min(1),
  serviceDocId: z.string().min(1),
})

export const flowDiagramSchema = z.object({
  diagramId: z.string().min(1),
})

export const componentLinkSchemas: Record<string, z.ZodType> = {
  [COMPONENT_API_CONTRACT_ID]: apiContractSchema,
  [COMPONENT_TEST_SUITE_ID]: testSuiteSchema,
  [COMPONENT_SUPPORT_KB_ID]: serviceDocSchema,
  [COMPONENT_FLOW_DIAGRAM_ID]: flowDiagramSchema,
}
