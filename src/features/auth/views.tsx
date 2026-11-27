import { AuthShell } from '../../components/layout'
import { Button } from '../../components/button'
import { TextField, validateWith } from '../../components/form'
import { Alert } from '../../components/ui'
import type { FieldErrors } from '../../lib/forms'
import { PASSWORD_HINT } from '../../lib/password'
import { USERNAME_HINT } from '../../lib/username'

const FormError = ({ message }: { message?: string }) => (message ? <Alert>{message}</Alert> : null)

const MicrosoftSignIn = ({ next }: { next: string }) => (
  <div class="auth-alt">
    <p class="auth-or">または</p>
    {/* 再読み込みなしの遷移にしないのは、Microsoft のサインイン画面へ移るので、fetch ではリダイレクト先を読めないため */}
    <form method="post" action="/auth/microsoft" data-reload>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" size="lg" block>
        Microsoft アカウントでログイン
      </Button>
    </form>
  </div>
)

export const LoginPage = ({
  login = '',
  next = '',
  errors = {},
  microsoft = false,
}: {
  login?: string
  next?: string
  errors?: FieldErrors
  microsoft?: boolean
}) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
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
      {microsoft && <MicrosoftSignIn next={next} />}
      <p class="auth-switch">
        <a href="/password/forgot">パスワードを忘れた場合</a>
      </p>
    </div>
  </AuthShell>
)

export const InvalidLinkPage = () => (
  <AuthShell>
    <div class="auth-card">
      <h1>リンクが無効です</h1>
      <p class="muted">
        リンクの有効期限が切れているか、すでに使われています。お手数ですが、もう一度パスワードの再設定をやり直してください。
      </p>
      <Button href="/password/forgot" variant="primary" size="lg" block>
        パスワードの再設定へ
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

export const MicrosoftRegisterPage = ({
  email,
  name,
  username,
  errors = {},
}: {
  email: string
  name: string
  username: string
  errors?: FieldErrors
}) => (
  <AuthShell>
    <div class="auth-card">
      <h1>登録を完了する</h1>
      <p class="muted">Microsoft アカウント（{email}）で登録します。氏名とユーザー名を設定してください。</p>
      <FormError message={errors.form} />
      <form method="post" action="/auth/microsoft/register" class="stack" data-loading-form {...validateWith('profile')}>
        <TextField label="氏名" name="name" value={name} error={errors.name} autocomplete="name" autofocus={!name} />
        <TextField
          label="ユーザー名"
          name="username"
          value={username}
          error={errors.username}
          hint={USERNAME_HINT}
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          autofocus={!!name}
        />
        <Button type="submit" variant="primary" size="lg" block>
          登録してはじめる
        </Button>
      </form>
      <p class="auth-switch">
        <a href="/login">ログインに戻る</a>
      </p>
    </div>
  </AuthShell>
)

export const MicrosoftSignupDomainPage = ({ email, domain }: { email: string; domain: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>このアカウントでは登録できません</h1>
      <p class="muted">
        Microsoft アカウント（{email}）は STEP Learn に登録されていません。Microsoft アカウントで新しく登録できるのは、@{domain}
        のメールアドレスだけです。ほかのメールアドレスの方は管理者にアカウントを作ってもらい、そのアカウントでログインしてから、アカウント画面で
        Microsoft アカウントを連携してください。
      </p>
      <Button href="/login" variant="primary" size="lg" block>
        ログインに戻る
      </Button>
    </div>
  </AuthShell>
)

export const MicrosoftUnverifiedPage = ({ email }: { email: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>メールアドレスを確認できません</h1>
      <p class="muted">
        Microsoft アカウント{email ? `（${email}）` : ''}
        のメールアドレスは、Microsoft
        で持ち主が確認されていないため、ログインに使えません。管理者に作ってもらったアカウントでログインしてから、アカウント画面で Microsoft
        アカウントを連携してください。
      </p>
      <Button href="/login" variant="primary" size="lg" block>
        ログインに戻る
      </Button>
    </div>
  </AuthShell>
)
