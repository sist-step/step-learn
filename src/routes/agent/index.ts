import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { agentApi, launch, removeKey, saveKey } from './handlers'

export { isAgentRequest } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.post('/:id/items/:iid/agent/launch', launch)
app.post('/:id/items/:iid/agent/key', saveKey)
app.post('/:id/items/:iid/agent/key/delete', removeKey)

export default app

/** 拡張機能が呼ぶ API。ログインのセッションを使わないので requireAuth を付けない */
export const api = agentApi()
