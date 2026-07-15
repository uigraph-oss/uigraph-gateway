import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  // Base URL of the Go backend, e.g. http://localhost:8081 (no trailing slash)
  UIGRAPH_API_URL: z.string().url(),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_PUBLIC_ENDPOINT: z.string().url().optional().or(z.literal('')),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  AI_PROVIDER_NPM: z.string().default('@ai-sdk/openai-compatible'),
  AI_PROVIDER_OPTIONS: z
    .string()
    .optional()
    .transform((value) => (value ? JSON.parse(value) : undefined))
    .pipe(z.record(z.string(), z.unknown()).optional()),
  AI_PROVIDER_API_URL: z.string().url().optional(),
  AI_PROVIDER_API_KEY: z.string().optional(),
  AI_PROVIDER_MODEL: z.string().optional(),
  AI_PROVIDER_TITLE_MODEL: z.string().optional(),
  UIGRAPH_MCP_URL: z.string().url().optional(),
  MCP_CACHE_TTL_MS: z.coerce.number().default(15 * 60 * 1000),
  LLM_MAX_STEP: z.coerce.number().default(25),
  LLM_ATTACHMENT_IMAGE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  LLM_ATTACHMENT_AUDIO: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  LLM_ATTACHMENT_VIDEO: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
