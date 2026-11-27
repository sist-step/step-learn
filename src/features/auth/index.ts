import { Hono } from 'hono'
import { config } from '../../lib/config'
import type { AppEnv } from '../../lib/types'
import {
  logout,
  microsoftCallback,
  showForgotPassword,
  showLogin,
  showMicrosoftRegister,
  showResetPassword,
  startMicrosoft,
  submitForgotPassword,
  submitLogin,
  submitMicrosoftRegister,
  submitResetPassword,
} from './handlers'

const app = new Hono<AppEnv>()

app.get('/login', showLogin)
app.post('/login', submitLogin)
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
