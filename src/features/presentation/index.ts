import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { createPresentationHandlers, presentationApi, presentationRoutes } from './handlers'

export { isPresentationUpload } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', presentationRoutes(createPresentationHandlers(backend)))

export default app

/** 拡張機能が呼ぶ API。ログインのセッションを使わないので requireAuth を付けない */
export const api = presentationApi(backend)
