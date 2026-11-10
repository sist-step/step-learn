import { and, count, desc, eq, gte } from 'drizzle-orm'
import { AI_PROVIDERS, hasAiEmail, isProviderEnabled } from './ai'
import { createAiLedger, type AiUserUsage } from './ai-ledger'
import { aiPeriod, type AiPeriod } from './ai-quota'
import { db } from './db'
import { aiUsage, appSettings, enrollments, users } from './schema'
import type { User } from './types'

export type { AiOverview, AiUserUsage } from './ai-ledger'

/** 通常モード（step-learn.db）の AI の月の上限と使用量 */
export const aiLedger = createAiLedger({ db, aiUsage, appSettings })

export const { getMonthlyLimit, setMonthlyLimits, recordUsage, getQuota, aiOverview } = aiLedger

export function canUseAi(user: User) {
  if (!AI_PROVIDERS.some(isProviderEnabled) || !hasAiEmail(user.email)) return false
  if (user.role !== 'student') return true
  const teaching = db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(and(eq(enrollments.userId, user.id), eq(enrollments.role, 'teacher')))
    .limit(1)
    .get()
  return !!teaching
}

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
