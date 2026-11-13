// DB を読み込まず、渡された DB とテーブルで動かすのは、通常モード（step-learn.db）と Moodle モード（moodle-mode.db）の両方で同じ計算を使うため
import { and, countDistinct, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  AI_PROVIDER_MODELS,
  AI_PROVIDERS,
  AI_RETIRED_PROVIDER_MODELS,
  OPENROUTER_DECISION_MODELS,
  aiProvider,
  isProviderEnabled,
  type AiModel,
  type DecisionModel,
  type AiProvider,
  type AiUsage,
} from './ai'
import { AI_ACTIVE_WINDOW, AI_DEFAULT_MONTHLY_LIMITS, aiPeriod, aiPool, aiQuota, type AiQuota } from './ai-quota'
import type { aiUsage as aiUsageTable, appSettings as appSettingsTable } from './schema'

const limitKey = (provider: AiProvider) => `ai_monthly_limit_${provider}`

const unixNow = () => Math.floor(Date.now() / 1000)

export type AiOverview = {
  provider: AiProvider
  enabled: boolean
  monthlyLimit: number
  monthSpent: number
  /** 今週の全体枠 */
  pool: number
  activeUsers: number
}

/** ユーザーとモデルの組ごとの使用量。name などが null の行は、利用者に数えない使用量と、削除されたユーザーの分をまとめたもの */
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

export type AiLedger = ReturnType<typeof createAiLedger>

/** AI の月の上限と使用量を、db の ai_usage と app_settings で扱う。Moodle モードのテーブルも同じ形にする（moodle-mode/schema.ts） */
export function createAiLedger<S extends Record<string, unknown>>({
  db,
  aiUsage,
  appSettings,
}: {
  db: BetterSQLite3Database<S>
  aiUsage: typeof aiUsageTable
  appSettings: typeof appSettingsTable
}) {
  const totalCost = sql<number>`coalesce(sum(${aiUsage.cost}), 0)`
  const weekCost = (start: number) => sql<number>`coalesce(sum(case when ${aiUsage.createdAt} >= ${start} then ${aiUsage.cost} end), 0)`

  // 提供元の列を持たないのは、モデルから決まるので、記録と一覧がずれる余地を作らないため
  const ofProvider = (provider: AiProvider) =>
    inArray(aiUsage.model, [
      ...AI_PROVIDER_MODELS[provider],
      ...AI_RETIRED_PROVIDER_MODELS[provider],
      ...(provider === 'openrouter' ? OPENROUTER_DECISION_MODELS : []),
    ])

  /** 月の上限（USD）。0 なら、その提供元のモデルは使えない */
  function getMonthlyLimit(provider: AiProvider) {
    const row = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, limitKey(provider)))
      .get()
    const limit = row ? Number(row.value) : AI_DEFAULT_MONTHLY_LIMITS[provider]
    return Number.isFinite(limit) && limit > 0 ? limit : 0
  }

  function setMonthlyLimits(limits: Record<AiProvider, number>) {
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

  /** userId が null のものは、特定の利用者に数えない使用量（コードのアイテムの採点） */
  function recordUsage(userId: number | null, model: AiModel | DecisionModel, usage: AiUsage) {
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
  function getQuota(userId: number, model: AiModel, at = unixNow()): AiQuota {
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

  /** 全体で、今月の使用量が月の上限に達していないか */
  function withinMonthlyLimit(provider: AiProvider, at = unixNow()) {
    return spent(provider, aiPeriod(at).monthStart) < getMonthlyLimit(provider)
  }

  function aiOverview(provider: AiProvider, at = unixNow()): AiOverview {
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

  return { totalCost, weekCost, getMonthlyLimit, setMonthlyLimits, recordUsage, getQuota, withinMonthlyLimit, aiOverview }
}
