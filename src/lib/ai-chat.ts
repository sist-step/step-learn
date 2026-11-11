import crypto from 'node:crypto'
import { and, desc, eq, lt } from 'drizzle-orm'
import { isAiModel, type AiMessage, type AiModel } from './ai'
import { config } from './config'
import { db } from './db'
import { aiChats } from './schema'

/** 閉じずに置かれたチャットを、最後の発言からこの秒数で消す */
export const AI_CHAT_TTL = 5 * 86_400

/** labels はツール呼び出しの id ごとの、画面に出す説明（「「〇〇」を読みました」など） */
export type AiChatContent = { messages: AiMessage[]; labels: Record<string, string> }

export type AiChat = { id: number; model: AiModel; content: AiChatContent }

const EMPTY: AiChatContent = { messages: [], labels: {} }

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名と同じ鍵を別の用途に使い回さないため
const KEY = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'step-learn', 'ai-chat', 32))
const IV_LENGTH = 12
const TAG_LENGTH = 16

// 利用者を追加の認証データに含めるのは、DB を書き換えられたときに、ほかの人の会話を自分の行に移して読めないようにするため
const additionalData = (userId: number) => Buffer.from(`ai-chat:${userId}`)

export function sealChat(userId: number, content: AiChatContent) {
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
    return JSON.parse(json) as AiChatContent
  } catch {
    return null
  }
}

const unixNow = () => Math.floor(Date.now() / 1000)

// 定期的に消す仕組みを持たないのは、読み書きのたびに期限切れを消せば足り、使われていないあいだに残っていても誰にも読めないため
const purgeExpired = () =>
  db
    .delete(aiChats)
    .where(lt(aiChats.updatedAt, unixNow() - AI_CHAT_TTL))
    .run()

/** 利用者の開いているチャット。1 人に 1 つで、新しく始めると前のものは消える */
export function currentChat(userId: number): AiChat | null {
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

export function startChat(userId: number, model: AiModel): AiChat {
  return db.transaction((tx) => {
    tx.delete(aiChats).where(eq(aiChats.userId, userId)).run()
    const { id } = tx
      .insert(aiChats)
      .values({ userId, model, content: sealChat(userId, EMPTY) })
      .returning({ id: aiChats.id })
      .get()
    return { id, model, content: { messages: [], labels: {} } }
  })
}

/** 途中で閉じられていたら false */
export function saveChat(userId: number, chat: AiChat) {
  const res = db
    .update(aiChats)
    .set({ content: sealChat(userId, chat.content) })
    .where(and(eq(aiChats.id, chat.id), eq(aiChats.userId, userId)))
    .run()
  return res.changes > 0
}

export const closeChat = (userId: number) => db.delete(aiChats).where(eq(aiChats.userId, userId)).run()
