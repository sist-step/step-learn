import { TransactionRollbackError, and, asc, desc, eq, inArray } from 'drizzle-orm'
import { hashPassword, resetPasswords } from '../../lib/auth'
import { db, startsWith } from '../../lib/db'
import { checkPassword } from '../../lib/password'
import { courses, enrollments, userBatchMembers, userBatches, users } from '../../lib/schema'
import type { ManagedRole } from '../../lib/types'
import { noEmailAddress } from '../../lib/username'
import type { BatchCard, BatchFileInput } from './batch-files'
import { BATCH_FILE_TTL, checkRoom, serialOf, serialUsername, type UserBatchKind } from './user-batch'

/** その接頭辞で次に振る連番。使われている最大の連番の次から振る */
export function nextSerial(prefix: string) {
  const taken = db
    .select({ username: users.username })
    .from(users)
    .where(startsWith(users.username, prefix))
    .all()
    .map((u) => (u.username === null ? null : serialOf(prefix, u.username)))
  // 空いた番号を埋めないのは、削除した人の番号を別の人に振ると、配った名簿やカードの番号と食い違うため
  return Math.max(0, ...taken.filter((n) => n !== null)) + 1
}

// 0 O o 1 l I を使わないのは、印刷したカードから読み写すときに見分けにくいため
const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789_-'
const PASSWORD_LENGTH = 8

function randomPassword(user: { name: string; username: string }) {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH))
    // 剰余だけで選ばないのは、256 が文字数で割り切れず、並びの前のほうの文字が出やすくなるため
    const limit = 256 - (256 % PASSWORD_CHARS.length)
    if (bytes.some((b) => b >= limit)) continue
    const password = [...bytes].map((b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('')
    // 記号で始めないのは、- で始まると CSV を Excel で開いたときに数式とみなされ、値が壊れるため
    if (/^[a-zA-Z0-9]/.test(password) && /\d/.test(password) && /[a-zA-Z]/.test(password) && !checkPassword(password, user)) return password
  }
}

// ---------------------------------------------------------------- 配るファイル

type StoredFiles = BatchFileInput & { expiresAt: number }

// DB やストレージに置かないのは、平文のパスワードをディスクに残さないため。サーバーを再起動すると 1 時間たつ前でも消える
const files = new Map<number, StoredFiles>()

const nowSec = () => Math.floor(Date.now() / 1000)

function keepFiles(batchId: number, input: BatchFileInput) {
  files.set(batchId, { ...input, expiresAt: nowSec() + BATCH_FILE_TTL })
  setTimeout(() => files.delete(batchId), BATCH_FILE_TTL * 1000).unref()
}

/** 期限内なら配るファイルの中身を返す */
export function batchFiles(batchId: number) {
  const stored = files.get(batchId)
  if (!stored || stored.expiresAt <= nowSec()) return null
  return stored
}

// ---------------------------------------------------------------- 作成と再発行

type Problem = { problem: string }

export async function createBatch(input: {
  adminId: number
  prefix: string
  role: ManagedRole
  courseId: number | null
  names: string[]
  loginUrl: string
}): Promise<{ id: number } | Problem> {
  const { prefix, role, courseId, names } = input
  const start = nextSerial(prefix)
  const room = checkRoom(start, names.length)
  if (room) return { problem: room }

  const cards: BatchCard[] = names.map((name, i) => {
    const username = serialUsername(prefix, start + i)
    return { name, username, password: randomPassword({ name, username }) }
  })
  const hashes = await Promise.all(cards.map((card) => hashPassword(card.password)))

  let id: number
  try {
    id = db.transaction((tx) => {
      // 先に数えた連番の確認だけに頼らないのは、ハッシュを作っている間に同じ接頭辞で作られると、UNIQUE 制約違反になるため
      const inserted = tx
        .insert(users)
        .values(
          cards.map((card, i) => ({
            email: noEmailAddress(card.username),
            name: card.name,
            username: card.username,
            passwordHash: hashes[i],
            role,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: users.id, username: users.username })
        .all()
      if (inserted.length < cards.length) tx.rollback()
      const idOf = new Map(inserted.map((u) => [u.username, u.id]))
      const userIds = cards.map((card) => idOf.get(card.username)!)
      if (courseId !== null)
        tx.insert(enrollments)
          .values(userIds.map((userId) => ({ courseId, userId, role })))
          .run()
      return insertBatch(tx, { kind: 'create', adminId: input.adminId, role, prefix, courseId, userIds })
    })
  } catch (e) {
    if (e instanceof TransactionRollbackError) return { problem: 'ほかの操作と同じユーザー名になりました。もう一度お試しください。' }
    throw e
  }
  keepFiles(id, { cards, role, loginUrl: input.loginUrl })
  return { id }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function insertBatch(
  tx: Tx,
  batch: { kind: UserBatchKind; adminId: number; role: ManagedRole; prefix: string; courseId: number | null; userIds: number[] },
) {
  const { id } = tx
    .insert(userBatches)
    .values({
      kind: batch.kind,
      createdBy: batch.adminId,
      role: batch.role,
      prefix: batch.prefix,
      courseId: batch.courseId,
      count: batch.userIds.length,
    })
    .returning({ id: userBatches.id })
    .get()
  tx.insert(userBatchMembers)
    .values(batch.userIds.map((userId, position) => ({ batchId: id, userId, position })))
    .run()
  return id
}

/** 履歴の中から選んだ人のパスワードを作り直し、新しい記録にする。履歴にいない人や、ロールが変わった人は選べない */
export async function reissueBatch(input: { adminId: number; batchId: number; userIds: number[]; loginUrl: string }) {
  const batch = db
    .select({ role: userBatches.role, prefix: userBatches.prefix })
    .from(userBatches)
    .where(eq(userBatches.id, input.batchId))
    .get()
  if (!batch) return null
  const members = db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(userBatchMembers)
    .innerJoin(users, eq(users.id, userBatchMembers.userId))
    .where(and(eq(userBatchMembers.batchId, input.batchId), inArray(userBatchMembers.userId, input.userIds), eq(users.role, batch.role)))
    .orderBy(asc(userBatchMembers.position))
    .all()
  if (members.length === 0) return null

  const cards = members.map((m) => {
    const username = m.username ?? ''
    return { userId: m.id, name: m.name, username, password: randomPassword({ name: m.name, username }) }
  })
  await resetPasswords(cards)
  const id = db.transaction((tx) =>
    insertBatch(tx, {
      kind: 'reissue',
      adminId: input.adminId,
      role: batch.role,
      prefix: batch.prefix,
      courseId: null,
      userIds: cards.map((c) => c.userId),
    }),
  )
  keepFiles(id, {
    cards: cards.map(({ name, username, password }) => ({ name, username, password })),
    role: batch.role,
    loginUrl: input.loginUrl,
  })
  return { id, count: cards.length }
}

// ---------------------------------------------------------------- 履歴

const HISTORY_LIMIT = 200

export function listBatches() {
  return db
    .select({
      id: userBatches.id,
      kind: userBatches.kind,
      role: userBatches.role,
      prefix: userBatches.prefix,
      count: userBatches.count,
      createdAt: userBatches.createdAt,
      adminName: users.name,
      courseTitle: courses.title,
    })
    .from(userBatches)
    .leftJoin(users, eq(users.id, userBatches.createdBy))
    .leftJoin(courses, eq(courses.id, userBatches.courseId))
    .orderBy(desc(userBatches.createdAt), desc(userBatches.id))
    .limit(HISTORY_LIMIT)
    .all()
}

export function findBatch(id: number) {
  const batch = db
    .select({
      id: userBatches.id,
      kind: userBatches.kind,
      role: userBatches.role,
      prefix: userBatches.prefix,
      count: userBatches.count,
      createdAt: userBatches.createdAt,
      courseId: userBatches.courseId,
      adminName: users.name,
      courseTitle: courses.title,
    })
    .from(userBatches)
    .leftJoin(users, eq(users.id, userBatches.createdBy))
    .leftJoin(courses, eq(courses.id, userBatches.courseId))
    .where(eq(userBatches.id, id))
    .get()
  if (!batch) return null
  const members = db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role })
    .from(userBatchMembers)
    .innerJoin(users, eq(users.id, userBatchMembers.userId))
    .where(eq(userBatchMembers.batchId, id))
    .orderBy(asc(userBatchMembers.position))
    .all()
  return { ...batch, members }
}

/** 一括作成で入れられるコース */
export const courseChoices = () => db.select({ id: courses.id, title: courses.title }).from(courses).orderBy(desc(courses.createdAt)).all()

export const courseExists = (id: number) => !!db.select({ id: courses.id }).from(courses).where(eq(courses.id, id)).get()

export const batchExists = (id: number) => !!db.select({ id: userBatches.id }).from(userBatches).where(eq(userBatches.id, id)).get()
