import { Hono } from 'hono'
import { config } from '../../lib/config'
import type { AppEnv } from '../../lib/types'
import {
  logout,
  microsoftCallback,
  showCompleteRegister,
  showForgotPassword,
  showLogin,
  showMicrosoftRegister,
  showRegister,
  showResetPassword,
  startMicrosoft,
  submitCompleteRegister,
  submitForgotPassword,
  submitLogin,
  submitMicrosoftRegister,
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

if (config.microsoft) {
  app.post('/auth/microsoft', startMicrosoft)
  app.get('/auth/microsoft/callback', microsoftCallback)
  app.get('/auth/microsoft/register', showMicrosoftRegister)
  app.post('/auth/microsoft/register', submitMicrosoftRegister)
}

export default app
