import type { LinkTarget } from '../lib/types'

/** Moodle の URL・ファイルの活動の表示方法（resourcelib の RESOURCELIB_DISPLAY_*） */
export const MOODLE_DISPLAYS = { auto: 0, embed: 1, frame: 2, new: 3, download: 4, open: 5, popup: 6 } as const

export type MoodleDisplay = keyof typeof MOODLE_DISPLAYS

const BY_VALUE = new Map(Object.entries(MOODLE_DISPLAYS).map(([name, value]) => [value as number, name as MoodleDisplay]))

export const moodleDisplayOf = (value: number) => BY_VALUE.get(value) ?? null

export const MOODLE_DISPLAY_LABELS: Record<MoodleDisplay, string> = {
  auto: '自動',
  embed: '埋め込み',
  frame: 'フレーム内',
  new: '新しいウィンドウ',
  download: 'ダウンロード',
  open: '開く',
  popup: 'ポップアップ',
}

// 自動を同じタブにするのは、Moodle が自動のときに、ふつうのページの URL を同じウィンドウで開くため（リンクを載せた画面を挟む）。
// フレーム内を埋め込み、ポップアップを新しいタブ、ダウンロードを同じタブにするのは、STEP Learn にない開き方のうち見え方が最も近いため
const TARGET_OF_DISPLAY: Record<MoodleDisplay, LinkTarget> = {
  auto: 'same',
  embed: 'embed',
  frame: 'embed',
  new: 'new',
  download: 'same',
  open: 'same',
  popup: 'new',
}

export const linkTargetOf = (display: MoodleDisplay) => TARGET_OF_DISPLAY[display]

/** STEP Learn の開き方と同じ意味の表示方法か（ほかは近い開き方に読み替えている） */
export const isExactDisplay = (display: MoodleDisplay) => display === 'embed' || display === 'new' || display === 'open'
