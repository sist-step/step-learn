import fs from 'node:fs'
import path from 'node:path'
import { isEmail } from '../lib/forms'
import { LINK_TARGET_LABELS, type Completion, type CourseRole, type ItemType, type LinkTarget } from '../lib/types'
import { checkUsername, normalizeUsername } from '../lib/username'
import { MOODLE_DISPLAY_LABELS, isExactDisplay, linkTargetOf, moodleDisplayOf } from './display'
import { toMarkdown, toPlainText } from './html'
import { type XmlNode, at, childrenOf, numberAt, parseXml, textAt } from './xml'

export type BackupFile = { path: string; name: string; size: number; type: string }

export type BackupItem = {
  module: string
  type: ItemType | null
  title: string
  body: string
  url: string
  linkTarget: LinkTarget
  file: BackupFile | null
  hidden: boolean
  completion: Completion
  /** 取り込まない理由や、変換で失われるもの */
  notes: string[]
}

export type BackupSection = { title: string; summary: string; hidden: boolean; items: BackupItem[]; notes: string[] }

export type BackupParticipant = {
  moodleUsername: string
  name: string
  email: string
  /** ユーザー名の規則に合わなければ空 */
  username: string
  role: CourseRole
  skip: string | null
}

export type Backup = {
  release: string
  course: { title: string; code: string; summary: string; visible: boolean; completionEnabled: boolean }
  sections: BackupSection[]
  usersIncluded: boolean
  participants: BackupParticipant[]
  warnings: string[]
}

export const MODULE_LABELS: Record<string, string> = {
  page: 'ページ',
  url: 'URL',
  resource: 'ファイル',
  folder: 'フォルダ',
  label: 'ラベル',
  book: 'ブック',
  assign: '課題',
  quiz: '小テスト',
  forum: 'フォーラム',
  choice: '投票',
  feedback: 'フィードバック',
  glossary: '用語集',
  lesson: 'レッスン',
  lti: '外部ツール',
  scorm: 'SCORM',
  workshop: 'ワークショップ',
  wiki: 'Wiki',
  h5pactivity: 'H5P',
  data: 'データベース',
  chat: 'チャット',
  survey: '調査',
  imscp: 'IMS コンテンツパッケージ',
  bigbluebuttonbn: 'BigBlueButton',
  qbank: '問題バンク',
  subsection: 'サブセクション',
}

export const moduleLabel = (module: string) => MODULE_LABELS[module] ?? module

const TEACHER_ARCHETYPES = new Set(['editingteacher', 'teacher', 'manager'])

const LIMITS = { courseTitle: 120, courseCode: 30, summary: 2000, sectionTitle: 120, itemTitle: 200, body: 100_000, url: 2000, name: 60 }

function cut(text: string, max: number, notes: string[], label: string) {
  if (text.length <= max) return text
  notes.push(`${label}が長すぎるため、${max}文字で切ります`)
  return text.slice(0, max)
}

function readXml(dir: string, file: string) {
  const p = path.join(dir, file)
  return fs.existsSync(p) ? parseXml(fs.readFileSync(p, 'utf8')) : undefined
}

type FileRow = { hash: string; name: string; size: number; type: string; sortorder: number }

function indexFiles(dir: string) {
  const byArea = new Map<string, FileRow[]>()
  for (const f of childrenOf(at(readXml(dir, 'files.xml'), 'files'), 'file')) {
    const name = textAt(f, 'filename')
    const hash = textAt(f, 'contenthash')
    if (name === '.' || !hash) continue
    const key = `${textAt(f, 'contextid')}/${textAt(f, 'component')}/${textAt(f, 'filearea')}`
    const row = { hash, name, size: numberAt(f, 'filesize'), type: textAt(f, 'mimetype'), sortorder: numberAt(f, 'sortorder') }
    byArea.set(key, [...(byArea.get(key) ?? []), row])
  }
  return (contextId: string, component: string, filearea: string) => byArea.get(`${contextId}/${component}/${filearea}`) ?? []
}

function toBackupFile(dir: string, row: FileRow): BackupFile | null {
  const p = path.join(dir, 'files', row.hash.slice(0, 2), row.hash)
  if (!fs.existsSync(p)) return null
  return { path: p, name: row.name, size: fs.statSync(p).size, type: row.type || 'application/octet-stream' }
}

function completionOf(module: XmlNode | undefined, type: ItemType): Completion {
  const tracking = numberAt(module, 'completion')
  if (tracking === 0) return 'none'
  // 評定や提出による自動完了を「なし」にしないのは、このアプリにない条件でも、完了を記録する項目だったことは残したいため
  if (tracking === 2 && numberAt(module, 'completionview') === 1 && type !== 'screen') return 'view'
  return 'manual'
}

const RESTRICTION_NOTE = 'Moodle のアクセス制限（日付・条件）は取り込めないため、制限なしで表示されます'

const hasRestriction = (node: XmlNode | undefined) =>
  /"c"\s*:\s*\[\s*\{/.test(textAt(node, 'availability')) ||
  !!at(node, 'availability_info')?.children.length ||
  numberAt(node, 'availablefrom') > 0 ||
  numberAt(node, 'availableuntil') > 0

type Activity = { moduleId: string; sectionId: string; module: string; title: string; directory: string }

function readActivity(dir: string, activity: Activity, filesOf: ReturnType<typeof indexFiles>): BackupItem[] {
  const moduleXml = at(readXml(dir, path.join(activity.directory, 'module.xml')), 'module')
  const root = at(readXml(dir, path.join(activity.directory, `${activity.module}.xml`)), 'activity')
  const data = at(root, activity.module)
  const contextId = root?.attrs.contextid ?? ''
  const hidden = numberAt(moduleXml, 'visible') === 0
  const notes: string[] = []
  if (hasRestriction(moduleXml)) notes.push(RESTRICTION_NOTE)
  const title = cut(textAt(data, 'name') || activity.title || moduleLabel(activity.module), LIMITS.itemTitle, notes, 'タイトル')
  const intro = () => toMarkdown(textAt(data, 'intro'), numberAt(data, 'introformat'))
  const base = { module: activity.module, title, url: '', linkTarget: 'new' as const, file: null, hidden, notes }

  const page = (converted: { markdown: string; images: number; tables: number }): BackupItem => {
    if (converted.images) notes.push(`本文の画像 ${converted.images} 枚は取り込めないため「（画像: 名前）」に置き換えます`)
    if (converted.tables) notes.push(`表 ${converted.tables} 個は「 | 」区切りの行にします`)
    return { ...base, type: 'page', body: cut(converted.markdown, LIMITS.body, notes, '本文'), completion: completionOf(moduleXml, 'page') }
  }

  switch (activity.module) {
    case 'page': {
      const content = toMarkdown(textAt(data, 'content'), numberAt(data, 'contentformat'))
      return [page(content.markdown ? content : intro())]
    }
    case 'label':
      return [page(intro())]
    case 'book': {
      const chapters = childrenOf(at(data, 'chapters'), 'chapter')
        .filter((ch) => numberAt(ch, 'hidden') === 0)
        .sort((a, b) => numberAt(a, 'pagenum') - numberAt(b, 'pagenum'))
        .map((ch) => {
          const content = toMarkdown(textAt(ch, 'content'), numberAt(ch, 'contentformat'))
          const heading = `${numberAt(ch, 'subchapter') ? '##' : '#'} ${textAt(ch, 'title')}`
          return { markdown: `${heading}\n\n${content.markdown}`, images: content.images, tables: content.tables }
        })
      return [
        page({
          markdown: chapters.map((c) => c.markdown).join('\n\n'),
          images: chapters.reduce((n, c) => n + c.images, 0),
          tables: chapters.reduce((n, c) => n + c.tables, 0),
        }),
      ]
    }
    case 'url': {
      const url = textAt(data, 'externalurl').trim()
      if (!/^https?:\/\//i.test(url) || url.length > LIMITS.url)
        return [{ ...base, type: null, body: '', completion: 'none', notes: [`http(s) で始まらない URL（${url}）のため取り込みません`] }]
      const display = moodleDisplayOf(numberAt(data, 'display')) ?? 'auto'
      const linkTarget = linkTargetOf(display)
      if (!isExactDisplay(display))
        notes.push(`表示方法「${MOODLE_DISPLAY_LABELS[display]}」は「${LINK_TARGET_LABELS[linkTarget]}」にします`)
      return [{ ...base, type: 'link', url, linkTarget, body: intro().markdown, completion: completionOf(moduleXml, 'link') }]
    }
    case 'resource': {
      const rows = filesOf(contextId, 'mod_resource', 'content').sort((a, b) => b.sortorder - a.sortorder)
      const file = rows[0] && toBackupFile(dir, rows[0])
      if (!file)
        return [
          { ...base, type: null, body: '', completion: 'none', notes: ['バックアップにファイルの中身が含まれていないため取り込みません'] },
        ]
      if (rows.length > 1) notes.push(`ほかに ${rows.length - 1} 個のファイルがありますが、メインのファイルだけを取り込みます`)
      return [{ ...base, type: 'file', file, body: intro().markdown, completion: completionOf(moduleXml, 'file') }]
    }
    case 'folder': {
      const files = filesOf(contextId, 'mod_folder', 'content')
        .map((row) => toBackupFile(dir, row))
        .filter((f): f is BackupFile => !!f)
      if (!files.length) return [{ ...base, type: null, body: '', completion: 'none', notes: ['フォルダが空のため取り込みません'] }]
      return files.map((file) => ({
        ...base,
        notes: [],
        title: cut(`${title} / ${file.name}`, LIMITS.itemTitle, [], ''),
        type: 'file' as const,
        file,
        body: '',
        completion: completionOf(moduleXml, 'file'),
      }))
    }
    default:
      return [
        {
          ...base,
          type: null,
          body: '',
          completion: 'none',
          notes: [`${moduleLabel(activity.module)}は STEP Learn にない機能のため取り込みません`],
        },
      ]
  }
}

function readParticipants(dir: string): BackupParticipant[] {
  const roleOf = new Map<string, CourseRole>()
  for (const r of childrenOf(at(readXml(dir, 'roles.xml'), 'roles_definition'), 'role')) {
    const archetype = textAt(r, 'archetype') || textAt(r, 'shortname')
    if (TEACHER_ARCHETYPES.has(archetype)) roleOf.set(r.attrs.id, 'teacher')
    else if (archetype === 'student') roleOf.set(r.attrs.id, 'student')
  }

  const assigned = new Map<string, CourseRole>()
  for (const a of childrenOf(at(readXml(dir, 'course/roles.xml'), 'roles/role_assignments'), 'assignment')) {
    const role = roleOf.get(textAt(a, 'roleid'))
    const userId = textAt(a, 'userid')
    if (role && assigned.get(userId) !== 'teacher') assigned.set(userId, role)
  }

  const enrolled = new Map<string, boolean>()
  for (const e of childrenOf(at(readXml(dir, 'course/enrolments.xml'), 'enrolments/enrols'), 'enrol')) {
    const methodActive = numberAt(e, 'status') === 0
    for (const ue of childrenOf(at(e, 'user_enrolments'), 'enrolment')) {
      const userId = textAt(ue, 'userid')
      enrolled.set(userId, (enrolled.get(userId) ?? false) || (methodActive && numberAt(ue, 'status') === 0))
    }
  }

  const seen = new Set<string>()
  const participants: BackupParticipant[] = []
  for (const u of childrenOf(at(readXml(dir, 'users.xml'), 'users'), 'user')) {
    const role = assigned.get(u.attrs.id)
    if (!role) continue
    const moodleUsername = textAt(u, 'username')
    const email = textAt(u, 'email').trim().toLowerCase()
    const name =
      [textAt(u, 'lastname'), textAt(u, 'firstname')]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, LIMITS.name) || moodleUsername
    const username = normalizeUsername(moodleUsername)
    const skip =
      numberAt(u, 'deleted') === 1
        ? 'Moodle で削除済み'
        : numberAt(u, 'suspended') === 1
          ? 'Moodle でアカウントが停止されている'
          : enrolled.size && !enrolled.get(u.attrs.id)
            ? 'Moodle で受講が停止されている'
            : !isEmail(email)
              ? 'メールアドレスがない'
              : seen.has(email)
                ? 'メールアドレスがほかの参加者と重複している'
                : null
    if (!skip) seen.add(email)
    participants.push({ moodleUsername, name, email, username: checkUsername(username) ? '' : username, role, skip })
  }
  return participants
}

export function readBackup(dir: string): Backup {
  const info = at(readXml(dir, 'moodle_backup.xml'), 'moodle_backup/information')
  if (!info) throw new Error('moodle_backup.xml がありません。Moodle のコースバックアップ（.mbz）を指定してください。')
  const type = textAt(at(info, 'details'), 'detail/type')
  if (type && type !== 'course')
    throw new Error(`コース単位のバックアップではありません（${type}）。コースのバックアップを指定してください。`)

  const settings = new Map(
    childrenOf(at(info, 'settings'), 'setting')
      .filter((s) => textAt(s, 'level') === 'root')
      .map((s) => [textAt(s, 'name'), textAt(s, 'value')]),
  )
  const warnings: string[] = []
  const anonymized = settings.get('anonymize') === '1'
  if (anonymized) warnings.push('ユーザー情報を匿名化したバックアップのため、参加者は取り込みません')
  const usersIncluded = settings.get('users') === '1' && !anonymized

  const course = at(readXml(dir, 'course/course.xml'), 'course')
  const courseNotes: string[] = []
  const filesOf = indexFiles(dir)

  const activities: Activity[] = childrenOf(at(info, 'contents/activities'), 'activity').map((a) => ({
    moduleId: textAt(a, 'moduleid'),
    sectionId: textAt(a, 'sectionid'),
    module: textAt(a, 'modulename'),
    title: textAt(a, 'title'),
    directory: textAt(a, 'directory'),
  }))

  const sections = childrenOf(at(info, 'contents/sections'), 'section')
    .map((s) => ({ id: textAt(s, 'sectionid'), xml: at(readXml(dir, path.join(textAt(s, 'directory'), 'section.xml')), 'section') }))
    .sort((a, b) => numberAt(a.xml, 'number') - numberAt(b.xml, 'number'))
    .map(({ id, xml }): BackupSection => {
      const number = numberAt(xml, 'number')
      const notes: string[] = hasRestriction(xml) ? [RESTRICTION_NOTE] : []
      const inSection = activities.filter((a) => a.sectionId === id)
      const order = textAt(xml, 'sequence').split(',').filter(Boolean)
      const rank = (a: Activity) => (order.includes(a.moduleId) ? order.indexOf(a.moduleId) : order.length)
      return {
        title: cut(textAt(xml, 'name') || (number === 0 ? '一般' : `セクション ${number}`), LIMITS.sectionTitle, notes, 'セクション名'),
        summary: cut(toPlainText(textAt(xml, 'summary'), numberAt(xml, 'summaryformat')), LIMITS.summary, notes, '説明'),
        hidden: numberAt(xml, 'visible') === 0,
        items: inSection.sort((a, b) => rank(a) - rank(b)).flatMap((a) => readActivity(dir, a, filesOf)),
        notes,
      }
    })
    // 中身のない「一般」セクションを作らないのは、Moodle では告知用のフォーラムだけが置かれていることが多く、取り込むと空のセクションが先頭に残るため
    .filter((s, i) => i > 0 || s.summary || s.items.some((item) => item.type))

  return {
    release: textAt(info, 'moodle_release'),
    course: {
      title: cut(
        textAt(course, 'fullname') || textAt(info, 'original_course_fullname') || 'Moodle から移行したコース',
        LIMITS.courseTitle,
        courseNotes,
        'コース名',
      ),
      code: cut(textAt(course, 'shortname'), LIMITS.courseCode, courseNotes, 'コースコード'),
      summary: cut(toPlainText(textAt(course, 'summary'), numberAt(course, 'summaryformat')), LIMITS.summary, courseNotes, 'コースの概要'),
      visible: numberAt(course, 'visible') !== 0,
      completionEnabled: numberAt(course, 'enablecompletion') !== 0,
    },
    sections,
    usersIncluded,
    participants: usersIncluded ? readParticipants(dir) : [],
    warnings: [...warnings, ...courseNotes],
  }
}
