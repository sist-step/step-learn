import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { backend } from './backend'
import { bundleRoutes, createBundleHandlers, vscodeApi } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', bundleRoutes(createBundleHandlers(backend)))

export default app

/** 拡張機能が呼ぶ API。ログインのセッションを使わないので requireAuth を付けない */
export const api = vscodeApi(backend)
