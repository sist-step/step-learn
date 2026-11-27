import { and, eq, inArray } from 'drizzle-orm'
import fs from 'node:fs'
import { styleText } from 'node:util'
import { NO_PASSWORD } from '../lib/auth'
import { formatBytes } from '../lib/bytes'
import { unixToDateTimeInput } from '../lib/course-period'
import { db } from '../lib/db'
import { courses, enrollments, folderFiles, folderItems, items, publicationFiles, publicationItems, sections, users } from '../lib/schema'
import { PUBLICATION_STATE_LABELS, publicationStateOf } from '../features/publication/publication'
import { type StoredFile, deleteCourseFiles, isExecutable, putCourseFile } from '../lib/storage'
import { COMPLETION_LABELS, COURSE_ROLE_LABELS, ITEM_TYPE_LABELS, LINK_TARGET_LABELS, type ItemType } from '../lib/types'
import {
  type Backup,
  type BackupFolder,
  type BackupFolderFile,
  type BackupItem,
  type BackupParticipant,
  type BackupPublication,
  type BackupPublicationFile,
  type BackupSection,
  backupItems,
  moduleLabel,
} from './backup'

type PlannedParticipant = BackupParticipant & {
  existingId: number | null
  /** 新規ユーザーに設定するユーザー名。設定しないなら null */
  newUsername: string | null
  usernameNote: string | null
}

export type Plan = { backup: Backup; participants: PlannedParticipant[]; duplicateCourseId: number | null }

const openFile = async (f: NonNullable<BackupItem['file']>) =>
  new File([await fs.openAsBlob(f.path, { type: f.type })], f.name, { type: f.type })

/** 取り込み先の DB と突き合わせ、既存のユーザーや使われているユーザー名を調べる。DB には書き込まない */
export async function planImport(backup: Backup): Promise<Plan> {
  for (const item of backup.sections.flatMap(backupItems)) {
    if (item.type === 'file' && item.file && (await isExecutable(await openFile(item.file)))) {
      item.type = null
      item.notes.push('実行ファイル（.exe など）は保存できないため取り込みません')
    }
    if (item.publication) {
      const kept: typeof item.publication.files = []
      for (const f of item.publication.files) if (!(await isExecutable(await openFile(f.file)))) kept.push(f)
      if (kept.length < item.publication.files.length)
        item.notes.push(`実行ファイル（.exe など）${item.publication.files.length - kept.length} 個は保存できないため取り込みません`)
      item.publication.files = kept
    }
    if (item.folder) {
      const kept: BackupFolderFile[] = []
      for (const f of item.folder.files) if (!(await isExecutable(await openFile(f.file)))) kept.push(f)
      if (kept.length < item.folder.files.length)
        item.notes.push(`実行ファイル（.exe など）${item.folder.files.length - kept.length} 個は保存できないため取り込みません`)
      item.folder.files = kept
    }
  }

  const active = backup.participants.filter((p) => !p.skip)
  const emails = active.map((p) => p.email)
  const existing = new Map(
    emails.length
      ? db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.email, emails))
          .all()
          .map((u) => [u.email.toLowerCase(), u.id])
      : [],
  )
  const wanted = active.filter((p) => !existing.has(p.email) && p.username).map((p) => p.username)
  const taken = new Set(
    wanted.length
      ? db
          .select({ username: users.username })
          .from(users)
          .where(inArray(users.username, wanted))
          .all()
          .map((u) => u.username?.toLowerCase())
      : [],
  )

  const participants = backup.participants.map((p): PlannedParticipant => {
    const existingId = p.skip ? null : (existing.get(p.email) ?? null)
    if (p.skip || existingId) return { ...p, existingId, newUsername: null, usernameNote: null }
    if (!p.username)
      return { ...p, existingId, newUsername: null, usernameNote: `Moodle のユーザー名（${p.moodleUsername}）が規則に合わないため未設定` }
    if (taken.has(p.username))
      return { ...p, existingId, newUsername: null, usernameNote: `ユーザー名 ${p.username} は使われているため未設定` }
    taken.add(p.username)
    return { ...p, existingId, newUsername: p.username, usernameNote: null }
  })

  const duplicate = db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.title, backup.course.title), eq(courses.code, backup.course.code)))
    .get()

  return { backup, participants, duplicateCourseId: duplicate?.id ?? null }
}

// ---------------------------------------------------------------- プレビュー

// 文字数で揃えないのは、全角文字が 2 桁分の幅になり、日本語のタイトルで列がずれるため
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
const width = (s: string) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0)

/** 改行やタブで行を偽れないよう、1 行に収める */
const line = (s: string) => s.replace(/\s+/g, ' ')

/** 表示幅 w に収まるよう切り詰め、空白で埋める（最後の 1 桁は列の区切りとして空ける） */
function fit(text: string, w: number) {
  const s = line(text)
  if (width(s) < w) return s + ' '.repeat(w - width(s))
  let out = ''
  for (const ch of s) {
    if (width(out + ch) > w - 2) break
    out += ch
  }
  return `${out}…${' '.repeat(w - width(out) - 1)}`
}

const dim = (s: string) => styleText('dim', s)
const bold = (s: string) => styleText('bold', s)
const warn = (s: string) => styleText('yellow', s)
const ng = (s: string) => styleText('red', s)
const ok = (s: string) => styleText('green', s)

const count = <T>(list: T[], key: (t: T) => string) =>
  [...list.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].map(([k, n]) => `${k} ${n}`).join('・')

export const PARTICIPANT_LIMIT = 20

const NATIVE_MODULE: Record<ItemType, string> = {
  page: 'page',
  link: 'url',
  file: 'resource',
  presentation: '',
  screen: '',
  code: '',
  bundle: '',
  agent: '',
  quiz: '',
  collab: '',
  publication: 'publication',
  folder: 'folder',
}

function folderSummary({ settings, files }: BackupFolder) {
  const parts = [
    files.length ? `ファイル ${files.length}・${formatBytes(files.reduce((n, f) => n + f.file.size, 0))}` : 'ファイルなし',
    settings.showInline ? 'コースのページに表示' : '',
    settings.showExpanded ? '' : 'サブフォルダーを閉じる',
    settings.showDownload ? '' : 'まとめてダウンロードなし',
    settings.forceDownload ? '押したらダウンロード' : '',
  ]
  return parts.filter(Boolean).join('・')
}

function publicationSummary({ settings, files }: BackupPublication) {
  const states = count(files, (f) => PUBLICATION_STATE_LABELS[publicationStateOf(settings, f.status)])
  const size = files.reduce((n, f) => n + f.file.size, 0)
  const when = (unix: number | null) => (unix ? unixToDateTimeInput(unix).replace('T', ' ') : '')
  const parts = [
    settings.approval ? '承認してから公開' : 'すぐに公開',
    settings.showNames ? '' : '名前を見せない',
    settings.opensAt || settings.closesAt ? `提出 ${when(settings.opensAt)}〜${when(settings.closesAt)}` : '',
    files.length ? `学生のファイル ${files.length}（${states}）${formatBytes(size)}` : '学生のファイルなし',
  ]
  return parts.filter(Boolean).join('・')
}

/** source はプレビューの見出しに出す取り込み元（ファイル名やコースの URL） */
export function printPreview(plan: Plan, source: string, { verbose = false } = {}) {
  const { backup, participants } = plan
  const { course } = backup
  const all = backup.sections.flatMap(backupItems)
  const imported = all.filter((i) => i.type)
  const subsections = backup.sections.flatMap((s) => s.items.filter((i) => i.subsection)).length
  const skipped = all.filter((i) => !i.type)
  const fileBytes = imported.reduce(
    (n, i) =>
      n +
      (i.file?.size ?? 0) +
      (i.publication?.files.reduce((m, f) => m + f.file.size, 0) ?? 0) +
      (i.folder?.files.reduce((m, f) => m + f.file.size, 0) ?? 0),
    0,
  )
  const joining = participants.filter((p) => !p.skip)
  const out: string[] = []

  out.push(bold(`Moodle からの取り込みのプレビュー`) + dim(`（${source}${backup.release ? `、Moodle ${backup.release}` : ''}）`), '')
  out.push(`  コース名      ${bold(line(course.title))}${course.code ? dim(`（${line(course.code)}）`) : ''}`)
  out.push(`  公開          ${course.visible ? 'する' : warn('しない（Moodle で非表示）')}`)
  out.push(`  完了の記録    ${course.completionEnabled ? '使う' : '使わない'}`)
  if (course.summary) out.push(`  概要          ${fit(course.summary, 60).trimEnd()}`)
  out.push('')
  out.push(
    `  セクション ${backup.sections.length}${subsections ? `・サブセクション ${subsections}` : ''}・アイテム ${imported.length}` +
      (imported.length ? dim(`（${count(imported, (i) => ITEM_TYPE_LABELS[i.type!])}）`) : '') +
      (fileBytes ? `・ファイル合計 ${formatBytes(fileBytes)}` : ''),
  )
  if (skipped.length)
    out.push(warn(`  取り込まないアクティビティ ${skipped.length}`) + dim(`（${count(skipped, (i) => moduleLabel(i.module))}）`))
  const breakdown = `${count(joining, (p) => COURSE_ROLE_LABELS[p.role])}。新規 ${joining.filter((p) => !p.existingId).length}・既存 ${joining.filter((p) => p.existingId).length}`
  out.push(
    `  参加者 ${joining.length} 人` +
      (joining.length ? dim(`（${breakdown}）`) : '') +
      (participants.length > joining.length ? warn(`・取り込まない ${participants.length - joining.length} 人`) : ''),
  )

  backup.sections.forEach((s, i) => {
    out.push(
      '',
      bold(`■ ${i + 1}. ${line(s.title)}`) + (s.hidden ? warn(' [学生に非表示]') : '') + (s.items.length ? '' : dim('  （アイテムなし）')),
    )
    if (s.summary) out.push(dim(`    ${fit(s.summary, 70).trimEnd()}`))
    for (const note of s.notes) out.push(warn(`      ↳ ${note}`))
    const printItem = (item: BackupItem, indent: string) => {
      if (!item.type) {
        out.push(ng(`${indent}× ${fit(moduleLabel(item.module), 14)}`) + dim(`${fit(item.title, 36)}${item.notes.join('。')}`))
        return
      }
      const extra = [
        item.type === 'file' && item.file ? formatBytes(item.file.size) : '',
        item.type === 'link' ? `${line(item.url)}（${LINK_TARGET_LABELS[item.linkTarget]}）` : '',
        item.publication ? publicationSummary(item.publication) : '',
        item.folder ? folderSummary(item.folder) : '',
        item.completion !== 'none' ? `完了: ${COMPLETION_LABELS[item.completion]}` : '',
        item.hidden ? warn('学生に非表示') : '',
      ].filter(Boolean)
      const from = item.module !== NATIVE_MODULE[item.type] ? dim(`←${moduleLabel(item.module)} `) : ''
      out.push(`${indent}  ${fit(ITEM_TYPE_LABELS[item.type], 14)}${fit(item.title, 36)}${from}${dim(extra.join('  '))}`)
      for (const note of item.notes) out.push(warn(`${indent}    ↳ ${note}`))
    }
    for (const item of s.items) {
      const sub = item.subsection
      if (!sub) {
        printItem(item, '  ')
        continue
      }
      out.push(
        `  ${bold(`▸ サブセクション「${line(sub.title)}」`)}` +
          (sub.hidden ? warn(' [学生に非表示]') : '') +
          (sub.items.length ? '' : dim('  （アイテムなし）')),
      )
      if (sub.summary) out.push(dim(`      ${fit(sub.summary, 66).trimEnd()}`))
      for (const note of sub.notes) out.push(warn(`        ↳ ${note}`))
      for (const child of sub.items) printItem(child, '    ')
    }
  })

  if (participants.length) {
    out.push('', bold('■ 参加者'))
    const shown = (role: 'teacher' | 'student') => {
      const list = joining.filter((p) => p.role === role)
      const limit = verbose || role === 'teacher' ? list.length : PARTICIPANT_LIMIT
      for (const p of list.slice(0, limit)) {
        const account = p.existingId ? dim('既存のユーザーに追加') : ok('新規作成') + (p.newUsername ? dim(` @${p.newUsername}`) : '')
        out.push(`    ${fit(COURSE_ROLE_LABELS[p.role], 6)}${fit(p.name, 20)}${fit(p.email, 34)}${account}`)
        if (p.usernameNote) out.push(warn(`      ↳ ${line(p.usernameNote)}（ログイン後にアカウント画面で設定できます）`))
      }
      if (list.length > limit) out.push(dim(`    ほか ${list.length - limit} 人（--verbose ですべて表示）`))
    }
    shown('teacher')
    shown('student')
    for (const p of participants.filter((p) => p.skip))
      out.push(ng(`  × ${fit(COURSE_ROLE_LABELS[p.role], 6)}`) + dim(`${fit(p.name, 20)}${fit(p.email || p.moodleUsername, 34)}${p.skip}`))
  }

  const warnings = [...backup.warnings]
  if (plan.duplicateCourseId)
    warnings.push(
      `同じコース名とコースコードのコースがすでにあります（/courses/${plan.duplicateCourseId}）。二重に取り込んでいないか確かめてください`,
    )
  if (joining.some((p) => !p.existingId))
    warnings.push(
      '新しく作るユーザーにはパスワードがありません。ログイン画面の「パスワードを忘れた場合」から各自で設定してもらってください',
    )
  if (warnings.length) out.push('', bold('■ 注意'), ...warnings.map((w) => warn(`  ! ${w}`)))

  console.log(out.join('\n') + '\n')
}

// ---------------------------------------------------------------- 書き込み

type ImportResult = {
  courseId: number
  sections: number
  subsections: number
  items: number
  createdUsers: number
  enrolled: number
  studentFiles: number
}

export async function runImport(plan: Plan, progress: (message: string) => void): Promise<ImportResult> {
  const { backup } = plan
  const { id: courseId } = db
    .insert(courses)
    .values({
      title: backup.course.title,
      code: backup.course.code,
      summary: backup.course.summary,
      visible: backup.course.visible ? 1 : 0,
      completionEnabled: backup.course.completionEnabled ? 1 : 0,
    })
    .returning({ id: courses.id })
    .get()

  try {
    const all = backup.sections.flatMap(backupItems).filter((i) => i.type)
    const fileItems = all.filter((i) => i.type === 'file' && i.file)
    const studentFiles = all.flatMap((i) => i.publication?.files ?? [])
    const folderContents = all.flatMap((i) => i.folder?.files ?? [])
    const stored = new Map<BackupItem | BackupPublicationFile | BackupFolderFile, StoredFile>()
    for (const [n, item] of fileItems.entries()) {
      progress(`ファイルを保存しています（${n + 1}/${fileItems.length}）${item.file!.name}`)
      stored.set(item, await putCourseFile(courseId, await openFile(item.file!)))
    }
    for (const [n, f] of studentFiles.entries()) {
      progress(`学生フォルダのファイルを保存しています（${n + 1}/${studentFiles.length}）${f.file.name}`)
      stored.set(f, await putCourseFile(courseId, await openFile(f.file)))
    }
    for (const [n, f] of folderContents.entries()) {
      progress(`フォルダーのファイルを保存しています（${n + 1}/${folderContents.length}）${f.path}`)
      stored.set(f, await putCourseFile(courseId, await openFile(f.file)))
    }

    return db.transaction((tx) => {
      const result: ImportResult = { courseId, sections: 0, subsections: 0, items: 0, createdUsers: 0, enrolled: 0, studentFiles: 0 }
      // アイテムより先に参加者を作るのは、学生フォルダのファイルに持ち主の ID が要るため
      const userIdOf = enrollParticipants(tx, plan, courseId, result)
      const insertSection = (s: BackupSection, position: number, parentId: number | null) => {
        const { id: sectionId } = tx
          .insert(sections)
          .values({ courseId, parentId, title: s.title, summary: s.summary, hidden: s.hidden ? 1 : 0, position })
          .returning({ id: sections.id })
          .get()
        if (parentId) result.subsections++
        else result.sections++
        for (const [n, item] of s.items.filter((i) => i.type || (i.subsection && !parentId)).entries()) {
          if (item.subsection) {
            insertSection(item.subsection, n + 1, sectionId)
            continue
          }
          const file = stored.get(item)
          const { id: itemId } = tx
            .insert(items)
            .values({
              courseId,
              sectionId,
              type: item.type!,
              title: item.title,
              body: item.body,
              url: item.url,
              linkTarget: item.linkTarget,
              hidden: item.hidden ? 1 : 0,
              completion: item.completion,
              position: n + 1,
              ...(file && { fileKey: file.key, fileName: file.name, fileSize: file.size, fileType: file.type }),
            })
            .returning({ id: items.id })
            .get()
          result.items++
          if (item.publication) result.studentFiles += insertPublication(tx, itemId, item.publication, userIdOf, stored)
          if (item.folder) insertFolder(tx, itemId, item.folder, stored)
        }
      }
      for (const [sn, s] of backup.sections.entries()) insertSection(s, sn + 1, null)
      return result
    })
  } catch (err) {
    db.delete(courses).where(eq(courses.id, courseId)).run()
    await deleteCourseFiles(courseId).catch((e) => console.error('[moodle] 保存したファイルを消せませんでした', e))
    throw err
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** 参加者を作ってコースに登録する。返すのは、Moodle のユーザーの ID から STEP Learn のユーザーの ID への対応 */
function enrollParticipants(tx: Tx, plan: Plan, courseId: number, result: ImportResult) {
  const userIdOf = new Map<string, number>()
  for (const p of plan.participants.filter((p) => !p.skip)) {
    let userId = p.existingId
    if (!userId) {
      // 事前の確認だけに頼らないのは、プレビューのあとに同じメールアドレスで登録されると UNIQUE 制約違反になるため
      userId =
        tx
          .insert(users)
          .values({ email: p.email, name: p.name, username: p.newUsername, passwordHash: NO_PASSWORD, role: p.role })
          .onConflictDoNothing()
          .returning({ id: users.id })
          .get()?.id ?? null
      if (userId) result.createdUsers++
      else userId = tx.select({ id: users.id }).from(users).where(eq(users.email, p.email)).get()?.id ?? null
    }
    if (!userId) continue
    userIdOf.set(p.moodleId, userId)
    const res = tx.insert(enrollments).values({ courseId, userId, role: p.role }).onConflictDoNothing().run()
    result.enrolled += res.changes
  }
  return userIdOf
}

/** 学生フォルダの設定と学生のファイルを足す。足したファイルの数 */
function insertPublication(
  tx: Tx,
  itemId: number,
  publication: BackupPublication,
  userIdOf: Map<string, number>,
  stored: ReadonlyMap<BackupItem | BackupPublicationFile | BackupFolderFile, StoredFile>,
) {
  tx.insert(publicationItems)
    .values({ itemId, ...publication.settings })
    .run()
  const rows = publication.files.flatMap((f) => {
    const userId = userIdOf.get(f.moodleUserId)
    const file = stored.get(f)
    return userId && file
      ? [
          {
            itemId,
            userId,
            fileKey: file.key,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            status: f.status,
            createdAt: f.createdAt || undefined,
          },
        ]
      : []
  })
  if (rows.length) tx.insert(publicationFiles).values(rows).run()
  return rows.length
}

/** フォルダーの設定と置いたファイルを足す */
function insertFolder(
  tx: Tx,
  itemId: number,
  folder: BackupFolder,
  stored: ReadonlyMap<BackupItem | BackupPublicationFile | BackupFolderFile, StoredFile>,
) {
  tx.insert(folderItems)
    .values({ itemId, ...folder.settings })
    .run()
  const rows = folder.files.flatMap((f) => {
    const file = stored.get(f)
    return file ? [{ itemId, path: f.path, fileKey: file.key, fileSize: file.size, fileType: file.type }] : []
  })
  if (rows.length) tx.insert(folderFiles).values(rows).run()
}
