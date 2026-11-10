import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { codeRoutes, createCodeHandlers } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', codeRoutes(createCodeHandlers(backend)))

export default app
