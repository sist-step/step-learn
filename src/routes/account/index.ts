import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { changePassword, show, updateProfile } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/', show)
app.post('/', updateProfile)
app.post('/password', changePassword)

export default app
