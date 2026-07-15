import type { Context, Next } from 'hono'
import { UigraphApi } from '../clients/uigraph-api'
import { ApiError } from '../lib/errors'

export type GatewayVars = {
  api: UigraphApi
  token: string
}

// Reads the CLI's X-API-Token and builds a per-request backend client.
export async function auth(c: Context<{ Variables: GatewayVars }>, next: Next) {
  const token = c.req.header('X-API-Token')
  if (!token) {
    throw new ApiError(401, 'X-API-Token header is required')
  }
  c.set('token', token)
  c.set('api', new UigraphApi(token))
  await next()
}

export async function chatAuth(c: Context<{ Variables: GatewayVars }>, next: Next) {
  const header = c.req.header('Authorization')
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Authorization: Bearer token is required')
  }
  const token = header.slice('Bearer '.length)
  c.set('token', token)
  c.set('api', new UigraphApi(token, { scheme: 'bearer' }))
  await next()
}
