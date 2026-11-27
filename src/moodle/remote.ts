import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { BUNDLE_MODULE } from '../features/bundle/bundle'
import type { PublicationStatus } from '../features/publication/publication'
import { isEmail, isHttpUrl } from '../lib/forms'
import { COMPLETION_LABELS, type Completion, type CourseRole } from '../lib/types'
import { checkUsername, normalizeUsername } from '../lib/username'
import { callSite, fetchSiteFile, type MoodleCourse, type MoodleModule, type MoodleSection } from '../moodle-mode/client'
import { displayOf, extraKeyOf } from '../moodle-mode/mapping'
import {
  LIMITS,
  RESTRICTION_NOTE,
  backupItems,
  cut,
  moduleLabel,
  type Backup,
  type BackupFile,
  type BackupItem,
  type BackupParticipant,
  type BackupPublication,
  type BackupSection,
} from './backup'
import { linkTargetOf } from './display'
import { toMarkdown, toPlainText } from './html'

type MoodleSite = { url: string; token: string }

/** Moodle から落とすファイル */
type RemoteFile = { filename: string; fileurl: string; mimetype?: string }

/** local_steplearn_get_participants の 1 人 */
type MoodleParticipant = {
  id: number
  username: string
  email: string
  firstname: string
  lastname: string
  suspended: boolean
  deleted: boolean
  active: boolean
  archetypes: string[]
}

/** local_steplearn_get_publications の学生フォルダ 1 つ */
type MoodlePublication = {
  cmid: number
  mode: number
  obtainteacherapproval: boolean
  obtainstudentapproval: boolean
  showparticipantnames: boolean
  allowsubmissionsfromdate: number
  duedate: number
  completionupload: boolean
  allowedfiletypes: string
  extensions: number
  missing: number
  files: (RemoteFile & { userid: number; filesize: number; timecreated: number; teacherapproval: number; studentapproval: number })[]
}

// 評定や提出による自動の完了を「なし」にしないのは、完了を記録する項目だったことは残したいため
const completionOf = (m: MoodleModule): Completion => (m.completion === 1 ? 'manual' : m.completion === 2 ? 'view' : 'none')

/** 参加者と学生フォルダを読む関数を呼べないときの、直し方を添えたエラー */
function needsPlugin(err: unknown): never {
  const detail = err instanceof Error ? `（${err.message}）` : ''
  throw new Error(
    `参加者と学生フォルダを読めませんでした${detail}。Moodle の local_steplearn を 2026112600 以降の版に更新し、トークンのアカウントにユーザーを含めたバックアップの権限（moodle/backup:backupcourse・moodle/backup:userinfo）があるか確かめてください。`,
  )
}

const TEACHER_ARCHETYPES = new Set(['editingteacher', 'teacher', 'manager'])

const roleOf = (archetypes: string[]): CourseRole | null =>
  archetypes.some((a) => TEACHER_ARCHETYPES.has(a)) ? 'teacher' : archetypes.includes('student') ? 'student' : null

/** コースの教師・学生。取り込めない人も、理由（skip）を付けて含める */
function participantsOf(rows: MoodleParticipant[]): BackupParticipant[] {
  const seen = new Set<string>()
  const participants: BackupParticipant[] = []
  for (const u of rows) {
    const role = roleOf(u.archetypes)
    if (!role) continue
    const email = u.email.trim().toLowerCase()
    const name =
      [u.lastname, u.firstname]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, LIMITS.name) || u.username
    const username = normalizeUsername(u.username).split('@')[0]
    const skip = u.deleted
      ? 'Moodle で削除済み'
      : u.suspended
        ? 'Moodle でアカウントが停止されている'
        : !u.active
          ? 'Moodle で受講が停止されている'
          : !isEmail(email)
            ? 'メールアドレスがない'
            : seen.has(email)
              ? 'メールアドレスがほかの参加者と重複している'
              : null
    if (!skip) seen.add(email)
    participants.push({
      moodleId: String(u.id),
      moodleUsername: u.username,
      name,
      email,
      username: checkUsername(username) ? '' : username,
      role,
      skip,
    })
  }
  return participants
}

/**
 * 学生フォルダのファイルの扱い。Moodle で学生に見えていたファイルは公開、承認を断られたファイルは非公開、それ以外は承認待ちにする。
 * 学生の承認を教師の承認と同じに扱うのは、STEP Learn には学生の承認がなく、見えていなかったファイルを見せてしまわないため
 */
function publicationStatusOf(p: MoodlePublication, file: MoodlePublication['files'][number]): PublicationStatus {
  const { obtainteacherapproval: askTeacher, obtainstudentapproval: askStudent } = p
  if ((!askTeacher || file.teacherapproval === 1) && (!askStudent || file.studentapproval === 1)) return 'approved'
  if ((askTeacher && file.teacherapproval === 2) || (askStudent && file.studentapproval === 2)) return 'rejected'
  return 'pending'
}

/** 学生フォルダの設定で、STEP Learn にないため変わるもの */
function publicationNotes(p: MoodlePublication, completion: Completion) {
  const notes: string[] = []
  if (p.obtainstudentapproval && !p.obtainteacherapproval)
    notes.push('学生の承認は STEP Learn にないため、教師が承認してから公開する設定にします')
  else if (p.obtainstudentapproval) notes.push('学生の承認は STEP Learn にないため、教師の承認だけにします')
  if (p.mode === 1)
    notes.push('課題からの取り込みは STEP Learn にないため、取り込んだ時点のファイルだけを引き継ぎ、これからは学生が直接アップロードします')
  if (p.extensions) notes.push('学生・グループごとの期限の延長と上書きは取り込めないため、全員に同じ期間を使います')
  if (p.allowedfiletypes.trim()) notes.push('受け付けるファイルの種類の制限は取り込めないため、どの種類も受け付けます')
  if (p.completionupload && completion !== 'none')
    notes.push(`完了の条件「ファイルを提出したら完了」は STEP Learn にないため、「${COMPLETION_LABELS[completion]}」にします`)
  if (p.missing) notes.push(`中身が Moodle にないファイル ${p.missing} 個は取り込みません`)
  return notes
}

/**
 * Moodle の Web サービスでコースを読み、取り込む形にする。ファイルは dir に保存する。
 * 取り込むのは参加者とセクションと、URL・ファイル・フォルダー・学生フォルダだけ
 */
export async function readRemoteCourse(site: MoodleSite, courseId: number, dir: string): Promise<Backup> {
  const call = <T>(wsfunction: string, params = {}) => callSite<T>(site.url, site.token, wsfunction, params)
  const [info, course, contents, people, publications] = await Promise.all([
    call<{ release: string }>('core_webservice_get_site_info'),
    call<MoodleCourse>('local_steplearn_get_course', { courseid: courseId }),
    call<MoodleSection[]>('core_course_get_contents', { courseid: courseId }),
    call<MoodleParticipant[]>('local_steplearn_get_participants', { courseid: courseId }).catch(needsPlugin),
    call<MoodlePublication[]>('local_steplearn_get_publications', { courseid: courseId }).catch(needsPlugin),
  ])
  const participants = participantsOf(people)
  const joining = new Set(participants.filter((p) => !p.skip).map((p) => p.moodleId))
  const publicationOf = new Map(publications.map((p) => [p.cmid, p]))

  let saved = 0
  async function download(content: RemoteFile, notes: string[]): Promise<BackupFile | null> {
    const res = await fetchSiteFile(site.url, site.token, content.fileurl)
    if (!res?.ok || !res.body) {
      notes.push(`ファイル「${content.filename}」を取得できなかったため取り込みません`)
      return null
    }
    const p = path.join(dir, String(++saved))
    await pipeline(Readable.fromWeb(res.body as ReadableStream), fs.createWriteStream(p))
    return { path: p, name: content.filename, size: fs.statSync(p).size, type: content.mimetype || 'application/octet-stream' }
  }

  async function readModule(m: MoodleModule): Promise<BackupItem[]> {
    const notes: string[] = m.availabilityinfo ? [RESTRICTION_NOTE] : []
    const title = cut(m.name || moduleLabel(m.modname), LIMITS.itemTitle, notes, 'タイトル')
    const hidden = !m.visible || !m.visibleoncoursepage
    const body = m.description ? cut(toMarkdown(m.description, 1).markdown, LIMITS.body, notes, '説明') : ''
    const base = { module: m.modname, title, body, url: '', linkTarget: 'new' as const, file: null, hidden, notes }
    const skip = (note: string): BackupItem[] => [{ ...base, type: null, completion: 'none', notes: [note] }]
    const files = (m.contents ?? []).filter((c) => c.type === 'file')

    switch (m.modname) {
      case 'url': {
        const url = m.contents?.[0]?.fileurl.trim() ?? ''
        if (extraKeyOf(url)) return skip('Moodle モードで追加したアイテムは引き継ぎません')
        if (!isHttpUrl(url) || url.length > LIMITS.url) return skip(`http(s) で始まらない URL（${url}）のため取り込みません`)
        return [{ ...base, type: 'link', url, linkTarget: linkTargetOf(displayOf(m) ?? 'auto'), completion: completionOf(m) }]
      }
      case 'resource': {
        const file = files[0] ? await download(files[0], notes) : null
        if (!file) return skip(notes.at(-1) ?? 'ファイルがないため取り込みません')
        if (files.length > 1) notes.push(`ほかに ${files.length - 1} 個のファイルがありますが、メインのファイルだけを取り込みます`)
        return [{ ...base, type: 'file', file, completion: completionOf(m) }]
      }
      case 'folder': {
        if (!files.length) return skip('フォルダが空のため取り込みません')
        const items: BackupItem[] = []
        for (const content of files) {
          const itemNotes: string[] = []
          const file = await download(content, itemNotes)
          const name = `${(content.filepath ?? '/').slice(1)}${content.filename}`
          const itemTitle = cut(`${title} / ${name}`, LIMITS.itemTitle, [], '')
          items.push(
            file
              ? { ...base, title: itemTitle, notes: itemNotes, type: 'file', file, body: '', completion: 'none' }
              : { ...base, title: itemTitle, notes: itemNotes, type: null, completion: 'none' },
          )
        }
        return items
      }
      case 'publication': {
        const found = publicationOf.get(m.id)
        if (!found) return skip('学生フォルダの設定を読めなかったため取り込みません')
        const completion = completionOf(m)
        notes.push(...publicationNotes(found, completion))
        return [{ ...base, type: 'publication', publication: await readPublication(found, notes), completion }]
      }
      case BUNDLE_MODULE:
        return skip('Moodle モードで追加したアイテムは引き継ぎません')
      default:
        return skip('URL・ファイル・フォルダー・学生フォルダ以外の活動は取り込みません')
    }
  }

  async function readPublication(p: MoodlePublication, notes: string[]): Promise<BackupPublication> {
    // 持ち主が参加者にならないファイルを落とさないのは、STEP Learn のファイルには持ち主が要り、取り込めないファイルのために時間をかけないため
    const owned = p.files.filter((f) => joining.has(String(f.userid)))
    if (owned.length < p.files.length)
      notes.push(`持ち主を参加者として取り込まないファイル ${p.files.length - owned.length} 個（グループでの提出を含む）は取り込みません`)
    const files: BackupPublication['files'] = []
    for (const f of owned) {
      const file = await download(f, notes)
      if (file) files.push({ file, moodleUserId: String(f.userid), status: publicationStatusOf(p, f), createdAt: f.timecreated })
    }
    return {
      settings: {
        approval: p.obtainteacherapproval || p.obtainstudentapproval ? 1 : 0,
        showNames: p.showparticipantnames ? 1 : 0,
        opensAt: p.allowsubmissionsfromdate || null,
        closesAt: p.duedate || null,
      },
      files,
    }
  }

  const delegated = new Map(contents.filter((s) => s.component === 'mod_subsection' && s.itemid).map((s) => [s.itemid!, s]))

  // サブセクションの中のサブセクションを入れ子にしないのは、Moodle が 1 段しか作らせず、STEP Learn も 1 段だけにしているため
  async function readSection(s: MoodleSection, title: string, nested = false): Promise<BackupSection> {
    const notes: string[] = s.availabilityinfo ? [RESTRICTION_NOTE] : []
    const items: BackupItem[] = []
    for (const m of s.modules) items.push(...(m.modname === 'subsection' && !nested ? await readSubsection(m) : await readModule(m)))
    return {
      title: cut(title, LIMITS.sectionTitle, notes, 'セクション名'),
      summary: cut(toPlainText(s.summary, s.summaryformat), LIMITS.summary, notes, '説明'),
      hidden: s.visible === 0,
      items,
      notes,
    }
  }

  async function readSubsection(m: MoodleModule): Promise<BackupItem[]> {
    const child = delegated.get(m.instance)
    const base = {
      module: m.modname,
      title: m.name,
      body: '',
      url: '',
      linkTarget: 'new' as const,
      file: null,
      completion: 'none' as const,
    }
    if (!child) return [{ ...base, type: null, hidden: false, notes: ['サブセクションの中身を読めなかったため取り込みません'] }]
    const subsection = await readSection(child, child.name || m.name || moduleLabel(m.modname), true)
    const hidden = subsection.hidden || !m.visible
    return [{ ...base, type: null, hidden, notes: [], subsection: { ...subsection, hidden } }]
  }

  const sections: BackupSection[] = []
  for (const s of contents.filter((s) => !s.component))
    sections.push(await readSection(s, s.name || (s.section === 0 ? '一般' : `セクション ${s.section}`)))

  const courseNotes: string[] = []
  return {
    release: info.release,
    course: {
      title: cut(course.fullname || 'Moodle から移行したコース', LIMITS.courseTitle, courseNotes, 'コース名'),
      code: cut(course.shortname, LIMITS.courseCode, courseNotes, 'コースコード'),
      summary: cut(toPlainText(course.summary, course.summaryformat), LIMITS.summary, courseNotes, 'コースの概要'),
      visible: course.visible,
      completionEnabled: course.completionenabled,
    },
    // 中身のない「一般」セクションを作らないのは、Moodle では告知用のフォーラムだけが置かれていることが多く、取り込むと空のセクションが先頭に残るため
    sections: sections.filter((s, i) => i > 0 || s.summary || backupItems(s).some((item) => item.type)),
    participants,
    warnings: courseNotes,
  }
}
