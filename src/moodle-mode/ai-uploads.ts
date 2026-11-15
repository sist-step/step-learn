import { and, eq, gte, lt } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AiFileStore } from '../lib/ai-tool-kit'
import type { MoodleEnv } from './auth'
import { uploadDraft } from './client'
import { db } from './db'
import { aiUploads } from './schema'

export type MoodleAiUpload = typeof aiUploads.$inferSelect

// 通常モード（lib/ai-uploads.ts）と同じ期限にしないのは、Moodle が 4 日より古い下書き領域を消し、その後に使うと中身のないファイルの活動ができるため
const AI_UPLOAD_TTL = 3 * 86_400

const unixNow = () => Math.floor(Date.now() / 1000)

// Moodle の下書きを消さないのは、下書き領域は Moodle が期限で消すため
const purgeExpired = () =>
  db
    .delete(aiUploads)
    .where(lt(aiUploads.createdAt, unixNow() - AI_UPLOAD_TTL))
    .run()

/** Moodle モードで AI が受け取ったファイル。利用者の下書き領域に上げ、活動を作るときにその itemid を渡す */
export const moodleAiUploadStore: AiFileStore = {
  async receive(c, file) {
    purgeExpired()
    const draftItemId = await uploadDraft((c as Context<MoodleEnv>).var.token!, file)
    return db
      .insert(aiUploads)
      .values({
        userId: c.var.user!.id,
        draftItemId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
      })
      .returning({ id: aiUploads.id })
      .get().id
  },
}

/** 利用者が受け取った、期限内のファイル */
export const findUpload = (userId: number, uploadId: number) =>
  db
    .select()
    .from(aiUploads)
    .where(and(eq(aiUploads.id, uploadId), eq(aiUploads.userId, userId), gte(aiUploads.createdAt, unixNow() - AI_UPLOAD_TTL)))
    .get()

// 使ったあとも残さないのは、通常モードと同じく 1 つのファイルを 1 つのアイテムにだけ使うことにして、AI への説明をそろえるため
export const consumeUpload = (uploadId: number) => db.delete(aiUploads).where(eq(aiUploads.id, uploadId)).run()
