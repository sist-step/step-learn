import type { IconName } from '../../components/icons'
import type { MascotLook, MascotMood, MascotMotion, MascotPose, MascotProp } from '../../components/mascot'
import type { AiActivity } from './ai-agent'

/**
 * AI のパネルのヘッダーにいるマスコットの状態（features/ai/components/ai-panel.tsx の AiBuddy、client.ts の setAiBuddy）。
 * AiActivity はツールを使っているあいだ。think は応答を待つ・write は本文を書く・summarize は会話を要約する・
 * ask は確認カードか質問カードを、wait-file はファイルを選ぶカードを待つ・break と doze は手が空いて時間がたったところ・
 * applied / done / error / stopped は少しのあいだだけ見せる反応
 */
export type AiBuddyState =
  AiActivity | 'idle' | 'break' | 'doze' | 'think' | 'write' | 'summarize' | 'ask' | 'wait-file' | 'applied' | 'done' | 'error' | 'stopped'

type AiBuddyLook = { mood: MascotMood; pose: MascotPose; motion: MascotMotion; look: MascotLook; prop: MascotProp }

export const AI_BUDDY_LOOKS: Record<AiBuddyState, AiBuddyLook> = {
  idle: { mood: 'normal', pose: 'idle', motion: 'float', look: 'front', prop: 'none' },
  break: { mood: 'happy', pose: 'sip', motion: 'float', look: 'front', prop: 'mug' },
  doze: { mood: 'sleepy', pose: 'idle', motion: 'float', look: 'front', prop: 'none' },
  think: { mood: 'thinking', pose: 'idle', motion: 'tilt', look: 'up', prop: 'none' },
  write: { mood: 'normal', pose: 'type', motion: 'none', look: 'down', prop: 'laptop' },
  summarize: { mood: 'thinking', pose: 'hold', motion: 'nod', look: 'down', prop: 'book' },
  courses: { mood: 'normal', pose: 'idle', motion: 'none', look: 'front', prop: 'magnifier' },
  course: { mood: 'surprised', pose: 'hold', motion: 'none', look: 'down', prop: 'magnifier' },
  item: { mood: 'normal', pose: 'hold', motion: 'none', look: 'down', prop: 'book' },
  file: { mood: 'surprised', pose: 'hold', motion: 'none', look: 'down', prop: 'book' },
  docs: { mood: 'thinking', pose: 'idle', motion: 'none', look: 'up', prop: 'magnifier' },
  doc: { mood: 'normal', pose: 'hold', motion: 'nod', look: 'down', prop: 'book' },
  create: { mood: 'happy', pose: 'type', motion: 'none', look: 'down', prop: 'laptop' },
  arrange: { mood: 'normal', pose: 'open', motion: 'wiggle', look: 'down', prop: 'none' },
  propose: { mood: 'thinking', pose: 'type', motion: 'none', look: 'down', prop: 'laptop' },
  request: { mood: 'normal', pose: 'open', motion: 'float', look: 'front', prop: 'none' },
  question: { mood: 'thinking', pose: 'hold', motion: 'nod', look: 'down', prop: 'notes' },
  apply: { mood: 'happy', pose: 'type', motion: 'none', look: 'down', prop: 'laptop' },
  ask: { mood: 'normal', pose: 'raise', motion: 'bounce', look: 'down', prop: 'none' },
  'wait-file': { mood: 'normal', pose: 'open', motion: 'bounce', look: 'down', prop: 'none' },
  applied: { mood: 'happy', pose: 'cheer', motion: 'hop', look: 'front', prop: 'none' },
  done: { mood: 'happy', pose: 'idle', motion: 'nod', look: 'front', prop: 'none' },
  error: { mood: 'sad', pose: 'idle', motion: 'shake', look: 'down', prop: 'none' },
  stopped: { mood: 'surprised', pose: 'open', motion: 'none', look: 'front', prop: 'none' },
}

/** マスコットの横に出す小さな印。think は印ではなく点の並び（ai-panel.tsx） */
export const AI_BUDDY_MARKS: Partial<Record<AiBuddyState, IconName>> = {
  courses: 'academicCap',
  course: 'folder',
  item: 'page',
  file: 'file',
  docs: 'search',
  doc: 'book',
  create: 'plus',
  arrange: 'sort',
  propose: 'pencil',
  request: 'upload',
  question: 'question',
  apply: 'check',
  summarize: 'note',
  ask: 'question',
  'wait-file': 'upload',
  applied: 'sparkles',
  error: 'alert',
  stopped: 'stop',
}

/** 応答を作っているあいだ、会話の最後の行に出す文言 */
export const AI_BUDDY_LABELS: Partial<Record<AiBuddyState, string>> = {
  think: '考えています…',
  summarize: 'これまでの会話を要約しています…',
  courses: 'コースの一覧を見ています…',
  course: 'コースの中身を見ています…',
  item: 'アイテムを読んでいます…',
  file: 'ファイルを読んでいます…',
  docs: 'STEP Docs を調べています…',
  doc: 'STEP Docs を読んでいます…',
  create: '追加の案を作っています…',
  arrange: '並べ替えの案を作っています…',
  propose: '変更の案を作っています…',
  request: 'ファイルを頼んでいます…',
  question: '質問を考えています…',
  apply: '実行しています…',
}
