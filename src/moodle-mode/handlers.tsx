import crypto from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { CourseCardData } from '../components/ui'
import { config } from '../lib/config'
import { firstError, isFile, validate } from '../lib/forms'
import { field, intParam, readForm, redirectWith, wantsJson } from '../lib/http'
import { previewKind } from '../lib/preview'
import { EXECUTABLE_NOT_ALLOWED, FILE_TOO_LARGE, MAX_FILE_SIZE, isExecutable } from '../lib/storage'
import { CoursesPage } from '../routes/courses/views'
import { DashboardPage } from '../routes/dashboard/views'
import { createSession, destroyByMoodleSid, destroySession, safeNext, type MoodleEnv } from './auth'
import { forgetCourse, forgetProgress, forgetSections } from './cache'
import { exchangeCode, fetchFile, moodleUrl, uploadDraft, type StateAction } from './client'
import { loadCourse, moodle, myCourses, otherCourses, outlineOf, progressOf, revisionOf, type LoadedCourse } from './data'
import { isOpenable, sectionHref, toCard, type MItem } from './mapping'
import { CoursePage, ItemEditPage, ItemPage, LoginPage, TEXT_PREVIEW_MAX } from './views'

type C = Context<MoodleEnv>

const base64url = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString('base64url')
const randomString = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

// ---------------------------------------------------------------- ログイン

const LOGIN_COOKIE = 'moodle_login'
const LOGIN_TTL = 10 * 60
const LOGIN_FAILED = 'ログインできませんでした。もう一度お試しください。'

export function showLogin(c: C) {
  if (c.var.user) return c.redirect('/dashboard')
  if (c.req.query('loggedout')) return redirectWith(c, '/login', 'ログアウトしました。', 'info')
  return c.render(<LoginPage next={c.req.query('next') ?? ''} />, { title: 'ログイン' })
}

export async function startLogin(c: C) {
  return redirectToMoodleLogin(c, safeNext(field(await readForm(c), 'next', 500)))
}

// POST の startLogin を使い回さないのは、Moodle（別オリジン）からのフォーム送信は CSRF の検証で弾かれるため
/** Moodle の画面にある「新しい STEP Learn を使う」から来たとき */
export const startLoginFromMoodle = (c: C) => redirectToMoodleLogin(c, '/dashboard')

async function redirectToMoodleLogin(c: C, next: string) {
  const state = randomString()
  const verifier = randomString()
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  await setSignedCookie(c, LOGIN_COOKIE, JSON.stringify({ state, verifier, next }), config.sessionSecret, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
    // Strict にしないのは、Moodle から戻ってくる遷移が別サイトからの遷移になり、Cookie が送られなくなるため
    sameSite: 'Lax',
    path: '/auth/moodle',
    maxAge: LOGIN_TTL,
  })
  const url = new URL(moodleUrl('/local/steplearn/login.php'))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  return c.redirect(url.href, 303)
}

const sameString = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function finishLogin(c: C) {
  const raw = await getSignedCookie(c, config.sessionSecret, LOGIN_COOKIE)
  deleteCookie(c, LOGIN_COOKIE, { path: '/auth/moodle' })
  const saved = typeof raw === 'string' ? (JSON.parse(raw) as { state: string; verifier: string; next: string }) : null
  const code = c.req.query('code') ?? ''
  if (!saved || !code || !sameString(saved.state, c.req.query('state') ?? '')) return redirectWith(c, '/login', LOGIN_FAILED, 'error')
  try {
    await createSession(c, await exchangeCode(code, saved.verifier))
  } catch (e) {
    console.error('[moodle] exchange', e)
    return redirectWith(c, '/login', LOGIN_FAILED, 'error')
  }
  return c.redirect(safeNext(saved.next), 303)
}

export async function logout(c: C) {
  await destroySession(c)
  return c.redirect(moodleUrl('/local/steplearn/logout.php'), 303)
}

const BACKCHANNEL_MAX_AGE = 5 * 60

/** Moodle でログアウトされたときにプラグインから届く通知 */
export async function backchannelLogout(c: C) {
  const secret = config.moodle!.backchannelSecret
  if (!secret) return c.notFound()
  const body = await c.req.text()
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  if (!sameString(expected, c.req.header('x-steplearn-signature') ?? '')) return c.notFound()
  const { sid, time } = JSON.parse(body) as { sid?: unknown; time?: unknown }
  // 古い通知を受け付けないのは、盗み見た通知を送り直されても、あとから始めたセッションを消させないため
  if (typeof sid !== 'string' || typeof time !== 'number' || Math.abs(Date.now() / 1000 - time) > BACKCHANNEL_MAX_AGE) return c.notFound()
  destroyByMoodleSid(sid)
  return c.body(null, 204)
}

/** STEP Learn にない画面（アカウント設定・管理・参加者・コースの設定）は、Moodle の同じ画面に移す */
export const toMoodle = (path: (c: C) => string | null) => (c: C) => {
  const target = path(c)
  return target ? c.redirect(moodleUrl(target)) : c.notFound()
}

// ---------------------------------------------------------------- ダッシュボード・コース一覧

export async function dashboard(c: C) {
  const user = c.var.user!
  const results: CourseCardData[] = (await myCourses(c)).map(toCard)
  return c.render(<DashboardPage name={user.name} canCreate={false} isAdmin={false} results={results} />, {
    title: 'ダッシュボード',
  })
}

export async function listCourses(c: C) {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const needle = q.toLowerCase()
  const isAdmin = c.var.user!.role === 'admin'
  const [mine, others] = await Promise.all([myCourses(c), isAdmin ? otherCourses(c) : []])
  const results = [...mine, ...others]
    .map(toCard)
    .filter((r) => !needle || [r.title, r.code, r.summary].some((s) => s.toLowerCase().includes(needle)))
  return c.render(<CoursesPage q={q} isAdmin={false} showsOthers={isAdmin} canCreate={false} results={results} />, { title: 'コース一覧' })
}

// ---------------------------------------------------------------- コースページ

export async function showCourse(c: C) {
  const id = intParam(c, 'id')
  if (!id) return c.notFound()
  const loaded = await loadCourse(c, id)
  // 待たないのは、閲覧の記録（Moodle の「最近のコース」など）が遅れても困らず、画面を待たせないため
  moodle(c)
    .viewCourse(id)
    .catch((e) => console.error('[moodle] view course', e))
  return c.render(
    <CoursePage
      access={loaded.access}
      sections={loaded.sections}
      items={loaded.items}
      layout={loaded.layout}
      openSection={Number(c.req.query('section')) || undefined}
      revision={await revisionOf(loaded)}
      moodleCourseUrl={moodleUrl(`/course/view.php?id=${id}`)}
    />,
    { title: loaded.access.course.title },
  )
}

export async function revision(c: C) {
  const id = intParam(c, 'id')
  if (!id) return c.notFound()
  return c.json({ revision: await revisionOf(await loadCourse(c, id)) })
}

// SVG を通さないのは、スクリプトを埋め込めるので同一オリジンで表示すると XSS になるため
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export async function courseImage(c: C) {
  const id = intParam(c, 'id')
  if (!id || c.req.param('kind') !== 'hero') return c.notFound()
  const { course } = await loadCourse(c, id)
  const res = course.imageurl ? await fetchFile(c.var.token!, course.imageurl) : null
  const type = res?.headers.get('content-type')?.split(';')[0] ?? ''
  if (!res?.ok || !IMAGE_TYPES.has(type)) return c.notFound()
  return new Response(res.body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  })
}

export async function tilePhoto(c: C) {
  const id = intParam(c, 'id')
  const sid = intParam(c, 'sid')
  if (!id || !sid) return c.notFound()
  const { layout, sections } = await loadCourse(c, id)
  const tile = layout.kind === 'tiles' ? layout.tiles.get(sid) : undefined
  if (!tile?.photoUrl || !sections.some((s) => s.id === sid)) return c.notFound()
  const res = await fetchFile(c.var.token!, tile.photoUrl)
  const type = res?.headers.get('content-type')?.split(';')[0] ?? ''
  if (!res?.ok || !IMAGE_TYPES.has(type)) return c.notFound()
  return new Response(res.body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  })
}

// ---------------------------------------------------------------- セクション

const sectionIds = (value: string) =>
  value
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)

// 表示だけの状態なのにクッキーで持たないのは、折りたたみ型トピックの開閉は Moodle にユーザーごとに記録され、旧STEP Learn の画面とそろえるため
export async function collapseSections(c: C) {
  const id = intParam(c, 'id')
  if (!id) return c.notFound()
  const loaded = await loadCourse(c, id)
  if (loaded.layout.kind !== 'topcoll' || !loaded.layout.persistent) return c.notFound()
  const form = await readForm(c)
  const known = new Set(loaded.sections.filter((s) => !s.parentId).map((s) => s.id))
  const opened = sectionIds(field(form, 'open', 2000)).filter((sid) => known.has(sid))
  const closed = sectionIds(field(form, 'closed', 2000)).filter((sid) => known.has(sid))
  if (opened.length) await moodle(c).setSectionsCollapsed(id, opened, false)
  if (closed.length) await moodle(c).setSectionsCollapsed(id, closed, true)
  forgetSections(id, c.var.user!.id)
  return c.body(null, 204)
}

const editUrl = (loaded: LoadedCourse, sectionId?: number) =>
  sectionId ? sectionHref(loaded.course.id, loaded.layout, loaded.sections, sectionId) : `/courses/${loaded.course.id}`

async function manageCourse(c: C) {
  const id = intParam(c, 'id')
  const loaded = id && (await loadCourse(c, id))
  return loaded && loaded.access.canManage ? loaded : null
}

const hiddenMessage = (title: string, hidden: boolean) => `「${title}」を${hidden ? '学生に非表示にしました' : '学生に表示しました'}。`

// トグルにせず値を送らせるのは、二重送信や古い画面からの送信で意図と逆の状態になるのを避けるため
const readHidden = async (c: C) => field(await readForm(c), 'hidden') === '1'

async function changeCourse(
  c: C,
  loaded: LoadedCourse,
  action: StateAction,
  ids: number[],
  target?: { sectionid?: number; cmid?: number },
) {
  await moodle(c).updateCourse(loaded.course.id, action, ids, target)
  forgetCourse(loaded.course.id)
}

export async function createSection(c: C) {
  const loaded = await manageCourse(c)
  if (!loaded) return c.notFound()
  const id = loaded.course.id
  const result = validate('section', await readForm(c))
  if (!result.ok) return redirectWith(c, editUrl(loaded), firstError(result.errors), 'error')
  const sid = await moodle(c).createSection(id, result.values.title)
  forgetCourse(id)
  return redirectWith(c, editUrl(loaded, sid), 'セクションを追加しました。')
}

const topSections = (loaded: LoadedCourse) => loaded.sections.filter((s) => !s.parentId)

// サブセクションの中身のセクションを対象にしないのは、Moodle ではサブセクションの活動と一緒に動かしたり消したりするもので、単独で操作すると壊れるため
const findSection = (loaded: LoadedCourse, c: C) => {
  const sid = intParam(c, 'sid')
  return topSections(loaded).find((s) => s.id === sid)
}

export async function updateSection(c: C) {
  const loaded = await manageCourse(c)
  const section = loaded && findSection(loaded, c)
  if (!loaded || !section) return c.notFound()
  const id = loaded.course.id
  const result = validate('section', await readForm(c))
  if (!result.ok) return redirectWith(c, editUrl(loaded, section.id), firstError(result.errors), 'error')
  await moodle(c).updateSection(id, section.id, result.values.title, result.values.summary ?? '')
  forgetCourse(id)
  return redirectWith(c, editUrl(loaded, section.id), 'セクションを更新しました。')
}

export async function moveSection(c: C) {
  const loaded = await manageCourse(c)
  const section = loaded && findSection(loaded, c)
  if (!loaded || !section || section.number === 0) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  const list = topSections(loaded)
  const i = list.findIndex((s) => s.id === section.id)
  // Moodle は「このセクションの後ろへ」しか指定できないので、上へは 2 つ前の後ろに置く。一般（0 番）より前には置けない
  const after = dir === 'up' ? list[i - 2] : list[i + 1]
  if (after) await changeCourse(c, loaded, 'section_move_after', [section.id], { sectionid: after.id })
  return c.redirect(editUrl(loaded, section.id), 303)
}

export async function setSectionHidden(c: C) {
  const loaded = await manageCourse(c)
  const section = loaded && findSection(loaded, c)
  if (!loaded || !section || section.number === 0) return c.notFound()
  const hidden = await readHidden(c)
  await changeCourse(c, loaded, hidden ? 'section_hide' : 'section_show', [section.id])
  return redirectWith(c, editUrl(loaded, section.id), hiddenMessage(section.title, hidden), 'info')
}

export async function removeSection(c: C) {
  const loaded = await manageCourse(c)
  const section = loaded && findSection(loaded, c)
  if (!loaded || !section || section.number === 0) return c.notFound()
  await changeCourse(c, loaded, 'section_delete', [section.id])
  return redirectWith(c, editUrl(loaded), 'セクションを削除しました。', 'info')
}

// ---------------------------------------------------------------- アイテム

const findItem = (loaded: LoadedCourse, c: C) => {
  const iid = intParam(c, 'iid')
  return loaded.items.find((it) => it.id === iid)
}

async function checkUpload(file: File | null) {
  if (!file) return null
  if (file.size > MAX_FILE_SIZE) return FILE_TOO_LARGE
  if (await isExecutable(file)) return EXECUTABLE_NOT_ALLOWED
  return null
}

const PLAY_NOT_SUPPORTED = '「最後まで再生したら完了」は使えません。'

export async function createItem(c: C) {
  const loaded = await manageCourse(c)
  if (!loaded) return c.notFound()
  const id = loaded.course.id
  const form = await readForm(c)
  const sectionId = Number(field(form, 'section_id'))
  if (!loaded.sections.some((s) => s.id === sectionId)) return c.notFound()
  const result = validate('item', form)
  if (!result.ok) return redirectWith(c, editUrl(loaded, sectionId), firstError(result.errors), 'error')
  const { type, hidden, title, url } = result.values
  if (type !== 'link' && type !== 'file') return c.notFound()
  const completion = loaded.course.completionenabled ? (result.values.completion ?? 'none') : 'none'
  if (completion === 'play') return redirectWith(c, editUrl(loaded, sectionId), PLAY_NOT_SUPPORTED, 'error')
  const target = { courseid: id, cmid: 0, sectionid: sectionId, name: title, completion, visible: !hidden }

  let cmid: number
  if (type === 'link') {
    cmid = await moodle(c).saveUrl({ ...target, externalurl: url })
  } else {
    const file = isFile(result.values.file) ? result.values.file : null
    const uploadError = await checkUpload(file)
    if (uploadError || !file) return redirectWith(c, editUrl(loaded, sectionId), uploadError ?? 'ファイルを選択してください。', 'error')
    cmid = await moodle(c).saveResource({ ...target, draftitemid: await uploadDraft(c.var.token!, file) })
  }
  forgetCourse(id)
  const next = field(form, 'then') === 'view' ? `/courses/${id}/items/${cmid}` : editUrl(loaded, sectionId)
  return redirectWith(c, next, `「${title}」を追加しました。`)
}

const editable = (it: MItem | null | undefined): it is MItem & { kind: 'link' | 'file' } => it?.kind === 'link' || it?.kind === 'file'

export async function editItem(c: C) {
  const loaded = await manageCourse(c)
  const item = loaded && findItem(loaded, c)
  if (!loaded || !editable(item)) return c.notFound()
  return c.render(<ItemEditPage access={loaded.access} item={item} sections={loaded.sections} layout={loaded.layout} />, {
    title: `編集 - ${item.title}`,
  })
}

export async function updateItem(c: C) {
  const loaded = await manageCourse(c)
  const item = loaded && findItem(loaded, c)
  if (!loaded || !editable(item)) return c.notFound()
  const id = loaded.course.id
  const form = await readForm(c)
  const requestedSection = Number(field(form, 'section_id'))
  const sectionId = loaded.sections.some((s) => s.id === requestedSection) ? requestedSection : item.sectionId
  // 送られてきた種類を使わないのは、画面の隠し欄は書き換えられ、保存済みのアイテムの種類と違うかもしれないため
  const result = validate('itemEdit', { ...form, type: item.kind })
  const file = result.ok && item.kind === 'file' && isFile(result.values.file) ? result.values.file : null
  const fileError = await checkUpload(file)
  const playError = result.ok && result.values.completion === 'play' ? PLAY_NOT_SUPPORTED : null
  if (!result.ok || fileError || playError) {
    const errors = result.ok ? { ...(fileError && { file: fileError }), ...(playError && { completion: playError }) } : result.errors
    c.status(422)
    return c.render(
      <ItemEditPage
        access={loaded.access}
        item={item}
        sections={loaded.sections}
        layout={loaded.layout}
        values={{
          title: field(form, 'title', 200),
          url: field(form, 'url', 2000),
          hidden: field(form, 'hidden') === '1' ? 1 : 0,
          sectionId,
          completion: field(form, 'completion', 10),
        }}
        errors={errors}
      />,
      { title: `編集 - ${item.title}` },
    )
  }
  const { title, url, hidden } = result.values
  // Moodle の画面で決めた条件や、完了ステータスを使わないコースの設定を上書きしないよう、変えないときは keep を送る
  const completion = !loaded.course.completionenabled || item.completion === 'auto' ? 'keep' : (result.values.completion ?? 'keep')
  const target = { courseid: id, cmid: item.id, sectionid: item.sectionId, name: title, completion, visible: !hidden }
  if (item.kind === 'link') await moodle(c).saveUrl({ ...target, externalurl: url ?? item.url })
  else await moodle(c).saveResource({ ...target, draftitemid: file ? await uploadDraft(c.var.token!, file) : 0 })
  if (!!hidden !== item.hidden) await moodle(c).updateCourse(id, hidden ? 'cm_hide' : 'cm_show', [item.id])
  if (sectionId !== item.sectionId) await moodle(c).updateCourse(id, 'cm_move', [item.id], { sectionid: sectionId })
  forgetCourse(id)
  return redirectWith(c, `/courses/${id}/items/${item.id}/edit`, '保存しました。')
}

export async function moveItem(c: C) {
  const loaded = await manageCourse(c)
  const item = loaded && findItem(loaded, c)
  if (!loaded || !item) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  const list = loaded.items.filter((it) => it.sectionId === item.sectionId)
  const i = list.findIndex((it) => it.id === item.id)
  // Moodle は「この活動の前へ」しか指定できないので、下へは 2 つ後ろの前に置き、末尾ならセクションの最後に置く
  const before = dir === 'up' ? list[i - 1] : list[i + 2]
  const moves = dir === 'up' ? i > 0 : i < list.length - 1
  if (moves) await changeCourse(c, loaded, 'cm_move', [item.id], before ? { cmid: before.id } : { sectionid: item.sectionId })
  return c.redirect(editUrl(loaded, item.sectionId), 303)
}

export async function setItemHidden(c: C) {
  const loaded = await manageCourse(c)
  const item = loaded && findItem(loaded, c)
  if (!loaded || !item) return c.notFound()
  const hidden = await readHidden(c)
  // サブセクションに cm_hide を使わないのは、Moodle 5.1 では表示の更新を返すときにセクション ID を取り違えて失敗するため。Moodle の画面と同じく中身のセクションを切り替える
  if (item.childSectionId) await changeCourse(c, loaded, hidden ? 'section_hide' : 'section_show', [item.childSectionId])
  else await changeCourse(c, loaded, hidden ? 'cm_hide' : 'cm_show', [item.id])
  return redirectWith(c, editUrl(loaded, item.sectionId), hiddenMessage(item.title, hidden), 'info')
}

export async function removeItem(c: C) {
  const loaded = await manageCourse(c)
  const item = loaded && findItem(loaded, c)
  if (!loaded || !item) return c.notFound()
  await changeCourse(c, loaded, 'cm_delete', [item.id])
  return redirectWith(c, editUrl(loaded, item.sectionId), `「${item.title}」を削除しました。`, 'info')
}

/** 学生に見えるアイテムだけを返す（教師にはすべて）。ラベルとアクセス制限中のものは開く画面がないので除く */
async function viewableItem(c: C) {
  const id = intParam(c, 'id')
  const loaded = id && (await loadCourse(c, id))
  const item = loaded && findItem(loaded, c)
  if (!loaded || !item || item.locked || !isOpenable(item)) return null
  return outlineOf(loaded).some((o) => o.id === item.id) ? { loaded, item } : null
}

async function readTextPreview(token: string, fileUrl: string) {
  const res = await fetchFile(token, fileUrl, `bytes=0-${TEXT_PREVIEW_MAX - 1}`)
  if (!res?.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer()).subarray(0, TEXT_PREVIEW_MAX)
  if (bytes.includes(0)) return null
  // stream を付けるのは、上限で切れた末尾の文字の途中を化けた文字として出さないため
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
  } catch {
    // UTF-8 でないものは、Excel が書き出す CSV などの Shift_JIS とみなす
    return new TextDecoder('shift_jis').decode(bytes, { stream: true })
  }
}

export async function showItem(c: C) {
  const found = await viewableItem(c)
  if (!found) return c.notFound()
  const { loaded, item } = found
  const outline = outlineOf(loaded)
  const navigable = outline.filter((o) => !o.locked && (loaded.access.canManage || !o.hidden))
  const idx = navigable.findIndex((o) => o.id === item.id)
  const textPreview =
    item.kind === 'file' && item.fileSize && previewKind(item.fileType, item.fileName) === 'text'
      ? await readTextPreview(c.var.token!, item.fileUrl)
      : null
  return c.render(
    <ItemPage
      access={loaded.access}
      item={item}
      section={loaded.sections.find((s) => s.id === item.sectionId)}
      sections={loaded.sections}
      layout={loaded.layout}
      outline={outline}
      prev={navigable[idx - 1]}
      next={navigable[idx + 1]}
      textPreview={textPreview}
      revision={await revisionOf(loaded)}
    />,
    { title: item.title },
  )
}

export async function toggleComplete(c: C) {
  const found = await viewableItem(c)
  if (!found) return c.notFound()
  const { loaded, item } = found
  if (loaded.access.role !== 'student' || !loaded.course.completionenabled) return c.notFound()
  const on = field(await readForm(c), 'on', 10)
  // 自動の完了で on（開いた）を送らせるのは、手動の切り替えと取り違えて、自動で付いた完了を未完了に戻さないため
  if (on === 'view' && item.completion === 'view') {
    if (item.kind === 'link') await moodle(c).viewUrl(item.instance)
    else if (item.kind === 'file') await moodle(c).viewResource(item.instance)
    else return c.notFound()
  } else if (!on && item.completion === 'manual') {
    await moodle(c).setManualCompletion(item.id, !item.done)
  } else {
    return c.notFound()
  }
  const id = loaded.course.id
  forgetProgress(id, c.var.user!.id)
  if (wantsJson(c)) {
    const fresh = await loadCourse(c, id)
    const completed = fresh.items.find((it) => it.id === item.id)?.done ?? false
    return c.json({ completed, ...progressOf(fresh) })
  }
  return c.redirect(c.req.header('referer') ?? `/courses/${id}`, 303)
}

const disposition = (filename: string, inline: boolean) =>
  `${inline ? 'inline' : 'attachment'};filename*=UTF-8''${encodeURIComponent(filename)}`

export async function downloadFile(c: C) {
  const found = await viewableItem(c)
  if (!found || found.item.kind !== 'file') return c.notFound()
  const { item } = found
  const res = await fetchFile(c.var.token!, item.fileUrl, c.req.header('range'))
  if (!res || (!res.ok && res.status !== 416)) return c.notFound()
  const preview = c.req.query('inline') === '1' ? previewKind(item.fileType, item.fileName) : null
  // テキストをインラインで返さないのは、HTML や SVG として同一オリジンで描かせないため（プレビューはサーバーで読んで埋め込む）
  const inline = !!preview && preview !== 'text'
  const headers = new Headers({
    'Content-Type': inline ? item.fileType : 'application/octet-stream',
    'Content-Disposition': disposition(item.fileName, inline),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
  })
  // PDF ビューアは sandbox CSP 下で表示されないため、sandbox は添付のときだけ
  if (!inline) headers.set('Content-Security-Policy', 'sandbox')
  for (const name of ['content-length', 'content-range']) {
    const value = res.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(res.body, { status: res.status, headers })
}
