import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { AI_CHAT_TTL } from './ai-chat'
import type { AiFileStore } from './ai-tool-kit'
import { db } from '../../lib/db'
import { aiUploads } from '../../lib/schema'
import { deleteKeys, inBackground, moveToCourse, putAiUpload, type StoredFile } from '../../lib/storage'

export type AiUpload = typeof aiUploads.$inferSelect

const unixNow = () => Math.floor(Date.now() / 1000)

// 定期的に消す仕組みを持たないのは、受け取るたびに期限切れを消せば足り、残っていても受け取った本人の AI にしか使えないため
function purgeExpired() {
  const expired = db
    .select({ id: aiUploads.id, fileKey: aiUploads.fileKey })
    .from(aiUploads)
    .where(lt(aiUploads.createdAt, unixNow() - AI_CHAT_TTL))
    .limit(200)
    .all()
  if (expired.length === 0) return
  db.delete(aiUploads)
    .where(
      inArray(
        aiUploads.id,
        expired.map((u) => u.id),
      ),
    )
    .run()
  inBackground(deleteKeys(expired.map((u) => u.fileKey)))
}

/** 通常モードで AI が受け取ったファイル。使うまでストレージの ai-uploads/ に置く */
export const aiUploadStore: AiFileStore = {
  async receive(c, file) {
    purgeExpired()
    const userId = c.var.user!.id
    const stored = await putAiUpload(userId, file)
    return db
      .insert(aiUploads)
      .values({ userId, fileKey: stored.key, fileName: stored.name, fileSize: stored.size, fileType: stored.type })
      .returning({ id: aiUploads.id })
      .get().id
  },
}

/** 利用者が受け取った、期限内のファイル */
export const findUpload = (userId: number, uploadId: number) =>
  db
    .select()
    .from(aiUploads)
    .where(and(eq(aiUploads.id, uploadId), eq(aiUploads.userId, userId), gte(aiUploads.createdAt, unixNow() - AI_CHAT_TTL)))
    .get()

/** 受け取ったファイルをコースのファイルにする。同じファイルを 2 つのアイテムで使えないよう、受け取った記録は消す */
export async function adoptUpload(upload: AiUpload, courseId: number): Promise<StoredFile> {
  const key = await moveToCourse(courseId, upload.fileKey, upload.fileName)
  db.delete(aiUploads).where(eq(aiUploads.id, upload.id)).run()
  return { key, name: upload.fileName, size: upload.fileSize, type: upload.fileType }
}
