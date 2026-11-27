import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { csv, results, submit } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.post('/:id/items/:iid/survey/submit', submit)
app.get('/:id/items/:iid/survey/results', results)
app.get('/:id/items/:iid/survey/results.csv', csv)

export default app
