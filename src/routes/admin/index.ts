import { Hono } from 'hono'
import { requireAuth, requireRole } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { changeRole, listCourses, listUsers, showAi, updateAi } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth, requireRole('admin'))

app.get('/users', (c) => c.redirect('/admin', 301))
app.get('/', listUsers)
app.post('/users/:id/role', changeRole)
app.get('/courses', listCourses)
app.get('/ai', showAi)
app.post('/ai', updateAi)

export default app
