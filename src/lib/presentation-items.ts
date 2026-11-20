import { eq } from 'drizzle-orm'
import { db } from './db'
import { EMPTY_PRESENTATION, type PresentationState, type PresentationStore } from './presentation'
import { items, presentationItems } from './schema'

export const PRESENTATION_REF_PREFIX = 'presentation-'

/** 通常モードの置き場所。PDF は items の file_key に、スライドの対応と公開の状態は presentation_items に置く */
export function presentationStore(itemId: number): PresentationStore {
  return {
    get() {
      const file = db.select({ fileKey: items.fileKey, fileSize: items.fileSize }).from(items).where(eq(items.id, itemId)).get()
      const row = db.select().from(presentationItems).where(eq(presentationItems.itemId, itemId)).get()
      if (!row) return { ...EMPTY_PRESENTATION, fileKey: file?.fileKey ?? null, fileSize: file?.fileSize ?? 0 }
      const { itemId: _, allReleased, ...state } = row
      return { ...state, allReleased: allReleased === 1, fileKey: file?.fileKey ?? null, fileSize: file?.fileSize ?? 0 }
    },
    save({ fileKey, fileSize, allReleased, ...patch }: Partial<PresentationState>) {
      const row = { ...patch, ...(allReleased !== undefined && { allReleased: allReleased ? 1 : 0 }) }
      db.transaction((tx) => {
        if (fileKey !== undefined)
          tx.update(items)
            .set({
              fileKey,
              fileSize: fileSize ?? 0,
              fileName: fileKey ? 'slides.pdf' : null,
              fileType: fileKey ? 'application/pdf' : null,
            })
            .where(eq(items.id, itemId))
            .run()
        if (Object.keys(row).length === 0) return
        tx.insert(presentationItems)
          .values({ itemId, ...row })
          .onConflictDoUpdate({ target: presentationItems.itemId, set: row })
          .run()
      })
    },
  }
}
