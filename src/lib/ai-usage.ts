import { and, count, countDistinct, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import {
  AI_PROVIDER_MODELS,
  AI_PROVIDERS,
  aiProvider,
  hasAiEmail,
  isProviderEnabled,
  type AiModel,
  type AiProvider,
  type AiUsage,
} from './ai'
import { AI_ACTIVE_WINDOW, AI_DEFAULT_MONTHLY_LIMITS, aiPeriod, aiPool, aiQuota, type AiPeriod, type AiQuota } from './ai-quota'
import { db } from './db'
import { aiUsage, appSettings, enrollments, users } from './schema'
import type { User } from './types'

const limitKey = (provider: AiProvider) => `ai_monthly_limit_${provider}`

const unixNow = () => Math.floor(Date.now() / 1000)

const totalCost = sql<number>`coalesce(sum(${aiUsage.cost}), 0)`

// 提供元の列を持たないのは、モデルから決まるので、記録と一覧がずれる余地を作らないため
const ofProvider = (provider: AiProvider) => inArray(aiUsage.model, [...AI_PROVIDER_MODELS[provider]])

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

/** 月の上限（USD）。0 なら、その提供元のモデルは使えない */
export function getMonthlyLimit(provider: AiProvider) {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, limitKey(provider)))
    .get()
  const limit = row ? Number(row.value) : AI_DEFAULT_MONTHLY_LIMITS[provider]
  return Number.isFinite(limit) && limit > 0 ? limit : 0
}

export function setMonthlyLimits(limits: Record<AiProvider, number>) {
  db.transaction((tx) => {
    for (const provider of AI_PROVIDERS) {
      const value = String(limits[provider])
      tx.insert(appSettings)
        .values({ key: limitKey(provider), value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run()
    }
  })
}

export function recordUsage(userId: number, model: AiModel, usage: AiUsage) {
  db.insert(aiUsage)
    .values({ userId, model, ...usage })
    .run()
}

const spent = (provider: AiProvider, from: number, { until, userId }: { until?: number; userId?: number } = {}) =>
  db
    .select({ cost: totalCost })
    .from(aiUsage)
    .where(
      and(
        ofProvider(provider),
        gte(aiUsage.createdAt, from),
        until === undefined ? undefined : lt(aiUsage.createdAt, until),
        userId === undefined ? undefined : eq(aiUsage.userId, userId),
      ),
    )
    .get()?.cost ?? 0

const activeUsers = (provider: AiProvider, at: number, except?: number) =>
  db
    .select({ n: countDistinct(aiUsage.userId) })
    .from(aiUsage)
    .where(
      and(
        ofProvider(provider),
        gte(aiUsage.createdAt, at - AI_ACTIVE_WINDOW),
        except === undefined ? undefined : ne(aiUsage.userId, except),
      ),
    )
    .get()?.n ?? 0

/** model の提供元での、本人の今週の枠と使った額 */
export function getQuota(userId: number, model: AiModel, at = unixNow()): AiQuota {
  const provider = aiProvider(model)
  const period = aiPeriod(at)
  return aiQuota({
    monthlyLimit: getMonthlyLimit(provider),
    monthSpent: spent(provider, period.monthStart),
    spentBefore: spent(provider, period.monthStart, { until: period.start }),
    userSpent: spent(provider, period.start, { userId }),
    // 本人を必ず数えるのは、初めて使う人の枠が、ほかの人数だけで割った大きい額にならないようにするため
    activeUsers: activeUsers(provider, at, userId) + 1,
    period,
  })
}

export type AiOverview = {
  provider: AiProvider
  enabled: boolean
  monthlyLimit: number
  monthSpent: number
  /** 今週の全体枠 */
  pool: number
  activeUsers: number
}

export function aiOverview(provider: AiProvider, at = unixNow()): AiOverview {
  const period = aiPeriod(at)
  const monthlyLimit = getMonthlyLimit(provider)
  return {
    provider,
    enabled: isProviderEnabled(provider),
    monthlyLimit,
    monthSpent: spent(provider, period.monthStart),
    pool: aiPool(monthlyLimit, spent(provider, period.monthStart, { until: period.start }), period),
    activeUsers: activeUsers(provider, at),
  }
}

/** ユーザーとモデルの組ごとの使用量。name などが null の行は、削除されたユーザーの分をまとめたもの */
export type AiUserUsage = {
  id: number | null
  name: string | null
  username: string | null
  email: string | null
  model: string
  week: number
  month: number
  calls: number
}

export function usageByUser({ monthStart, start }: AiPeriod = aiPeriod(unixNow())): AiUserUsage[] {
  return db
    .select({
      id: aiUsage.userId,
      name: users.name,
      username: users.username,
      email: users.email,
      model: aiUsage.model,
      week: sql<number>`coalesce(sum(case when ${aiUsage.createdAt} >= ${start} then ${aiUsage.cost} end), 0)`,
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
