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
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
