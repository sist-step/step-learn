import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { create, leave, list, remove, settings, show, updateSettings } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/', list)
app.post('/', create)
app.get('/:id', show)
app.post('/:id/leave', leave)
app.get('/:id/settings', settings)
app.post('/:id/settings', updateSettings)
app.post('/:id/delete', remove)

export default app
