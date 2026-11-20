import { aiLedger, isAiTeacher } from '../ai/ai-usage'
import { db } from '../../lib/db'
import { findUser } from '../../lib/item-access'
import { docsMcpTools } from './mcp'
import { createOAuthStore } from './oauth'
import { oauthClients, oauthCodes, oauthGrants } from '../../lib/schema'
import type { McpBackend } from './handlers'

/** 通常モード: クライアントと接続を step-learn.db に置き、教師かどうかを STEP Learn のロールとコースの参加から確かめる */
export const backend: McpBackend = {
  store: createOAuthStore({ db, oauthClients, oauthCodes, oauthGrants }),
  canUse: async (c) => !!c.var.user && isAiTeacher(c.var.user),
  async signIn(c, userId) {
    const user = findUser(userId)
    if (!user) return 'expired'
    c.set('user', user)
    return isAiTeacher(user) ? 'ok' : 'forbidden'
  },
  tools: docsMcpTools(aiLedger),
}
