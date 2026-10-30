import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { logout, showCompleteRegister, showLogin, showRegister, submitCompleteRegister, submitLogin, submitRegister } from './handlers'

const app = new Hono<AppEnv>()

app.get('/login', showLogin)
app.post('/login', submitLogin)
app.get('/register', showRegister)
app.post('/register', submitRegister)
app.get('/register/complete', showCompleteRegister)
app.post('/register/complete', submitCompleteRegister)
app.post('/logout', logout)

export default app
