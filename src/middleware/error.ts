import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { ApiError } from '../lib/errors'

// Maps thrown errors to the JSON shape the CLI expects: { message }.
export function onError(err: Error, c: Context) {
  if (err instanceof z.ZodError) {
    const message = err.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    return c.json({ message }, 400)
  }
  if (err instanceof ApiError) {
    return c.json({ message: err.message, code: err.code }, err.statusCode as 400)
  }
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status)
  }
  console.error('[uigraph-gateway] unhandled error:', err)
  return c.json({ message: 'internal gateway error' }, 500)
}
