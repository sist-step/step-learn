import type { Server as HttpServer } from 'node:http'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  COLLAB_KIND,
  collabSettingsOf,
  ownerFor,
  ownerUserId,
  startsFromTemplate,
  type CollabOwner,
  type CollabStore,
} from '../features/collab/collab'
import type { CollabAuth } from '../features/collab/collab-protocol'
import { attachCollab } from '../features/collab/collab-server'
import { intParam } from '../lib/http'
import type { CollabBackend } from '../features/collab/handlers'
import { sessionFromCookieHeader, type MoodleEnv } from './auth'
import { isAccessDenied, isNotFound, isTokenError } from './client'
import { loadCourse, loadCourseAs, outlineOf, type LoadedCourse } from './data'
import { db } from './db'
import { collabDocs, users } from './schema'

const loadState = (key: string, owner: CollabOwner) =>
  db
    .select({ state: collabDocs.state })
    .from(collabDocs)
    .where(and(eq(collabDocs.key, key), eq(collabDocs.owner, owner)))
    .get()?.state ?? null

// 鍵に m: を付けるのは、通常モードの部屋の鍵（アイテムの ID）と取り違えないため。同じサーバーで両方が動くことはないが、念のため分ける
const roomKey = (key: string, owner: CollabOwner) => `m:${key}:${owner}`

/** Moodle モード（moodle-mode.db）の、アイテム 1 つのファイル。key は extra_items の key */
export function collabStore(key: string): CollabStore {
  const isStudent = (userId: number) =>
    !!db
      .select({ id: collabDocs.id })
      .from(collabDocs)
      .where(and(eq(collabDocs.key, key), eq(collabDocs.userId, userId)))
      .get()
  return {
    doc: (owner) => ({
      key: roomKey(key, owner),
      load: () => loadState(key, owner),
      save(state, userId) {
        const values = { state: Buffer.from(state), updatedBy: userId || null }
        db.insert(collabDocs)
          .values({ key, owner, userId: ownerUserId(owner), ...values })
          .onConflictDoUpdate({ target: [collabDocs.key, collabDocs.owner], set: values })
          .run()
      },
      template: startsFromTemplate(owner) ? { key: roomKey(key, 'template'), load: () => loadState(key, 'template') } : undefined,
    }),
    // コースの学生を並べないのは、参加者が Moodle にあり、STEP Learn は自分にログインした人しか知らないため。ファイルを開いた人だけを並べる
    students: () =>
      db
        .select({ id: users.id, name: users.name, updatedAt: collabDocs.updatedAt })
        .from(collabDocs)
        .innerJoin(users, eq(users.id, collabDocs.userId))
        .where(and(eq(collabDocs.key, key), isNotNull(collabDocs.userId)))
        .orderBy(users.name)
        .limit(1000)
        .all(),
    isStudent,
    imagePrefix: `moodle-collab/${key}`,
  }
}

/** 共同編集の画面を開けるアイテム。開けなければ null */
const findCollabItem = (loaded: LoadedCourse, itemId: number) =>
  outlineOf(loaded).find((it) => it.id === itemId && !it.locked && it.extra?.type === COLLAB_KIND) ?? null

/** Moodle モード: 種類を extra_items に、ファイルを moodle-mode.db に置き、権限を Moodle のコースから確かめる */
export const collabBackend: CollabBackend = {
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = findCollabItem(loaded, itemId)
    if (!item?.extraKey || !item.extra) return null
    return {
      access: loaded.access,
      item: { id: itemId, title: item.title },
      settings: collabSettingsOf(item.extra.data),
      store: collabStore(item.extraKey),
    }
  },
}

async function authorize(cookie: string | undefined, { courseId, itemId, owner: requested }: CollabAuth) {
  const found = await sessionFromCookieHeader(cookie)
  if (!found) return null
  try {
    const loaded = await loadCourseAs({ token: found.token, userId: found.user.id }, courseId)
    const item = findCollabItem(loaded, itemId)
    if (!item?.extraKey || !item.extra) return null
    const store = collabStore(item.extraKey)
    const owner = ownerFor(store, collabSettingsOf(item.extra.data), { id: found.user.id, canManage: loaded.access.canManage }, requested)
    return owner ? { user: { id: found.user.id, name: found.user.name }, doc: store.doc(owner) } : null
  } catch (e) {
    // Moodle が一時的に止まっただけで切らないのは、編集中の全員の接続が途切れるため。権限がないと分かったときだけ切る
    if (isTokenError(e) || isNotFound(e) || isAccessDenied(e)) return null
    throw e
  }
}

export const attach = (httpServer: HttpServer) => attachCollab(httpServer, { authorize })
