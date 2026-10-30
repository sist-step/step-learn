import { Button } from '../../components/button'
import { Card } from '../../components/card'
import { TextField } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Avatar, PageHeader } from '../../components/ui'
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH } from '../../lib/password'
import { ROLE_LABELS, type User } from '../../lib/types'
import { USERNAME_HINT, USERNAME_MAX_LENGTH } from '../../lib/username'

export type Errors = Partial<Record<'name' | 'username' | 'current' | 'password', string>>

export type Profile = { name: string; username: string }

export const AccountPage = ({ user, errors = {}, values }: { user: User; errors?: Errors; values?: Profile }) => (
  <AppShell>
    <Styles use={['/src/routes/account/account.css']} />
    <PageHeader title="アカウント" description="プロフィールとセキュリティの設定" />
    <div class="settings-grid">
      <Card heading="プロフィール" description="コースの参加者一覧などに表示されます。">
        <div class="profile-row">
          <Avatar name={user.name} size={56} />
          <div>
            <div class="strong">{user.name}</div>
            <div class="muted small">
              {user.username && `@${user.username} · `}
              {user.email} · {ROLE_LABELS[user.role]}
            </div>
          </div>
        </div>
        <form method="post" action="/account" class="stack" data-loading-form>
          <TextField label="氏名" name="name" value={values?.name ?? user.name} error={errors.name} required maxlength={60} />
          <TextField
            label="ユーザー名"
            name="username"
            value={values?.username ?? user.username ?? ''}
            error={errors.username}
            hint={user.username ? USERNAME_HINT : `まだ設定されていません。${USERNAME_HINT}`}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            required
            maxlength={USERNAME_MAX_LENGTH}
          />
          <div class="form-actions">
            <Button type="submit" variant="primary">
              保存
            </Button>
          </div>
        </form>
      </Card>

      <Card heading="パスワード" description="変更すると、ほかの端末のセッションはすべてログアウトされます。">
        <form method="post" action="/account/password" class="stack" data-loading-form>
          <TextField label="現在のパスワード" name="current" type="password" error={errors.current} autocomplete="current-password" required />
          <TextField
            label="新しいパスワード"
            name="password"
            type="password"
            error={errors.password}
            hint={PASSWORD_HINT}
            autocomplete="new-password"
            required
            minlength={PASSWORD_MIN_LENGTH}
          />
          <div class="form-actions">
            <Button type="submit" variant="primary">
              パスワードを変更
            </Button>
          </div>
        </form>
      </Card>
    </div>
  </AppShell>
)
