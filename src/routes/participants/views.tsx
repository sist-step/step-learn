import { CourseHeader } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { Block, Table } from '../../components/card'
import { Input, SegmentedControl, Select } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Modal } from '../../components/overlay'
import { Styles } from '../../components/style'
import { Avatar, Chip, Person, Progress, formatDate, userMeta } from '../../components/ui'
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
      {users.length > CANDIDATE_LIMIT && <p class="candidates-note muted small">ほかにも一致するユーザーがいます。さらに絞り込んでください。</p>}
    </>
  )
}

const AddParticipant = ({ courseId }: { courseId: number }) => (
  <div class="participants-toolbar">
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
  </div>
)

type TableProps = { courseId: number; meId: number; manage: boolean; totalItems: number }

const ParticipantRow = ({ p, courseId, meId, manage, totalItems }: TableProps & { p: Participant }) => (
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
    {manage && (
      <td class="hide-sm progress-cell">{p.role === 'student' ? <Progress done={p.done} total={totalItems} /> : <span class="muted">—</span>}</td>
    )}
    <td class="hide-sm muted">{formatDate(p.createdAt)}</td>
    <td>
      {manage ? (
        <div class="row-actions">
          <form method="post" action={`/courses/${courseId}/participants/${p.id}/role`} data-autosubmit>
            <Select name="role" compact options={ROLE_OPTIONS} value={p.role} aria-label={`${p.name} のロール`} />
          </form>
          <form method="post" action={`/courses/${courseId}/participants/${p.id}/remove`} data-confirm={`${p.name} さんをコースから外しますか？`}>
            <IconButton type="submit" icon="x" label="コースから外す" danger />
          </form>
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
      <p class="muted small">まだいません。</p>
    ) : (
      <Table
        columns={[
          { label: '名前' },
          props.manage && { label: '進捗', class: 'hide-sm' },
          { label: '参加日', class: 'hide-sm' },
          { label: props.manage ? '操作' : 'ロール' },
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
    <AppShell wide>
      <Styles use={['/src/routes/participants/participants.css']} />
      <CourseHeader access={access} tab="participants" />
      {access.canManage && <AddParticipant courseId={access.course.id} />}
      <ParticipantTable heading="教師" list={people.filter((p) => p.role === 'teacher')} {...props} />
      <ParticipantTable heading="学生" list={people.filter((p) => p.role === 'student')} {...props} />
    </AppShell>
  )
}
