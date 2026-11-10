import type { FC } from 'hono/jsx'
import { Button } from '../components/button'
import { LinkCard } from '../components/card'
import type { IconName } from '../components/icons'
import { Chip } from '../components/ui'
import type { CourseAccess } from '../lib/courses'
import type { FieldErrors, FormName } from '../lib/forms'
import { isSharing } from '../lib/screen-share'
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
  /**
   * 付けると、一覧や目次からはアイテムの画面ではなく、その下のこのパスの画面を新しいタブで開く。
   * Moodle の画面からも新しいタブで開き、/m/<key> からもこの画面に移る
   */
  tabPath?: string
  /** 一覧に「配信中」を出すか。引数は活動の cmid */
  isLive?: (cmid: number) => boolean
}

const SCREEN_PATH = 'screen'

const screen: ExtraKind = {
  label: '画面共有',
  description: '授業中に画面を配信する',
  icon: 'monitor',
  form: 'extraItem',
  toData: () => ({}),
  Fields: () => null,
  View: ({ item, access }) => (
    <LinkCard
      href={`/courses/${access.course.id}/items/${item.id}/${SCREEN_PATH}`}
      icon="monitor"
      class="link-card-lg kind-extra"
      target="_blank"
      rel="noopener"
      data-no-prefetch
    >
      <span class="file-name">
        <span class="strong">画面共有を開く</span>
        <span class="muted small truncate">別のタブで開きます</span>
      </span>
      {item.extra?.live && <Chip tone="live">配信中</Chip>}
      <Button as="span" variant="primary" iconEnd="external">
        開く
      </Button>
    </LinkCard>
  ),
  tabPath: SCREEN_PATH,
  isLive: isSharing,
}

export const EXTRA_KINDS: Record<string, ExtraKind> = { screen }

export const extraKindOf = (type: string): ExtraKind | null => (Object.hasOwn(EXTRA_KINDS, type) ? EXTRA_KINDS[type] : null)
