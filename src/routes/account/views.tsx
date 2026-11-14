import { Button } from '../../components/button'
import { Card } from '../../components/card'
import { TextField, validateWith } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Avatar, Chip, PageHeader, Person, userMeta } from '../../components/ui'
import type { FieldErrors } from '../../lib/forms'
import { PASSWORD_HINT } from '../../lib/password'
import { ROLE_LABELS, type User } from '../../lib/types'
import { USERNAME_HINT } from '../../lib/username'

export type Profile = { name: string; username: string }

/** microsoft は、Microsoft アカウントでのログインを使えないサーバーでは null */
export type AccountSecurity = { hasPassword: boolean; microsoft: { account: { email: string } | null } | null }

const PasswordCard = ({ user, hasPassword, errors }: { user: User; hasPassword: boolean; errors: FieldErrors }) =>
  hasPassword ? (
    <Card heading="パスワード" description="変更すると、ほかの端末のセッションはすべてログアウトされます。">
      <form method="post" action="/account/password" class="stack" data-loading-form {...validateWith('password')}>
        <TextField label="現在のパスワード" name="current" type="password" error={errors.current} autocomplete="current-password" />
        <TextField
          label="新しいパスワード"
          name="password"
          type="password"
          error={errors.password}
          hint={PASSWORD_HINT}
          autocomplete="new-password"
        />
        <div class="form-actions">
          <Button type="submit" variant="primary">
            パスワードを変更
          </Button>
        </div>
      </form>
    </Card>
  ) : (
    <Card
      heading="パスワード"
      description="まだ設定されていません。設定すると、メールアドレスかユーザー名とパスワードでもログインできます。"
    >
      <form method="post" action="/account/password" class="stack" data-loading-form {...validateWith('setPassword')}>
        {/* パスワードマネージャーがメールアドレスと組にして保存できるようにする */}
        <input type="hidden" name="email" value={user.email} autocomplete="username" />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          error={errors.password}
          hint={PASSWORD_HINT}
          autocomplete="new-password"
        />
        <div class="form-actions">
          <Button type="submit" variant="primary">
            パスワードを設定
          </Button>
        </div>
      </form>
    </Card>
  )

const MicrosoftCard = ({ account, hasPassword }: { account: { email: string } | null; hasPassword: boolean }) =>
  account ? (
    <Card
      heading="Microsoft アカウント"
      description={
        hasPassword
          ? `${account.email || 'Microsoft アカウント'} と連携しています。`
          : `${account.email || 'Microsoft アカウント'} と連携しています。連携を解除するには、先にパスワードを設定してください。`
      }
      actions={
        <form method="post" action="/account/microsoft/unlink" data-confirm="Microsoft アカウントの連携を解除しますか？">
          <Button type="submit" variant="danger-outline" disabled={!hasPassword}>
            連携を解除
          </Button>
        </form>
      }
    />
  ) : (
    <Card
      heading="Microsoft アカウント"
      description="連携すると、ログイン画面の「Microsoft アカウントでログイン」からもログインできます。"
      actions={
        // 再読み込みなしの遷移にしないのは、Microsoft のサインイン画面へ移るので、fetch ではリダイレクト先を読めないため
        <form method="post" action="/account/microsoft" data-reload>
          <Button type="submit">連携する</Button>
        </form>
      }
    />
  )

export const AccountPage = ({
  user,
  security,
  errors = {},
  values,
}: {
  user: User
  security: AccountSecurity
  errors?: FieldErrors
  values?: Profile
}) => (
  <AppShell>
    <Styles use={['/src/routes/account/account.css']} />
    <PageHeader title="アカウント" description="プロフィールとセキュリティの設定" />
    <div class="account-layout">
      <div class="account-hero">
        <Person avatar={<Avatar name={user.name} size={56} />} name={user.name} meta={userMeta(user)} />
        <Chip tone={user.role === 'student' ? 'default' : 'accent'}>{ROLE_LABELS[user.role]}</Chip>
      </div>

      <Card heading="プロフィール" description="コースの参加者一覧などに表示されます。">
        <form method="post" action="/account" class="stack" data-loading-form {...validateWith('profile')}>
          <div class="grid-2">
            <TextField label="氏名" name="name" value={values?.name ?? user.name} error={errors.name} />
            <TextField
              label="ユーザー名"
              name="username"
              value={values?.username ?? user.username ?? ''}
              error={errors.username}
              hint={user.username ? USERNAME_HINT : `まだ設定されていません。${USERNAME_HINT}`}
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
            />
          </div>
          <div class="form-actions">
            <Button type="submit" variant="primary">
              保存
            </Button>
          </div>
        </form>
      </Card>

      <PasswordCard user={user} hasPassword={security.hasPassword} errors={errors} />

      {security.microsoft && <MicrosoftCard account={security.microsoft.account} hasPassword={security.hasPassword} />}
    </div>
  </AppShell>
)
