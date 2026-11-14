import { and, desc, eq, lt, lte } from 'drizzle-orm'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { db } from './db'
import { clientIp } from './http'
import { courses, items, operationLogs, sections, users } from './schema'
import { LOG_KINDS, LOG_RETENTION_DAYS, type AppEnv, type LogKind } from './types'

type Target = 'course' | 'section' | 'item' | 'user'

type Rule = {
  method: 'GET' | 'POST'
  pattern: RegExp
  action: string
  label: string
  /** null は記録しない */
  kind: LogKind | null
  target?: Target
}

const PARAM = /:(id|sid|iid|uid)/g

const rule = (method: Rule['method'], path: string, action: string, label: string, kind: LogKind | null, target?: Target): Rule => ({
  method,
  pattern: new RegExp(`^${path.replace(PARAM, '(?<$1>\\d+)')}$`),
  action,
  label,
  kind,
  target,
})

const get = (path: string, action: string, label: string, target?: Target) => rule('GET', path, action, label, 'view', target)
const post = (path: string, action: string, label: string, kind: LogKind, target?: Target) =>
  rule('POST', path, action, label, kind, target)
const skip = (path: string) => rule('POST', path, 'skip', '', null)

// GET を一覧にないものまで残さないのは、JSON の取得や画像のように、画面を開くたびに何度も呼ばれるものまで数えてしまうため
const RULES: Rule[] = [
  get('/courses/:id', 'course.view', 'コースを開いた', 'course'),
  get('/courses/:id/items/:iid', 'item.view', 'アイテムを開いた', 'item'),
  get('/courses/:id/items/:iid/file', 'item.file', 'ファイルを開いた', 'item'),
  get('/courses/:id/items/:iid/screen', 'screen.view', '画面共有を開いた', 'item'),
  get('/courses/:id/items/:iid/bundle/zip', 'bundle.zip', 'zip をダウンロードした', 'item'),
  get('/courses/:id/items/:iid/code/submissions/:uid', 'code.submission.view', '提出を見た', 'user'),
  get('/courses/:id/items/:iid/bundle/history/:uid', 'bundle.history.view', '変更履歴を見た', 'user'),

  post('/login', 'login', 'ログイン', 'change'),
  rule('GET', '/auth/microsoft/callback', 'login.microsoft', 'Microsoft アカウントでログイン', 'change'),
  post('/logout', 'logout', 'ログアウト', 'change'),
  post('/register/complete', 'register', '新規登録', 'important'),
  post('/auth/microsoft/register', 'register.microsoft', 'Microsoft アカウントで新規登録', 'important'),
  post('/password/reset', 'password.reset', 'パスワードを再設定', 'important'),
  post('/account', 'account.update', 'プロフィールを変更', 'important'),
  post('/account/password', 'account.password', 'パスワードを変更', 'important'),
  post('/account/microsoft/unlink', 'account.microsoft.unlink', 'Microsoft アカウントの連携を解除', 'important'),

  post('/admin/users/:uid/role', 'admin.role', 'ユーザーのロールを変更', 'important', 'user'),
  post('/admin/ai', 'admin.ai', 'AI の月の上限を変更', 'important'),

  post('/courses', 'course.create', 'コースを作成', 'important'),
  post('/courses/:id/settings', 'course.settings', 'コースの設定を変更', 'change', 'course'),
  post('/courses/:id/(hero|icon)', 'course.image', 'コースの画像を変更', 'change', 'course'),
  post('/courses/:id/(hero|icon)/delete', 'course.image.delete', 'コースの画像を削除', 'change', 'course'),
  post('/courses/:id/delete', 'course.delete', 'コースを削除', 'important', 'course'),
  post('/courses/:id/leave', 'course.leave', 'コースから退出', 'important', 'course'),

  post('/courses/:id/participants', 'participant.add', '参加者を追加', 'important'),
  post('/courses/:id/participants/:uid/role', 'participant.role', '参加者のロールを変更', 'important', 'user'),
  post('/courses/:id/participants/:uid/remove', 'participant.remove', '参加者を除外', 'important', 'user'),

  post('/courses/:id/sections', 'section.create', 'セクションを追加', 'change'),
  post('/courses/:id/sections/:sid', 'section.update', 'セクションを編集', 'change', 'section'),
  post('/courses/:id/sections/:sid/move', 'section.move', 'セクションを並べ替え', 'change', 'section'),
  post('/courses/:id/sections/:sid/visibility', 'section.visibility', 'セクションの表示を切り替え', 'change', 'section'),
  post('/courses/:id/sections/:sid/delete', 'section.delete', 'セクションを削除', 'important', 'section'),
  post('/courses/:id/items', 'item.create', 'アイテムを追加', 'change'),
  post('/courses/:id/items/:iid', 'item.update', 'アイテムを編集', 'change', 'item'),
  post('/courses/:id/items/:iid/move', 'item.move', 'アイテムを並べ替え', 'change', 'item'),
  post('/courses/:id/items/:iid/visibility', 'item.visibility', 'アイテムの表示を切り替え', 'change', 'item'),
  post('/courses/:id/items/:iid/judge', 'item.judge', '制約の判定方法を切り替え', 'change', 'item'),
  post('/courses/:id/items/:iid/delete', 'item.delete', 'アイテムを削除', 'important', 'item'),
  post('/courses/:id/items/:iid/complete', 'item.complete', '完了を切り替え', 'change', 'item'),

  post('/courses/:id/items/:iid/code/submit', 'code.submit', 'コードを提出', 'change', 'item'),
  post('/courses/:id/items/:iid/code/reset', 'code.reset', 'コードを最初に戻した', 'change', 'item'),
  post('/courses/:id/items/:iid/code/suggest', 'code.suggest', 'AI で最初のコードと制約を作成', 'change', 'item'),
  post('/courses/:id/items/:iid/code/submissions/:uid/review', 'code.review', '提出に点数・コメントを付けた', 'change', 'user'),
  post('/courses/:id/items/:iid/code/submissions/:uid/regrade', 'code.regrade', '提出を AI で採点し直した', 'change', 'user'),

  post('/courses/:id/items/:iid/bundle/files', 'bundle.upload', '配布するファイルをアップロード', 'change', 'item'),
  post('/courses/:id/items/:iid/bundle/files/delete', 'bundle.delete', '配布するファイルを削除', 'change', 'item'),
  post('/courses/:id/items/:iid/bundle/launch', 'bundle.launch', 'VS Code で開いた', 'change', 'item'),
  post('/courses/:id/items/:iid/bundle/sync', 'bundle.sync', 'データの同期を切り替え', 'change', 'item'),

  post('/ai/chat', 'ai.send', 'AI に依頼', 'change'),
  post('/ai/chat/confirm', 'ai.confirm', 'AI の確認カードに回答', 'change'),

  // 自動保存・実行・チャットを閉じる操作を残さないのは、数が多いわりに、あとから確かめる必要のない操作のため
  skip('/courses/:id/items/:iid/code/draft'),
  skip('/courses/:id/items/:iid/code/run'),
  skip('/ai/chat/close'),
  skip('/views'),
  // Microsoft のサインイン画面へ移る操作を残さないのは、戻ってきたときのログイン・連携のほうを残すため
  skip('/auth/microsoft'),
  skip('/account/microsoft'),
]

// URL だけで決めないのは、Microsoft の戻り先がログインにも連携にも使う 1 つの URL のため
const ALTERNATES = {
  'login.microsoft.failed': { label: 'Microsoft アカウントでのログインに失敗', kind: 'change' },
  'account.microsoft.link': { label: 'Microsoft アカウントを連携', kind: 'important' },
  'account.microsoft.link.failed': { label: 'Microsoft アカウントの連携に失敗', kind: 'change' },
} as const satisfies Record<string, { label: string; kind: LogKind }>

export type LogAs = keyof typeof ALTERNATES

/** この要求を、URL で決まる操作ではなく別の操作として残す */
export const logAs = (c: Context<AppEnv>, action: LogAs) => c.set('logAs', action)

const LOGIN_FAILED = { action: 'login.failed', label: 'ログインに失敗' }

// 一覧にない POST も残すのは、データを変える操作を足したときに一覧へ足し忘れても、記録から漏れないようにするため
const OTHER: Rule = { method: 'POST', pattern: /^/, action: 'other', label: 'その他の操作', kind: 'change' }

const ACTION_LABELS: Record<string, string> = Object.fromEntries([
  ...RULES.filter((r) => r.kind).map((r) => [r.action, r.label]),
  [LOGIN_FAILED.action, LOGIN_FAILED.label],
  ...Object.entries(ALTERNATES).map(([action, { label }]) => [action, label]),
  [OTHER.action, OTHER.label],
])

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action

type Match = { rule: Rule; kind: LogKind; params: Partial<Record<'id' | 'sid' | 'iid' | 'uid', number>> }

const toParams = (groups: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(groups ?? {}).map(([k, v]) => [k, Number(v)]))

function matchRule(method: string, path: string): Match | null {
  if (method !== 'GET' && method !== 'POST') return null
  for (const r of RULES) {
    if (r.method !== method) continue
    const m = r.pattern.exec(path)
    if (!m) continue
    return r.kind ? { rule: r, kind: r.kind, params: toParams(m.groups) } : null
  }
  if (method !== 'POST' || path.startsWith('/api/')) return null
  return { rule: OTHER, kind: 'change', params: toParams(/^\/courses\/(?<id>\d+)\//.exec(path)?.groups) }
}

function describe({ rule: r, params }: Match): string | null {
  const { id, sid, iid, uid } = params
  const title = (() => {
    switch (r.target) {
      case 'course':
        return id && db.select({ v: courses.title }).from(courses).where(eq(courses.id, id)).get()
      case 'section':
        return (
          id &&
          sid &&
          db
            .select({ v: sections.title })
            .from(sections)
            .where(and(eq(sections.id, sid), eq(sections.courseId, id)))
            .get()
        )
      case 'item':
        return (
          id &&
          iid &&
          db
            .select({ v: items.title })
            .from(items)
            .where(and(eq(items.id, iid), eq(items.courseId, id)))
            .get()
        )
      case 'user':
        return uid && db.select({ v: users.name }).from(users).where(eq(users.id, uid)).get()
    }
  })()
  return title ? title.v.slice(0, 200) : null
}

let purgedAt = 0

// 定期的に動く仕組みにしないのは、記録するたびに 1 時間おきに確かめれば足り、使われていないあいだは消すものも増えないため
function purgeExpired(t: number) {
  if (t - purgedAt < 60 * 60) return
  purgedAt = t
  for (const kind of LOG_KINDS) {
    const days = LOG_RETENTION_DAYS[kind]
    if (days === null) continue
    const expired = lt(operationLogs.createdAt, t - days * 24 * 60 * 60)
    // 日時だけで消さないのは、種類の索引で絞った行をすべて日時と比べることになり、行が多いと遅いため。
    // ID だけで消さないのは、サーバーの時計が戻ると ID と日時の順が食い違い、期限内の記録まで消えるため
    const last = db
      .select({ id: operationLogs.id })
      .from(operationLogs)
      .where(expired)
      .orderBy(desc(operationLogs.createdAt))
      .limit(1)
      .get()
    if (last)
      db.delete(operationLogs)
        .where(and(eq(operationLogs.kind, kind), lte(operationLogs.id, last.id), expired))
        .run()
  }
}

function record(c: Context<AppEnv>, match: Match, path: string, target: string | null, failed = false) {
  const t = Math.floor(Date.now() / 1000)
  const auth = ['login', 'login.microsoft', 'logout'].includes(match.rule.action)
  const alternate = c.var.logAs
  try {
    db.insert(operationLogs)
      .values({
        userId: c.var.logUserId ?? c.var.user?.id ?? null,
        kind: alternate ? ALTERNATES[alternate].kind : match.kind,
        action: failed ? LOGIN_FAILED.action : (alternate ?? match.rule.action),
        path: path.slice(0, 500),
        courseId: match.params.id ?? null,
        target,
        ip: clientIp(c),
        userAgent: auth ? (c.req.header('user-agent') ?? '').slice(0, 300) : null,
        createdAt: t,
      })
      .run()
    purgeExpired(t)
  } catch (e) {
    // 例外を投げ直さないのは、操作そのものはもう済んでいて、記録できなかっただけで失敗の画面を出すことになるため
    console.error('[operation-log]', e)
  }
}

/** 画面の表示と、データを変える操作を operation_logs に残す */
export const operationLog = createMiddleware<AppEnv>(async (c, next) => {
  const match = matchRule(c.req.method, c.req.path)
  // client.ts の先読みと開いている画面の更新を数えないのは、カーソルを乗せただけの画面まで開いたことになるため
  if (!match || c.req.header('x-background')) return next()
  const range = c.req.header('range')
  // 途中からの範囲指定を数えないのは、動画や PDF は少しずつ読み込まれ、1 回開くだけで何十件も残るため
  if (range && !range.startsWith('bytes=0-')) return next()
  // トーストを出す画面を数えないのは、操作のあとに移された画面で、開こうとして開いたものではなく、操作のたびに閲覧が 1 件ずつ増えるため
  if (match.kind === 'view' && c.var.flash) return next()

  const target = c.var.user && match.rule.target ? describe(match) : null
  await next()

  const status = c.res.status
  const failed = match.rule.action === 'login' && status === 401
  if (status >= 400 && !failed) return
  if (!failed && !c.var.logUserId && !c.var.user) return
  record(c, match, c.req.path, target, failed)
})

/** 先読みしておいた画面を開いたときに client.ts が送る。先読みの要求は operationLog が数えないため */
export function recordPrefetchedView(c: Context<AppEnv>, path: string) {
  if (!c.var.user || !path.startsWith('/')) return
  const match = matchRule('GET', path)
  if (match) record(c, match, path, describe(match))
}
