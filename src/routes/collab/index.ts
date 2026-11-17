import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { collabRoutes, createCollabHandlers } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', collabRoutes(createCollabHandlers(backend)))

export default app
