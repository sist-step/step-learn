import { CourseHeader } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { Block, Card, DangerRow, Table } from '../../components/card'
import { TextField, validateWith } from '../../components/form'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Avatar, EmptyState, Person, TabPanel, userMeta } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import type { FieldErrors } from '../../lib/forms'
import { COURSE_ROLE_LABELS, type CourseRole } from '../../lib/types'

export type GroupRow = { id: number; name: string; members: number }

const BackToParticipants = ({ courseId }: { courseId: number }) => (
  <a href={`/courses/${courseId}/participants`} class="back-link">
    <Icon name="chevronLeft" size={16} />
    参加者
  </a>
)

export const GroupsPage = ({
  access,
  groups,
  name = '',
  errors = {},
}: {
  access: CourseAccess
  groups: GroupRow[]
  name?: string
  errors?: FieldErrors
}) => {
  const id = access.course.id
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/features/groups/groups.css']} />
      <CourseHeader access={access} tab="participants" />
      <TabPanel>
        <div class="stack">
          <BackToParticipants courseId={id} />
          <Card
            heading="グループを作成"
            description="作ったグループに参加者を入れると、アクセス制限の条件にできます。1 人が複数のグループに入れます。"
          >
            <form method="post" action={`/courses/${id}/groups`} class="group-create" data-loading-form {...validateWith('courseGroup')}>
              <TextField
                label="グループ名"
                name="name"
                value={name}
                error={errors.name}
                autocomplete="off"
                fieldClass="group-create-name"
              />
              <Button type="submit" variant="primary" icon="plus">
                作成
              </Button>
            </form>
          </Card>
          <Block heading="グループ" count={groups.length}>
            {groups.length === 0 ? (
              <EmptyState icon="userGroup" title="まだグループがありません" text="上の欄に名前を入れて作成してください。" />
            ) : (
              <Table columns={[{ label: 'グループ' }, { label: 'メンバー', class: 'num' }, { label: '操作', srOnly: true }]}>
                {groups.map((g) => (
                  <tr>
                    <td>
                      <a href={`/courses/${id}/groups/${g.id}`} class="strong">
                        {g.name}
                      </a>
                    </td>
                    <td class="num muted">{g.members}</td>
                    <td>
                      <div class="row-actions">
                        <IconButton href={`/courses/${id}/groups/${g.id}`} icon="pencil" label={`「${g.name}」を編集`} title="編集" />
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Block>
        </div>
      </TabPanel>
    </AppShell>
  )
}

export type GroupCandidate = { id: number; name: string; username: string | null; role: CourseRole }

const MemberList = ({ role, people, checked }: { role: CourseRole; people: GroupCandidate[]; checked: Set<number> }) => {
  const list = people.filter((p) => p.role === role)
  const label = COURSE_ROLE_LABELS[role]
  return (
    <Block heading={label} count={list.length}>
      {list.length === 0 ? (
        <p class="muted small">{label}はいません。</p>
      ) : (
        <div class="table-card" data-check-scope>
          <ul class="group-members">
            <li class="group-member group-member-all">
              <label>
                <input type="checkbox" class="group-check" data-check-all="members" />
                <span class="small strong">{label}をすべて選ぶ</span>
              </label>
            </li>
            {list.map((p) => (
              <li class="group-member">
                <label>
                  <input type="checkbox" class="group-check" name="members" value={String(p.id)} checked={checked.has(p.id)} />
                  <Person avatar={<Avatar name={p.name} />} name={p.name} meta={userMeta({ username: p.username })} />
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Block>
  )
}

export const GroupPage = ({
  access,
  group,
  people,
  members,
  name,
  errors = {},
}: {
  access: CourseAccess
  group: { id: number; name: string }
  people: GroupCandidate[]
  members: Set<number>
  name: string
  errors?: FieldErrors
}) => {
  const id = access.course.id
  const action = `/courses/${id}/groups/${group.id}`
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/features/groups/groups.css']} />
      <CourseHeader access={access} tab="participants" />
      <TabPanel>
        <div class="stack">
          <a href={`/courses/${id}/groups`} class="back-link">
            <Icon name="chevronLeft" size={16} />
            グループ
          </a>
          <form method="post" action={action} class="stack" data-loading-form {...validateWith('courseGroupEdit')}>
            <Card heading={`「${group.name}」を編集`} description="チェックを入れた参加者がこのグループのメンバーになります。">
              <TextField label="グループ名" name="name" value={name} error={errors.name} autocomplete="off" />
            </Card>
            <MemberList role="student" people={people} checked={members} />
            <MemberList role="teacher" people={people} checked={members} />
            <div class="form-actions">
              <Button href={`/courses/${id}/groups`} variant="ghost">
                キャンセル
              </Button>
              <Button type="submit" variant="primary" data-save-shortcut>
                保存
              </Button>
            </div>
          </form>
          <Card tone="danger" heading="危険な操作" description="これらの操作は取り消せません。">
            <DangerRow
              heading="グループを削除"
              description="メンバーの登録も消えます。このグループを条件にしたアクセス制限は、だれも満たせなくなります。"
            >
              <form method="post" action={`${action}/delete`} data-confirm={`「${group.name}」を削除しますか？`} data-confirm-ok="削除する">
                <Button type="submit" variant="danger-outline">
                  削除
                </Button>
              </form>
            </DangerRow>
          </Card>
        </div>
      </TabPanel>
    </AppShell>
  )
}
