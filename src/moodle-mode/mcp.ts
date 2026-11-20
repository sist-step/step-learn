import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { docsMcpTools } from '../features/mcp/mcp'
import { createOAuthStore } from '../features/mcp/oauth'
import type { McpBackend } from '../features/mcp/handlers'
import { isMoodleAiTeacher } from './ai-assistant'
import { aiLedger } from './ai-usage'
import { storedToken, toUser, type MoodleEnv } from './auth'
import { isTokenError } from './client'
import { db } from './db'
import { oauthClients, oauthCodes, oauthGrants, users } from './schema'

/**
 * Moodle モード: クライアントと接続を moodle-mode.db に置き、教師かどうかを Moodle のロールで確かめる。
 * 同意するときは Moodle にログインしている必要があり、/mcp では、ログインしたときに受け取った Moodle のトークンが今も使えるかを確かめる
 */
export const mcpBackend: McpBackend = {
  store: createOAuthStore({ db, oauthClients, oauthCodes, oauthGrants }),
  canUse: (c) => isMoodleAiTeacher(c as Context<MoodleEnv>),
  async signIn(c, userId) {
    const row = db
      .select({ id: users.id, email: users.email, name: users.name, username: users.username, siteAdmin: users.siteAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    const token = row && storedToken(userId)
    if (!row || !token) return 'expired'
    const mc = c as Context<MoodleEnv>
    mc.set('user', toUser(row))
    mc.set('token', token)
    try {
      return (await isMoodleAiTeacher(mc)) ? 'ok' : 'forbidden'
    } catch (e) {
      if (isTokenError(e)) return 'expired'
      throw e
    }
  },
  tools: docsMcpTools(aiLedger),
}
