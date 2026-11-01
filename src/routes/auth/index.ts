import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import {
  logout,
  showCompleteRegister,
  showForgotPassword,
  showLogin,
  showRegister,
  showResetPassword,
  submitCompleteRegister,
  submitForgotPassword,
  submitLogin,
  submitRegister,
  submitResetPassword,
} from './handlers'

const app = new Hono<AppEnv>()

app.get('/login', showLogin)
app.post('/login', submitLogin)
app.get('/register', showRegister)
app.post('/register', submitRegister)
app.get('/register/complete', showCompleteRegister)
app.post('/register/complete', submitCompleteRegister)
app.get('/password/forgot', showForgotPassword)
app.post('/password/forgot', submitForgotPassword)
app.get('/password/reset', showResetPassword)
app.post('/password/reset', submitResetPassword)
app.post('/logout', logout)

export default app
