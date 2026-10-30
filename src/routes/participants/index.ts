import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { add, candidates, changeRole, list, remove } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/participants', list)
app.get('/:id/participants/candidates', candidates)
app.post('/:id/participants', add)
app.post('/:id/participants/:uid/role', changeRole)
app.post('/:id/participants/:uid/remove', remove)

export default app
