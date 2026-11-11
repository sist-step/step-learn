import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { close, send, show } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/chat', show)
app.post('/chat', send)
app.post('/chat/close', close)

export default app

export { renderAiPanel } from './handlers'
