import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { auth, type GatewayVars } from './middleware/auth'
import { onError } from './middleware/error'
import { diagramRoutes } from './routes/diagram'
import { docsRoutes } from './routes/docs'
import { mapRoutes } from './routes/maps'
import { serviceRoutes } from './routes/service'
import { testRoutes } from './routes/tests'

export type AppEnv = { Variables: GatewayVars }

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use('*', logger())
  app.onError(onError)

  app.get('/healthz', (c) => c.json({ status: 'ok' }))

  // Everything under /v1/sync requires the CLI service-account token.
  const sync = new Hono<AppEnv>()
  sync.use('*', auth)
  sync.route('/', serviceRoutes)
  sync.route('/', diagramRoutes)
  sync.route('/', testRoutes)
  sync.route('/', docsRoutes)
  sync.route('/', mapRoutes)

  app.route('/v1/sync', sync)

  return app
}
