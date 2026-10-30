import { AuthShell } from '../../components/layout'
import { Button } from '../../components/button'
import { TextField } from '../../components/form'
import { Alert, TabPanel, Tabs } from '../../components/ui'
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH } from '../../lib/password'
import { USERNAME_HINT, USERNAME_MAX_LENGTH } from '../../lib/username'

export type Errors = Partial<Record<'name' | 'username' | 'email' | 'password' | 'form', string>>

const FormError = ({ message }: { message?: string }) => (message ? <Alert>{message}</Alert> : null)

const AuthTabs = ({ current, next }: { current: 'login' | 'register'; next: string }) => {
  const query = next ? `?next=${encodeURIComponent(next)}` : ''
  return (
    <Tabs
      label="ログインと新規登録"
      block
      items={[
        { href: `/login${query}`, label: 'ログイン', active: current === 'login' },
        { href: `/register${query}`, label: '新規登録', active: current === 'register' },
      ]}
    />
  )
}

export const LoginPage = ({ login = '', next = '', errors = {} }: { login?: string; next?: string; errors?: Errors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
      <p class="muted">アカウントにログインして学習を続けましょう。</p>
      <AuthTabs current="login" next={next} />
      <TabPanel>
        <FormError message={errors.form} />
        <form method="post" action="/login" class="stack" data-loading-form>
          <input type="hidden" name="next" value={next} />
          <TextField
            label="メールアドレスまたはユーザー名"
            name="login"
            value={login}
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
            autofocus={!login}
          />
          <TextField
            label="パスワード"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            autofocus={!!login}
          />
          <Button type="submit" variant="primary" size="lg" block>
            ログイン
          </Button>
        </form>
      </TabPanel>
    </div>
  </AuthShell>
)

export const RegisterPage = ({ email = '', next = '', errors = {} }: { email?: string; next?: string; errors?: Errors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>アカウントを作成</h1>
      <p class="muted">メールアドレスに届くリンクから登録を完了してください。</p>
      <AuthTabs current="register" next={next} />
      <TabPanel>
        <FormError message={errors.form} />
        <form method="post" action="/register" class="stack" data-loading-form>
          <input type="hidden" name="next" value={next} />
          <TextField label="メールアドレス" name="email" type="email" value={email} error={errors.email} autocomplete="email" required autofocus />
          <Button type="submit" variant="primary" size="lg" block>
            確認メールを送る
          </Button>
        </form>
      </TabPanel>
    </div>
  </AuthShell>
)

export const RegisterSentPage = ({ email }: { email: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>メールを確認してください</h1>
      <p class="muted">
        {email} 宛てにメールを送信しました。メールに記載されたリンクから、24時間以内に登録を完了してください。
        届かない場合は、迷惑メールフォルダを確認するか、しばらくしてから再度お試しください。
      </p>
      <p class="auth-switch">
        <a href="/register">メールアドレスを入力し直す</a>
      </p>
    </div>
  </AuthShell>
)

export const CompleteRegisterPage = ({
  token,
  email,
  name = '',
  username = '',
  errors = {},
}: {
  token: string
  email: string
  name?: string
  username?: string
  errors?: Errors
}) => (
  <AuthShell>
    <div class="auth-card">
      <h1>登録を完了する</h1>
      <p class="muted">{email} で登録します。氏名・ユーザー名・パスワードを設定してください。</p>
      <FormError message={errors.form} />
      <form method="post" action="/register/complete" class="stack" data-loading-form>
        <input type="hidden" name="token" value={token} />
        {/* パスワードマネージャーがメールアドレスと組にして保存できるようにする */}
        <input type="hidden" name="email" value={email} autocomplete="username" />
        <TextField label="氏名" name="name" value={name} error={errors.name} autocomplete="name" required autofocus maxlength={60} />
        <TextField
          label="ユーザー名"
          name="username"
          value={username}
          error={errors.username}
          hint={USERNAME_HINT}
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          required
          maxlength={USERNAME_MAX_LENGTH}
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          error={errors.password}
          hint={PASSWORD_HINT}
          autocomplete="new-password"
          required
          minlength={PASSWORD_MIN_LENGTH}
        />
        <Button type="submit" variant="primary" size="lg" block>
          登録してはじめる
        </Button>
      </form>
    </div>
  </AuthShell>
)

export const InvalidLinkPage = () => (
  <AuthShell>
    <div class="auth-card">
      <h1>リンクが無効です</h1>
      <p class="muted">リンクの有効期限が切れているか、すでに使われています。お手数ですが、もう一度登録をやり直してください。</p>
      <Button href="/register" variant="primary" size="lg" block>
        新規登録へ
      </Button>
    </div>
  </AuthShell>
)
