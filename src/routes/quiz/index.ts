import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { createQuizHandlers, quizRoutes } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', quizRoutes(createQuizHandlers(backend)))

export default app
