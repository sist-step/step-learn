import { openItem } from '../../lib/item-access'
import { getQuizSettings, quizStore } from '../../lib/quiz-items'
import type { QuizBackend } from './handlers'

/** 通常モード: 設定と受験の記録を step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: QuizBackend = {
  async resolve(c) {
    const opened = await openItem(c, 'quiz')
    if (!opened) return null
    const { access, itemId, item } = opened
    return { access, item: { id: itemId, title: item.title }, settings: getQuizSettings(itemId), store: quizStore(item.courseId, itemId) }
  },
}
