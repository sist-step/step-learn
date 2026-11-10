// 通常モードと Moodle モードの両方から使うので、DB を読み込まない
import type { AiProvider } from './ai-models'

/** 管理画面で保存するまでの月の上限（USD） */
export const AI_DEFAULT_MONTHLY_LIMITS: Record<AiProvider, number> = { openrouter: 3, anthropic: 15 }

const DAY = 86_400
// Intl で求めないのは、日本時間には夏時間がなく、固定の時差で計算できるため
const JST_OFFSET = 9 * 3600

/** 利用者として数える期間（直近 4 週間） */
export const AI_ACTIVE_WINDOW = 28 * DAY

/** 上限を数える期間。start〜end は月曜始まりの週を、その月（monthStart〜monthEnd）の中に切り詰めたもの */
export type AiPeriod = { monthStart: number; monthEnd: number; start: number; end: number }

export function aiPeriod(at: number): AiPeriod {
  const local = at + JST_OFFSET
  const day = Math.floor(local / DAY)
  const weekStart = (day - ((day + 3) % 7)) * DAY - JST_OFFSET
  const date = new Date(local * 1000)
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000 - JST_OFFSET
  const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000 - JST_OFFSET
  // 月をまたぐ週を 1 つの期間にしないのは、上限が月ごとに決まっていて、2 つの月の予算を混ぜることになるため
  return { monthStart, monthEnd, start: Math.max(weekStart, monthStart), end: Math.min(weekStart + 7 * DAY, monthEnd) }
}

/** 期間の全体枠。月の残りを、月末までの日数に対する期間の日数の割合で分ける。spentBefore は月初から期間の開始までの消費 */
export const aiPool = (monthlyLimit: number, spentBefore: number, { monthEnd, start, end }: AiPeriod) =>
  Math.max(0, monthlyLimit - spentBefore) * ((end - start) / (monthEnd - start))

/** off: 月の上限が 0 / month: 全体が月の上限に達した / week: 本人が今週の枠を使い切った */
export type AiQuotaState = 'ok' | 'week' | 'month' | 'off'

/** limit は本人の今週の枠、used はそのうち使った額（USD）。resetAt は次に使えるようになる時刻 */
export type AiQuota = { state: AiQuotaState; limit: number; used: number; resetAt: number }

export function aiQuota(usage: {
  monthlyLimit: number
  monthSpent: number
  spentBefore: number
  userSpent: number
  activeUsers: number
  period: AiPeriod
}): AiQuota {
  const { monthlyLimit, monthSpent, userSpent: used, period } = usage
  const limit = aiPool(monthlyLimit, usage.spentBefore, period) / Math.max(1, usage.activeUsers)
  if (monthlyLimit <= 0) return { state: 'off', limit: 0, used, resetAt: period.end }
  if (monthSpent >= monthlyLimit) return { state: 'month', limit, used, resetAt: period.monthEnd }
  return { state: used >= limit ? 'week' : 'ok', limit, used, resetAt: period.end }
}
