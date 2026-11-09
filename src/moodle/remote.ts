import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { isHttpUrl } from '../lib/forms'
import type { Completion } from '../lib/types'
import { callSite, fetchSiteFile, type MoodleCourse, type MoodleModule, type MoodleSection } from '../moodle-mode/client'
import { displayOf, extraKeyOf } from '../moodle-mode/mapping'
import { LIMITS, RESTRICTION_NOTE, cut, moduleLabel, type Backup, type BackupFile, type BackupItem, type BackupSection } from './backup'
import { linkTargetOf } from './display'
import { toMarkdown, toPlainText } from './html'

export type MoodleSite = { url: string; token: string }

type Content = NonNullable<MoodleModule['contents']>[number]

// 評定や提出による自動の完了を「なし」にしないのは、.mbz の取り込みと同じく、完了を記録する項目だったことは残したいため
const completionOf = (m: MoodleModule): Completion => (m.completion === 1 ? 'manual' : m.completion === 2 ? 'view' : 'none')

/**
 * Moodle の Web サービスでコースを読み、.mbz を読んだときと同じ形にする。ファイルは dir に保存する。
 * 取り込むのはセクションと URL・ファイル・フォルダーだけで、参加者は取り込まない
 */
export async function readRemoteCourse(site: MoodleSite, courseId: number, dir: string): Promise<Backup> {
  const call = <T>(wsfunction: string, params = {}) => callSite<T>(site.url, site.token, wsfunction, params)
  const [info, course, contents] = await Promise.all([
    call<{ release: string }>('core_webservice_get_site_info'),
    call<MoodleCourse>('local_steplearn_get_course', { courseid: courseId }),
    call<MoodleSection[]>('core_course_get_contents', { courseid: courseId }),
  ])

  let saved = 0
  async function download(content: Content, notes: string[]): Promise<BackupFile | null> {
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
      default:
        return skip('URL・ファイル・フォルダー以外の活動は取り込みません')
    }
  }

  const readSection = async (s: MoodleSection, title: string, hidden: boolean): Promise<BackupSection> => {
    const notes: string[] = s.availabilityinfo ? [RESTRICTION_NOTE] : []
    const items: BackupItem[] = []
    for (const m of s.modules) if (m.modname !== 'subsection') items.push(...(await readModule(m)))
    return {
      title: cut(title, LIMITS.sectionTitle, notes, 'セクション名'),
      summary: cut(toPlainText(s.summary, s.summaryformat), LIMITS.summary, notes, '説明'),
      hidden,
      items,
      notes,
    }
  }

  const delegated = new Map(contents.filter((s) => s.component === 'mod_subsection' && s.itemid).map((s) => [s.itemid!, s]))
  const sections: BackupSection[] = []
  for (const s of contents.filter((s) => !s.component)) {
    const title = s.name || (s.section === 0 ? '一般' : `セクション ${s.section}`)
    const hidden = s.visible === 0
    sections.push(await readSection(s, title, hidden))
    // 入れ子にしないのは、STEP Learn のセクションに入れ子がないため。親のすぐ後ろに並べ、名前で親が分かるようにする
    for (const m of s.modules.filter((m) => m.modname === 'subsection')) {
      const child = delegated.get(m.instance)
      if (child) sections.push(await readSection(child, `${title} › ${child.name || m.name}`, hidden || child.visible === 0 || !m.visible))
    }
  }

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
    // 中身のない「一般」セクションを作らないのは、.mbz の取り込みと同じく、取り込むと空のセクションが先頭に残るため
    sections: sections.filter((s, i) => i > 0 || s.summary || s.items.some((item) => item.type)),
    usersIncluded: false,
    usersNote: 'Moodle から直接読むときは参加者を取り込みません',
    participants: [],
    warnings: courseNotes,
  }
}
