import { AuthShell } from '../../components/layout'
import { Button } from '../../components/button'
import { TextField, validateWith } from '../../components/form'
import { Alert, TabPanel, Tabs } from '../../components/ui'
import type { FieldErrors } from '../../lib/forms'
import { PASSWORD_HINT } from '../../lib/password'
import { USERNAME_HINT } from '../../lib/username'

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

export const LoginPage = ({ login = '', next = '', errors = {} }: { login?: string; next?: string; errors?: FieldErrors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
      <AuthTabs current="login" next={next} />
      <TabPanel>
        <FormError message={errors.form} />
        <form method="post" action="/login" class="stack" data-loading-form {...validateWith('login')}>
          <input type="hidden" name="next" value={next} />
          <TextField
            label="メールアドレスまたはユーザー名"
            name="login"
            value={login}
            error={errors.login}
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            autofocus={!login}
          />
          <TextField
            label="パスワード"
            name="password"
            type="password"
            error={errors.password}
            autocomplete="current-password"
            autofocus={!!login}
          />
          <Button type="submit" variant="primary" size="lg" block>
            ログイン
          </Button>
        </form>
        <p class="auth-switch">
          <a href="/password/forgot">パスワードを忘れた場合</a>
        </p>
      </TabPanel>
    </div>
  </AuthShell>
)

export const RegisterPage = ({ email = '', next = '', errors = {} }: { email?: string; next?: string; errors?: FieldErrors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>アカウントを作成</h1>
      <AuthTabs current="register" next={next} />
      <TabPanel>
        <FormError message={errors.form} />
        <form method="post" action="/register" class="stack" data-loading-form {...validateWith('register')}>
          <input type="hidden" name="next" value={next} />
          <TextField label="メールアドレス" name="email" type="email" value={email} error={errors.email} autocomplete="email" autofocus />
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
  errors?: FieldErrors
}) => (
  <AuthShell>
    <div class="auth-card">
      <h1>登録を完了する</h1>
      <p class="muted">{email} で登録します。氏名・ユーザー名・パスワードを設定してください。</p>
      <FormError message={errors.form} />
      <form method="post" action="/register/complete" class="stack" data-loading-form {...validateWith('completeRegister')}>
        <input type="hidden" name="token" value={token} />
        {/* パスワードマネージャーがメールアドレスと組にして保存できるようにする */}
        <input type="hidden" name="email" value={email} autocomplete="username" />
        <TextField label="氏名" name="name" value={name} error={errors.name} autocomplete="name" autofocus />
        <TextField
          label="ユーザー名"
          name="username"
          value={username}
          error={errors.username}
          hint={USERNAME_HINT}
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          error={errors.password}
          hint={PASSWORD_HINT}
          autocomplete="new-password"
        />
        <Button type="submit" variant="primary" size="lg" block>
          登録してはじめる
        </Button>
      </form>
    </div>
  </AuthShell>
)

const RETRY = {
  register: { text: 'もう一度登録をやり直してください。', href: '/register', label: '新規登録へ' },
  reset: { text: 'もう一度パスワードの再設定をやり直してください。', href: '/password/forgot', label: 'パスワードの再設定へ' },
} as const

export const InvalidLinkPage = ({ retry }: { retry: keyof typeof RETRY }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>リンクが無効です</h1>
      <p class="muted">リンクの有効期限が切れているか、すでに使われています。お手数ですが、{RETRY[retry].text}</p>
      <Button href={RETRY[retry].href} variant="primary" size="lg" block>
        {RETRY[retry].label}
      </Button>
    </div>
  </AuthShell>
)

export const ForgotPasswordPage = ({ email = '', errors = {} }: { email?: string; errors?: FieldErrors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>パスワードの再設定</h1>
      <p class="muted">登録しているメールアドレスを入力してください。パスワードを設定し直すためのリンクを送ります。</p>
      <FormError message={errors.form} />
      <form method="post" action="/password/forgot" class="stack" data-loading-form {...validateWith('forgotPassword')}>
        <TextField label="メールアドレス" name="email" type="email" value={email} error={errors.email} autocomplete="email" autofocus />
        <Button type="submit" variant="primary" size="lg" block>
          再設定のメールを送る
        </Button>
      </form>
      <p class="auth-switch">
        <a href="/login">ログインに戻る</a>
      </p>
    </div>
  </AuthShell>
)

export const ForgotPasswordSentPage = ({ email }: { email: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>メールを確認してください</h1>
      <p class="muted">
        {email}{' '}
        が登録されていれば、パスワードを再設定するためのメールを送信しました。メールに記載されたリンクから、1時間以内に設定してください。
        届かない場合は、迷惑メールフォルダを確認するか、メールアドレスを確かめて再度お試しください。
      </p>
      <p class="auth-switch">
        <a href="/password/forgot">メールアドレスを入力し直す</a>
      </p>
    </div>
  </AuthShell>
)

export const ResetPasswordPage = ({ token, email, errors = {} }: { token: string; email: string; errors?: FieldErrors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>新しいパスワードを設定</h1>
      <p class="muted">{email} のパスワードを設定します。設定すると、ほかの端末ではログアウトされます。</p>
      <FormError message={errors.form} />
      <form method="post" action="/password/reset" class="stack" data-loading-form {...validateWith('resetPassword')}>
        <input type="hidden" name="token" value={token} />
        {/* パスワードマネージャーがメールアドレスと組にして保存できるようにする */}
        <input type="hidden" name="email" value={email} autocomplete="username" />
        <TextField
          label="新しいパスワード"
          name="password"
          type="password"
          error={errors.password}
          hint={PASSWORD_HINT}
          autocomplete="new-password"
          autofocus
        />
        <Button type="submit" variant="primary" size="lg" block>
          パスワードを設定する
        </Button>
      </form>
    </div>
  </AuthShell>
)
