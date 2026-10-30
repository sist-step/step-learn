import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { show } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/items/:iid/screen', show)

export default app
