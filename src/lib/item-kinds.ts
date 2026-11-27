import { and, eq, inArray, or } from 'drizzle-orm'
import { bundleKeysOf } from '../features/bundle/bundle-items'
import { DEFAULT_STARTER, type CodeConstraint, type CodeLanguage } from '../features/code/code'
import type { CollabKind, CollabScope } from '../features/collab/collab'
import type { PublicationSettings } from '../features/publication/publication'
import { collabStore } from '../features/collab/collab-items'
import { folderKeysOf } from '../features/folder/folder-items'
import { publicationKeysOf } from '../features/publication/publication-items'
import { nextPosition, placeBefore, sectionEntries, type EntryRef } from './courses'
import { db, type DB } from './db'
import { codeItems, collabItems, items, publicationItems, sections } from './schema'
import { deleteKeys, inBackground, storage, type StoredFile } from './storage'
import type { Completion, ItemType, LinkTarget } from './types'

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

/** 新しく作るアイテム。種類ごとの欄（code・collab・publication）は、その種類のときだけ読む */
type NewItem = {
  courseId: number
  sectionId: number
  /** このアイテムかサブセクションの前に入れる。なければ末尾 */
  before?: EntryRef
  type: ItemType
  title: string
  body: string
  url?: string
  linkTarget?: LinkTarget
  hidden: number
  completion?: Completion
  file?: StoredFile | null
  code?: { language: CodeLanguage; criteria?: string; constraints?: CodeConstraint[] }
  collab?: { kind: CollabKind; scope: CollabScope }
  publication?: Partial<PublicationSettings>
}

/** 作ったあとに開く画面と、知らせる文言。null ならセクションの一覧へ戻る */
type AfterCreate = { page: 'edit' | 'view'; message: string } | null

/**
 * アイテムの種類ごとの決まり。種類を足したら、ここに 1 行足す（Record なので、足し忘れると型エラーになる）。
 * 画面の見た目の違いは views.tsx、編集・表示に渡すデータは features/content/handlers.tsx の EDIT_DATA / VIEW_DATA にある
 */
type ItemKind = {
  /** 作成と同じトランザクションで足す、種類ごとの行 */
  createRows: ((tx: Tx, itemId: number, item: NewItem) => void) | null
  afterCreate: AfterCreate
  /** 消すときに一緒に消す、DB の外のファイル。DB の行は外部キーの cascade で消える */
  storedFiles: ((courseId: number, itemId: number) => { keys: string[]; prefixes: string[] }) | null
}

const NONE: ItemKind = { createRows: null, afterCreate: null, storedFiles: null }

export const ITEM_KINDS: Record<ItemType, ItemKind> = {
  page: NONE,
  link: NONE,
  file: NONE,
  // ファイルを置くまで学生に見せるものがないので、アップロードする編集画面へ進める
  folder: {
    ...NONE,
    afterCreate: { page: 'edit', message: 'フォルダーに置くファイルをアップロードしてください。' },
    storedFiles: (_courseId, itemId) => ({ keys: folderKeysOf(itemId), prefixes: [] }),
  },
  // PDF を上げるまで学生に見せるものがないので、同期を始めるアイテムの画面へ進める
  presentation: { ...NONE, afterCreate: { page: 'view', message: '「PowerPoint と同期」から PDF をアップロードしてください。' } },
  screen: NONE,
  code: {
    ...NONE,
    createRows(tx, itemId, { code }) {
      const language = code?.language ?? 'web'
      tx.insert(codeItems)
        .values({
          itemId,
          language,
          starter: DEFAULT_STARTER[language],
          criteria: code?.criteria ?? '',
          constraints: code?.constraints ?? [],
          stage: 'draft',
        })
        .run()
    },
    afterCreate: { page: 'edit', message: '問題文と最初のコードを設定してください。' },
  },
  quiz: { ...NONE, afterCreate: { page: 'edit', message: '問題を作ってください。' } },
  collab: {
    ...NONE,
    createRows(tx, itemId, { collab }) {
      tx.insert(collabItems)
        .values({ itemId, kind: collab?.kind ?? 'doc', scope: collab?.scope ?? 'course' })
        .run()
    },
    storedFiles: (courseId, itemId) => ({ keys: [], prefixes: [`${collabStore(courseId, itemId).imagePrefix}/`] }),
  },
  // ファイルを置くまで学生に配れないので、アップロードする編集画面へ進める
  bundle: {
    ...NONE,
    afterCreate: { page: 'edit', message: '配るファイルをアップロードしてください。' },
    storedFiles: (_courseId, itemId) => ({ keys: bundleKeysOf([itemId]), prefixes: [] }),
  },
  agent: { ...NONE, afterCreate: { page: 'edit', message: '使える期間と上限を設定してください。' } },
  survey: { ...NONE, afterCreate: { page: 'edit', message: '問いを作ってください。' } },
  // 既定の公開の方法（承認してから公開）が授業に合うかを決めてもらうため、編集画面へ進める
  publication: {
    afterCreate: { page: 'edit', message: '公開の方法と提出の期間を確かめてください。' },
    createRows(tx, itemId, { publication }) {
      tx.insert(publicationItems)
        .values({ itemId, ...publication })
        .run()
    },
    storedFiles: (_courseId, itemId) => ({ keys: publicationKeysOf(itemId), prefixes: [] }),
  },
}

/** 置いたファイルを、アイテムの列に書く値 */
export const itemFileColumns = (stored: StoredFile | null | undefined) =>
  stored ? { fileKey: stored.key, fileName: stored.name, fileSize: stored.size, fileType: stored.type } : {}

/** アイテムを作り、種類ごとの行も足す。作ったアイテムの ID */
export function insertItem(item: NewItem): number {
  const link = item.type === 'link'
  const id = db.transaction((tx) => {
    const row = tx
      .insert(items)
      .values({
        courseId: item.courseId,
        sectionId: item.sectionId,
        type: item.type,
        title: item.title,
        body: item.body,
        url: link ? (item.url ?? '') : '',
        linkTarget: link ? (item.linkTarget ?? 'new') : 'new',
        hidden: item.hidden,
        completion: item.completion ?? 'none',
        ...itemFileColumns(item.file),
        position: nextPosition(sectionEntries(item.sectionId)),
      })
      .returning({ id: items.id })
      .get()
    ITEM_KINDS[item.type].createRows?.(tx, row.id, item)
    return row.id
  })
  if (item.before) placeBefore(sectionEntries(item.sectionId), { kind: 'item', id }, item.before)
  return id
}

/** 消すアイテムの、DB の外のファイル。行を消す前に読む（消したあとでは、種類ごとの行が残っていない） */
export function storedFilesOf(rows: { id: number; courseId: number; type: ItemType; fileKey: string | null }[]) {
  const keys: (string | null)[] = []
  const prefixes: string[] = []
  for (const row of rows) {
    keys.push(row.fileKey)
    const extra = ITEM_KINDS[row.type].storedFiles?.(row.courseId, row.id)
    if (extra) {
      keys.push(...extra.keys)
      prefixes.push(...extra.prefixes)
    }
  }
  return { keys, prefixes }
}

/** storedFilesOf で集めたファイルを、応答を待たせずに消す */
export function deleteStoredFiles({ keys, prefixes }: ReturnType<typeof storedFilesOf>) {
  inBackground(deleteKeys(keys))
  for (const prefix of prefixes) inBackground(storage.deletePrefix(prefix))
}

/** セクションのアイテム全部（サブセクションの中のものも）の、DB の外のファイル */
export const sectionStoredFiles = (courseId: number, sectionId: number) =>
  storedFilesOf(
    db
      .select({ id: items.id, courseId: items.courseId, type: items.type, fileKey: items.fileKey })
      .from(items)
      .where(
        and(
          or(
            eq(items.sectionId, sectionId),
            inArray(items.sectionId, db.select({ id: sections.id }).from(sections).where(eq(sections.parentId, sectionId))),
          ),
          eq(items.courseId, courseId),
        ),
      )
      .all(),
  )
