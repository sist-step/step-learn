import { eq } from 'drizzle-orm'
import { EMPTY_PRESENTATION, type PresentationStore } from '../features/presentation/presentation'
import { db } from './db'
import { presentationItems } from './schema'

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの PDF と公開の状態。key は extra_items の key */
export function presentationStore(key: string): PresentationStore {
  return {
    get() {
      const row = db.select().from(presentationItems).where(eq(presentationItems.key, key)).get()
      if (!row) return EMPTY_PRESENTATION
      const { key: _, allReleased, ...state } = row
      return { ...state, allReleased: allReleased === 1 }
    },
    save({ allReleased, ...patch }) {
      const row = { ...patch, ...(allReleased !== undefined && { allReleased: allReleased ? 1 : 0 }) }
      if (Object.keys(row).length === 0) return
      db.insert(presentationItems)
        .values({ key, ...row })
        .onConflictDoUpdate({ target: presentationItems.key, set: row })
        .run()
    },
  }
}
