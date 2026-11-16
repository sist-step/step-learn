import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { codeRoutes, codeVscodeApi, createCodeHandlers } from './handlers'

export { CODE_BODY_LIMIT, isCodeRequest } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', codeRoutes(createCodeHandlers(backend)))

export default app

/** 拡張機能が呼ぶ API。ログインのセッションを使わないので requireAuth を付けない */
export const api = codeVscodeApi(backend)
