import { count, desc, eq, gte } from 'drizzle-orm'
import { createAiLedger, type AiUserUsage } from '../lib/ai-ledger'
import { aiPeriod, type AiPeriod } from '../lib/ai-quota'
import { db } from './db'
import { aiUsage, appSettings, users } from './schema'

/** Moodle モード（moodle-mode.db）の AI の月の上限と使用量 */
export const aiLedger = createAiLedger({ db, aiUsage, appSettings })

// 通常モードの usageByUser（lib/ai-usage.ts）と共通にしないのは、ユーザーのテーブルが DB ごとに違う形で、まとめると型で結果を確かめられなくなるため
export function usageByUser({ monthStart, start }: AiPeriod = aiPeriod(Math.floor(Date.now() / 1000))): AiUserUsage[] {
  const { totalCost, weekCost } = aiLedger
  return db
    .select({
      id: aiUsage.userId,
      name: users.name,
      username: users.username,
      email: users.email,
      model: aiUsage.model,
      week: weekCost(start),
      month: totalCost,
      calls: count(),
    })
    .from(aiUsage)
    .leftJoin(users, eq(users.id, aiUsage.userId))
    .where(gte(aiUsage.createdAt, monthStart))
    .groupBy(aiUsage.userId, aiUsage.model)
    .orderBy(desc(totalCost))
    .limit(200)
    .all()
}
