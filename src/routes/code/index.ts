import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { list, regrade, reset, review, run, save, show, showGrading, showState, submit } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/items/:iid/code/state', showState)
app.post('/:id/items/:iid/code/draft', save)
app.post('/:id/items/:iid/code/run', run)
app.post('/:id/items/:iid/code/submit', submit)
app.post('/:id/items/:iid/code/reset', reset)
app.get('/:id/items/:iid/code/grading', showGrading)
app.get('/:id/items/:iid/code/submissions', list)
app.get('/:id/items/:iid/code/submissions/:uid', show)
app.post('/:id/items/:iid/code/submissions/:uid/review', review)
app.post('/:id/items/:iid/code/submissions/:uid/regrade', regrade)

export default app
