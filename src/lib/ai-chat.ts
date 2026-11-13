// DB を読み込まず、渡された DB とテーブルで動かすのは、通常モード（step-learn.db）と Moodle モード（moodle-mode.db）の両方で同じ保存の仕方を使うため
import crypto from 'node:crypto'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { isAiModel, type AiMessage, type AiModel } from './ai'
import type { AiChange } from './ai-tool-kit'
import { config } from './config'
import type { aiChats as aiChatsTable } from './schema'

/** 閉じずに置かれたチャットを、最後の発言からこの秒数で消す */
export const AI_CHAT_TTL = 5 * 86_400

export type AiCardState = 'pending' | 'approved' | 'rejected' | 'failed'

/** 確認カード。name と args は AI が呼んだツールと引数、note は実行した結果や取り消した理由 */
export type AiCard = {
  name: string
  args: string
  title: string
  changes: AiChange[]
  snapshot: unknown
  state: AiCardState
  note?: string
}

/**
 * labels と cards はツール呼び出しの id ごとの、画面に出す説明と確認カード。
 * turnModel は最後の発言に答えているモデルで、チャットのモデルと違うのは難しい依頼を任せたとき（lib/ai-models.ts の AI_HARD_TASK_MODELS）
 */
export type AiChatContent = { messages: AiMessage[]; labels: Record<string, string>; cards: Record<string, AiCard>; turnModel?: AiModel }

export type AiChat = { id: number; model: AiModel; content: AiChatContent }

const emptyContent = (): AiChatContent => ({ messages: [], labels: {}, cards: {} })

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名と同じ鍵を別の用途に使い回さないため
const KEY = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'step-learn', 'ai-chat', 32))
const IV_LENGTH = 12
const TAG_LENGTH = 16

// 利用者を追加の認証データに含めるのは、DB を書き換えられたときに、ほかの人の会話を自分の行に移して読めないようにするため
const additionalData = (userId: number) => Buffer.from(`ai-chat:${userId}`)

function sealChat(userId: number, content: AiChatContent) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  cipher.setAAD(additionalData(userId))
  const body = Buffer.concat([cipher.update(JSON.stringify(content), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

function openChat(userId: number, sealed: Buffer): AiChatContent | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, sealed.subarray(0, IV_LENGTH))
    decipher.setAAD(additionalData(userId))
    decipher.setAuthTag(sealed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH))
    const json = Buffer.concat([decipher.update(sealed.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8')
    return { ...emptyContent(), ...(JSON.parse(json) as Partial<AiChatContent>) }
  } catch {
    return null
  }
}

const unixNow = () => Math.floor(Date.now() / 1000)

export type AiChatStore = ReturnType<typeof createAiChatStore>

/** AI のチャットを、db の ai_chats で扱う。Moodle モードのテーブルも同じ形にする（moodle-mode/schema.ts） */
export function createAiChatStore<S extends Record<string, unknown>>({
  db,
  aiChats,
}: {
  db: BetterSQLite3Database<S>
  aiChats: typeof aiChatsTable
}) {
  const closeChat = (userId: number) => db.delete(aiChats).where(eq(aiChats.userId, userId)).run()

  // 定期的に消す仕組みを持たないのは、読み書きのたびに期限切れを消せば足り、使われていないあいだに残っていても誰にも読めないため
  const purgeExpired = () =>
    db
      .delete(aiChats)
      .where(lt(aiChats.updatedAt, unixNow() - AI_CHAT_TTL))
      .run()

  /** 利用者の開いているチャット。1 人に 1 つで、新しく始めると前のものは消える */
  function currentChat(userId: number): AiChat | null {
    purgeExpired()
    const row = db
      .select({ id: aiChats.id, model: aiChats.model, content: aiChats.content })
      .from(aiChats)
      .where(eq(aiChats.userId, userId))
      .orderBy(desc(aiChats.id))
      .limit(1)
      .get()
    if (!row) return null
    const content = openChat(userId, row.content)
    // 読めないチャットを残さないのは、SESSION_SECRET を変えると復号できなくなり、使われていないモデルのチャットは続けられないため
    if (!content || !isAiModel(row.model)) {
      closeChat(userId)
      return null
    }
    return { id: row.id, model: row.model, content }
  }

  function startChat(userId: number, model: AiModel): AiChat {
    const content = emptyContent()
    return db.transaction((tx) => {
      tx.delete(aiChats).where(eq(aiChats.userId, userId)).run()
      const { id } = tx
        .insert(aiChats)
        .values({ userId, model, content: sealChat(userId, content) })
        .returning({ id: aiChats.id })
        .get()
      return { id, model, content }
    })
  }

  /** 途中で閉じられていたら false */
  function saveChat(userId: number, chat: AiChat) {
    const res = db
      .update(aiChats)
      .set({ content: sealChat(userId, chat.content) })
      .where(and(eq(aiChats.id, chat.id), eq(aiChats.userId, userId)))
      .run()
    return res.changes > 0
  }

  return { currentChat, startChat, saveChat, closeChat }
}
