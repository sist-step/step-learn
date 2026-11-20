import { eq } from 'drizzle-orm'
import { aiLedger, isAiTeacher } from '../../lib/ai-usage'
import { db } from '../../lib/db'
import { docsMcpTools } from '../../lib/mcp'
import { createOAuthStore } from '../../lib/oauth'
import { oauthClients, oauthCodes, oauthGrants, users } from '../../lib/schema'
import type { McpBackend } from './handlers'

/** 通常モード: クライアントと接続を step-learn.db に置き、教師かどうかを STEP Learn のロールとコースの参加から確かめる */
export const backend: McpBackend = {
  store: createOAuthStore({ db, oauthClients, oauthCodes, oauthGrants }),
  canUse: async (c) => !!c.var.user && isAiTeacher(c.var.user),
  async signIn(c, userId) {
    const user = db
      .select({ id: users.id, email: users.email, name: users.name, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    if (!user) return 'expired'
    c.set('user', user)
    return isAiTeacher(user) ? 'ok' : 'forbidden'
  },
  tools: docsMcpTools(aiLedger),
}
