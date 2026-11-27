import { Hono } from 'hono'
import { requireAuth, requireRole } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import {
  addUser,
  changeRole,
  listAgents,
  listCourses,
  listLogs,
  listUsers,
  removeUser,
  showAi,
  showNewUser,
  showPassword,
  updateAi,
  updatePassword,
} from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth, requireRole('admin'))

app.get('/users', (c) => c.redirect('/admin', 301))
app.get('/', listUsers)
app.get('/users/new', showNewUser)
app.post('/users', addUser)
app.post('/users/:id/role', changeRole)
app.get('/users/:id/password', showPassword)
app.post('/users/:id/password', updatePassword)
app.post('/users/:id/delete', removeUser)
app.get('/courses', listCourses)
app.get('/ai', showAi)
app.post('/ai', updateAi)
app.get('/agents', listAgents)
app.get('/logs', listLogs)

export default app
