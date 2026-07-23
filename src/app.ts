import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { auth, chatAuth, flexAuth, type GatewayVars } from './middleware/auth'
import { onError } from './middleware/error'
import { chatRoutes } from './routes/chat'
import { conversionRoutes } from './routes/conversion'
import { diagramRoutes } from './routes/diagram'
import { docsRoutes } from './routes/docs'
import { mapRoutes } from './routes/maps'
import { mlRoutes } from './routes/ml'
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
  sync.route('/', mlRoutes)

  app.route('/v1/sync', sync)

  const ai = new Hono<AppEnv>()
  ai.use('*', chatAuth)
  ai.route('/', chatRoutes)

  app.route('/v1/ai', ai)

  const util = new Hono<AppEnv>()
  util.use('*', flexAuth)
  util.route('/', conversionRoutes)

  app.route('/v1/util', util)

  return app
}
