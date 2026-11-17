import { Button } from '../../components/button'
import { CollabWorkspace, OwnerSwitcher, type OwnerChoice } from '../../components/collab'
import { ItemBar } from '../../components/course'
import { AppShell } from '../../components/layout'
import { COLLAB_KIND_LABELS, type CollabOwner, type CollabSettings } from '../../lib/collab'
import type { CourseAccess } from '../../lib/courses'

/** 共同編集のエディターの画面。アイテムの画面の「開く」から開く */
export const CollabPage = ({
  access,
  item,
  itemUrl,
  settings,
  owner,
  ownerLabel,
  choices,
  user,
}: {
  access: CourseAccess
  item: { id: number; title: string }
  /** アイテムの画面（戻る先） */
  itemUrl: string
  settings: CollabSettings
  owner: CollabOwner
  /** 開いているファイルがだれのものか（教師が学生のファイルを開いたとき） */
  ownerLabel?: string
  /** 学生ごとのときの教師が切り替えられるファイル */
  choices?: OwnerChoice[]
  user: { id: number; name: string }
}) => {
  const href = `${itemUrl}/collab`
  const note =
    owner === 'template'
      ? '学生が最初に開いたときの中身（ひな形）を編集しています。すでに開いた学生のファイルは変わりません。'
      : ownerLabel
        ? `${ownerLabel}のファイルを開いています。学生と同時に編集できます。`
        : undefined
  return (
    <AppShell
      tone={access.course.color}
      topbar={
        <ItemBar
          type="collab"
          crumbs={[
            { href: '/courses', label: 'コース一覧' },
            { href: `/courses/${access.course.id}`, label: access.course.title },
            { href: itemUrl, label: item.title },
          ]}
          title={`${item.title}（${COLLAB_KIND_LABELS[settings.kind]}）`}
        >
          {choices && <OwnerSwitcher href={href} current={owner} choices={choices} />}
          {access.canManage && (
            <Button href={`${itemUrl}/edit`} variant="ghost" size="sm" icon="pencil" aria-label="編集">
              <span class="hide-sm">編集</span>
            </Button>
          )}
        </ItemBar>
      }
    >
      <CollabWorkspace
        kind={settings.kind}
        courseId={access.course.id}
        itemId={item.id}
        owner={owner}
        user={user}
        title={item.title}
        imageBase={`${href}/images`}
        canImport={access.canManage}
        note={note}
      />
    </AppShell>
  )
}
