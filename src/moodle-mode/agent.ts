import { desc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { AGENT_KIND, type AgentItemRow } from '../lib/agent'
import { intParam } from '../lib/http'
import type { AgentBackend, AgentTarget } from '../routes/agent/handlers'
import { agentKeyStates, agentPeriodOf, agentStore, findAgentToken, revokeAgentToken, touchAgentToken } from './agent-store'
import { storedToken, type MoodleEnv } from './auth'
import { isAccessDenied, isNotFound, isTokenError } from './client'
import { loadCourse, loadCourseAs, outlineOf, type LoadedCourse, type Viewer } from './data'
import { db } from './db'
import { findExtra } from './extra'
import type { MItem } from './mapping'
import { extraItems, users } from './schema'

const REF_PREFIX = 'agent-m-'

const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** コースを開いた人が使える、その鍵のコーディングエージェントのアイテム */
const agentItemOf = (loaded: LoadedCourse, match: (it: MItem) => boolean) =>
  outlineOf(loaded).find((it) => match(it) && !it.locked && it.extra?.type === AGENT_KIND && !!it.extraKey)

const targetOf = (loaded: LoadedCourse, item: MItem): AgentTarget => ({
  course: loaded.access.course.title,
  title: item.title,
  instructions: text(item.extra!.data.body),
  store: agentStore(item.extraKey!, item.extra!.data),
})

/** viewer がコースを開けなければ null。Moodle に接続できないときなどは例外のまま投げる */
async function loadIfAllowed(viewer: Viewer, courseId: number) {
  try {
    return await loadCourseAs(viewer, courseId)
  } catch (e) {
    if (isNotFound(e) || isTokenError(e) || isAccessDenied(e)) return null
    throw e
  }
}

/** Moodle モード: API キー・使用量・トークンを moodle-mode.db に置き、開けるかを Moodle のコースから確かめる */
export const agentBackend: AgentBackend = {
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = agentItemOf(loaded, (it) => it.id === itemId)
    return item ? { ...targetOf(loaded, item), courseId, itemId, ref: `${REF_PREFIX}${item.extraKey}` } : null
  },
  // 中身の行があるかだけで決めないのは、Moodle のごみ箱から戻せるよう、活動を消しても中身を残しているため。
  // Moodle の画面で消した・非表示にした活動や、コースから外れた学生も止められるよう、Moodle で今も開けるかで確かめる（30 秒キャッシュする）
  async targetOf(ref, userId) {
    const key = ref.slice(REF_PREFIX.length)
    const found = ref.startsWith(REF_PREFIX) && key ? findExtra(key) : undefined
    const token = found?.type === AGENT_KIND ? storedToken(userId) : null
    const loaded = found && token && (await loadIfAllowed({ token, userId }, found.courseId))
    const item = loaded && agentItemOf(loaded, (it) => it.extraKey === key)
    return loaded && item ? targetOf(loaded, item) : null
  },
  findUser: (userId) => db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get(),
  findToken(token) {
    const found = findAgentToken(token)
    return found && { id: found.id, ref: `${REF_PREFIX}${found.key}`, userId: found.userId }
  },
  touchToken: touchAgentToken,
  revokeToken: revokeAgentToken,
}

/**
 * 管理画面に出す、コーディングエージェントのアイテム。キーを入れていないものを先に、新しい順。
 * タイトルと場所を Moodle から取るので、Moodle で消した活動（ごみ箱にあるものを含む）は並べない
 */
export async function listAgentItems(viewer: Viewer): Promise<AgentItemRow[]> {
  const rows = db
    .select({ key: extraItems.key, courseId: extraItems.courseId, data: extraItems.data })
    .from(extraItems)
    .where(eq(extraItems.type, AGENT_KIND))
    .orderBy(desc(extraItems.createdAt))
    .limit(500)
    .all()
  const courseIds = [...new Set(rows.map((r) => r.courseId))]
  const courses = new Map(await Promise.all(courseIds.map(async (id) => [id, await loadIfAllowed(viewer, id)] as const)))
  const states = agentKeyStates(rows.map((r) => r.key))
  const list = rows.flatMap((row) => {
    const loaded = courses.get(row.courseId)
    const item = loaded?.items.find((it) => it.extraKey === row.key && it.extra?.type === AGENT_KIND)
    const state = states.get(row.key)
    if (!loaded || !item || !state) return []
    const { opensAt, closesAt } = agentPeriodOf(row.data)
    return [
      { courseId: row.courseId, courseTitle: loaded.access.course.title, itemId: item.id, title: item.title, opensAt, closesAt, ...state },
    ]
  })
  // 並べ替えをクエリに任せないのは、キーの有無が別のテーブルにあり、Moodle に残っているものだけに絞ってから並べるため
  return list.sort((a, b) => Number(a.configured) - Number(b.configured))
}
