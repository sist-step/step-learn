import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { create, list, remove, show, update } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/groups', list)
app.post('/:id/groups', create)
app.get('/:id/groups/:gid', show)
app.post('/:id/groups/:gid', update)
app.post('/:id/groups/:gid/delete', remove)

export default app
