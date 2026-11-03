import { CourseHeader } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { Block, Table } from '../../components/card'
import { Input, SegmentedControl, Select } from '../../components/form'
import { AppShell } from '../../components/layout'
import { MenuItem, Modal, Popover } from '../../components/overlay'
import { Styles } from '../../components/style'
import { Avatar, Chip, EmptyState, Person, Progress, TabPanel, formatDate, userMeta } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import { COURSE_ROLE_LABELS, type CourseRole } from '../../lib/types'

export type Participant = {
  id: number
  name: string
  username: string | null
  email: string
  role: CourseRole
  createdAt: number
  done: number
}

export type Candidate = {
  id: number
  name: string
  username: string | null
  email: string
  role: CourseRole | null
}

export const CANDIDATE_LIMIT = 20
const ADD_MODAL = 'add-participant'
const ADD_RESULTS = 'add-participant-results'

const ROLE_OPTIONS = (['student', 'teacher'] as CourseRole[]).map((r) => ({ value: r, label: COURSE_ROLE_LABELS[r] }))

export const Candidates = ({ q, users }: { q: string; users: Candidate[] }) => {
  if (!q) return <p class="candidates-note muted small">名前・ユーザー名・メールアドレスの一部を入力してください。</p>
  if (users.length === 0) return <p class="candidates-note muted small">「{q}」に一致するユーザーはいません。</p>
  return (
    <>
      <ul class="candidates">
        {users.slice(0, CANDIDATE_LIMIT).map((u) => (
          <li class="candidate">
            <Person avatar={<Avatar name={u.name} />} name={u.name} meta={userMeta(u)} />
            {u.role ? (
              <Chip>{COURSE_ROLE_LABELS[u.role]}として参加中</Chip>
            ) : (
              <Button type="submit" size="sm" icon="plus" name="user_id" value={String(u.id)} aria-label={`${u.name} さんを追加`}>
                追加
              </Button>
            )}
          </li>
        ))}
      </ul>
      {users.length > CANDIDATE_LIMIT && (
        <p class="candidates-note muted small">ほかにも一致するユーザーがいます。さらに絞り込んでください。</p>
      )}
    </>
  )
}

const AddParticipant = ({ courseId }: { courseId: number }) => (
  <>
    <Button variant="primary" icon="plus" popovertarget={ADD_MODAL}>
      参加者を追加
    </Button>
    <Modal id={ADD_MODAL} heading="参加者を追加" description="登録済みのユーザーを検索して、このコースに追加します。">
      <div class="stack">
        <Input
          type="search"
          placeholder="名前・ユーザー名・メールアドレスで検索"
          aria-label="ユーザーを検索"
          aria-controls={ADD_RESULTS}
          autocomplete="off"
          autofocus
          data-user-search={`/courses/${courseId}/participants/candidates`}
        />
        <form method="post" action={`/courses/${courseId}/participants`} class="stack" data-loading-form>
          <SegmentedControl name="role" label="追加するロール" options={ROLE_OPTIONS} value="student" />
          <div id={ADD_RESULTS} class="candidates-box" aria-live="polite">
            <Candidates q="" users={[]} />
          </div>
        </form>
      </div>
    </Modal>
  </>
)

type TableProps = { courseId: number; meId: number; manage: boolean; totalItems: number; progress: boolean }

const ParticipantRow = ({ p, courseId, meId, manage, totalItems, progress }: TableProps & { p: Participant }) => (
  <tr>
    <td>
      <Person
        avatar={<Avatar name={p.name} />}
        name={
          <>
            {p.name}
            {p.id === meId && <span class="muted small">（あなた）</span>}
          </>
        }
        meta={userMeta(manage ? p : { username: p.username })}
      />
    </td>
    {progress && (
      <td class="hide-sm col-progress">
        {p.role === 'student' && totalItems > 0 ? <Progress done={p.done} total={totalItems} /> : <span class="muted">—</span>}
      </td>
    )}
    <td class="hide-sm muted col-date">{formatDate(p.createdAt)}</td>
    <td class="col-actions">
      {manage ? (
        <div class="row-actions">
          <form method="post" action={`/courses/${courseId}/participants/${p.id}/role`} data-autosubmit>
            <Select name="role" compact options={ROLE_OPTIONS} value={p.role} aria-label={`${p.name} のロール`} />
          </form>
          <Popover class="row-menu" panelClass="row-menu-panel" trigger={<IconButton as="summary" icon="ellipsis" label="その他の操作" />}>
            <form
              method="post"
              action={`/courses/${courseId}/participants/${p.id}/remove`}
              data-confirm={`${p.name} さんをコースから外しますか？`}
            >
              <MenuItem type="submit" icon="userMinus" class="is-danger">
                コースから外す
              </MenuItem>
            </form>
          </Popover>
        </div>
      ) : (
        <Chip tone={p.role === 'teacher' ? 'accent' : 'default'}>{COURSE_ROLE_LABELS[p.role]}</Chip>
      )}
    </td>
  </tr>
)

const ParticipantTable = ({ heading, list, ...props }: TableProps & { heading: string; list: Participant[] }) => (
  <Block heading={heading} count={list.length}>
    {list.length === 0 ? (
      <EmptyState
        icon="users"
        title={`${heading}はまだいません`}
        text={props.manage ? '「参加者を追加」からユーザーを検索して追加できます。' : 'まだ登録されていません。'}
        action={
          props.manage && (
            <Button size="sm" icon="plus" popovertarget={ADD_MODAL}>
              参加者を追加
            </Button>
          )
        }
      />
    ) : (
      <Table
        columns={[
          { label: '名前' },
          props.progress && { label: '進捗', class: 'hide-sm col-progress' },
          { label: '参加日', class: 'hide-sm col-date' },
          { label: 'ロール', class: 'col-actions' },
        ]}
      >
        {list.map((p) => (
          <ParticipantRow p={p} {...props} />
        ))}
      </Table>
    )}
  </Block>
)

export const ParticipantsPage = ({
  access,
  people,
  meId,
  totalItems,
}: {
  access: CourseAccess
  people: Participant[]
  meId: number
  totalItems: number
}) => {
  const props = { courseId: access.course.id, meId, manage: access.canManage, totalItems }
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/participants/participants.css']} />
      <CourseHeader access={access} tab="participants" tabActions={access.canManage && <AddParticipant courseId={access.course.id} />} />
      <TabPanel>
        <ParticipantTable heading="教師" list={people.filter((p) => p.role === 'teacher')} {...props} progress={false} />
        <ParticipantTable
          heading="学生"
          list={people.filter((p) => p.role === 'student')}
          {...props}
          progress={access.canManage && totalItems > 0}
        />
      </TabPanel>
    </AppShell>
  )
}
