import type { FC } from 'hono/jsx'
import type { IconName } from '../components/icons'
import type { CourseAccess } from '../lib/courses'
import type { FieldErrors, FormName } from '../lib/forms'
import type { MItem } from './mapping'

export type ExtraData = Record<string, unknown>

/**
 * Moodle モードだけにある種類のアイテムの定義。中身は moodle-mode.db の extra_items に JSON で保存し、完全移行では引き継がない。
 * 種類を足すときは EXTRA_KINDS に定義を足し、forms.ts に extraItemFields を含むスキーマを登録する
 */
export type ExtraKind = {
  label: string
  /** アイテムを追加するときの種類の説明 */
  description: string
  icon: IconName
  /** 入力の検証に使うスキーマ。extraItemFields（タイトル・学生への表示・完了の条件）を含めて作る */
  form: FormName
  /** 検証を通った値から、保存する中身を作る */
  toData: (values: Record<string, unknown>) => ExtraData
  /** 追加・編集の画面の、種類ごとの入力欄。values は保存済みの中身か、検証で弾かれたときに送られてきたままの値 */
  Fields: FC<{ values: Record<string, unknown>; errors: FieldErrors; idPrefix: string }>
  /** アイテムの画面の本体 */
  View: FC<{ item: MItem; data: ExtraData; access: CourseAccess }>
}

export const EXTRA_KINDS: Record<string, ExtraKind> = {}

export const extraKindOf = (type: string): ExtraKind | null => (Object.hasOwn(EXTRA_KINDS, type) ? EXTRA_KINDS[type] : null)
