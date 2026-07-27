import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { config } from '../lib/config'

const CACHE_MAX_AGE_SECONDS = 86400

export const proxyRoutes = new Hono<AppEnv>()

proxyRoutes.all('/', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.text('No url provided', 400)
  }

  const res = await fetch(url, { method: c.req.method, redirect: 'follow' })

  const headers = new Headers()
  for (const [key, value] of res.headers.entries()) {
    headers.set(key, value)
  }

  headers.set('connection', 'keep-alive')

  if (config.DEPLOYMENT_ENV === 'production') {
    headers.set('cache-control', `max-age=${CACHE_MAX_AGE_SECONDS}`)
  } else {
    headers.set('cache-control', 'no-cache')
  }

  return new Response(res.body, { status: res.status, headers })
})
