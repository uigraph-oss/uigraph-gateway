import { serve } from '@hono/node-server'
import { createApp } from './app'
import { config } from './lib/config'

const app = createApp()

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`[uigraph-gateway] listening on :${info.port}`)
})
