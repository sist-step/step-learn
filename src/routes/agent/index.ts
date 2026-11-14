import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { agentApi, agentRequestCheck, agentRoutes, createAgentHandlers } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', agentRoutes(createAgentHandlers(backend)))

export default app

export const isAgentRequest = agentRequestCheck(backend)

/** 拡張機能が呼ぶ API。ログインのセッションを使わないので requireAuth を付けない */
export const api = agentApi(backend)
