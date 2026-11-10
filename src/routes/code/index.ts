import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { reset, run, save, showState, submit } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/items/:iid/code/state', showState)
app.post('/:id/items/:iid/code/draft', save)
app.post('/:id/items/:iid/code/run', run)
app.post('/:id/items/:iid/code/submit', submit)
app.post('/:id/items/:iid/code/reset', reset)

export default app
