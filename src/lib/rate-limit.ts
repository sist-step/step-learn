// 固定ウィンドウ方式のレート制限。
// プロセス 1 つで動く前提なので、SQLite に書かずメモリに持つ（再起動でリセットされるのは許容する）

const PURGE_ABOVE = 10_000

export function rateLimiter({ limit, windowSec }: { limit: number; windowSec: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  const current = (key: string, now: number) => {
    const entry = hits.get(key)
    return entry && entry.resetAt > now ? entry : null
  }

  return {
    /** 上限に達していれば解除までの秒数、まだ余裕があれば 0 */
    retryAfter(key: string) {
      const now = Date.now()
      const entry = current(key, now)
      return entry && entry.count >= limit ? Math.ceil((entry.resetAt - now) / 1000) : 0
    },

    hit(key: string) {
      const now = Date.now()
      const entry = current(key, now)
      if (entry) {
        entry.count++
        return
      }
      if (hits.size >= PURGE_ABOVE) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
      }
      hits.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    },

    reset(key: string) {
      hits.delete(key)
    },
  }
}
