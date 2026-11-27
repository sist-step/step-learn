import { Button } from '../../components/button'
import { Card } from '../../components/card'
import { TextField } from '../../components/form'
import { AppShell, AuthShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { EmptyState, PageHeader, formatDateTime } from '../../components/ui'
import { hasEmail } from '../../lib/username'
import type { clientKind } from './oauth'

type ClientKind = ReturnType<typeof clientKind>

const KIND_LABELS: Record<ClientKind, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  local: 'このパソコンのアプリ',
}

/** 同意の画面と接続中のアプリの一覧に出す、つなぐアプリ。host は戻り先のホストで、手元のアプリなら null */
export type ClientView = { kind: ClientKind; name: string; host: string | null }

const clientTitle = ({ kind, name }: ClientView) => (kind === 'local' && name ? `${name}（${KIND_LABELS.local}）` : KIND_LABELS[kind])

/** MCP で許可すること。ツールを足したらここにも足す */
const PERMISSIONS = ['STEP Docs（STEP の活動のマニュアル）を検索して読む']

/** 同意の画面で送り直す、認可の要求の値 */
export type AuthorizeFields = {
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  response_type: string
  state?: string
  resource?: string
}

export const ConsentPage = ({
  client,
  user,
  fields,
}: {
  client: ClientView
  user: { name: string; email: string; username: string | null }
  fields: AuthorizeFields
}) => (
  <AuthShell>
    <Styles use={['/src/features/mcp/mcp.css']} />
    <div class="auth-card">
      <h1>{clientTitle(client)} との接続</h1>
      <p class="muted">
        {client.host ? `${client.host} の` : 'このパソコンの'}アプリが、{user.name} さん（
        {hasEmail(user.email) ? user.email : `@${user.username}`}）として STEP Learn を使うことを求めています。
      </p>
      <div class="mcp-permissions">
        <div class="strong small">許可すること</div>
        <ul>
          {PERMISSIONS.map((p) => (
            <li>{p}</li>
          ))}
        </ul>
      </div>
      <p class="muted small">
        接続はユーザーメニューの「AI アプリとの接続」からいつでも解除できます。心当たりがなければ「許可しない」を押してください。
      </p>
      {/* 再読み込みなしの遷移にしないのは、許可したあと AI アプリ（別オリジン）の戻り先へ移り、fetch では追えないため */}
      <form method="post" action="/oauth/authorize" class="mcp-consent-actions" data-reload>
        {Object.entries(fields).map(([name, value]) => value !== undefined && <input type="hidden" name={name} value={value} />)}
        <Button type="submit" name="decision" value="deny">
          許可しない
        </Button>
        <Button type="submit" name="decision" value="allow" variant="primary">
          許可する
        </Button>
      </form>
    </div>
  </AuthShell>
)

/** 同意の画面を出せないとき（教師でない、アプリが登録されていない、戻り先が違う） */
export const AuthorizeErrorPage = ({ heading, text, loggedIn }: { heading: string; text: string; loggedIn: boolean }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>{heading}</h1>
      <p class="muted">{text}</p>
      {loggedIn && (
        // 再読み込みなしの遷移にしないのは、Moodle モードではログアウトのあと Moodle（別オリジン）に移り、fetch では追えないため
        <form method="post" action="/logout" data-reload>
          <Button type="submit" size="lg" block>
            ログアウトして別のアカウントでログイン
          </Button>
        </form>
      )}
    </div>
  </AuthShell>
)

type GrantRow = { id: number; client: ClientView; createdAt: number; lastUsedAt: number }

const SETUP_STEPS = [
  { app: 'Claude', text: '設定 → コネクタ → 「カスタムコネクタを追加」に URL を入力します。' },
  { app: 'ChatGPT', text: '設定 → アプリ → 詳細設定で開発者モードをオンにし、「アプリを作成」に URL を入力します。' },
  { app: 'Claude Code', text: 'claude mcp add --transport http step-learn <URL> を実行し、/mcp から認証します。' },
]

export const AppsPage = ({ mcpUrl, grants }: { mcpUrl: string; grants: GrantRow[] }) => (
  <AppShell>
    <Styles use={['/src/features/mcp/mcp.css']} />
    <PageHeader title="AI アプリとの接続" description="Claude や ChatGPT などの AI アプリから、STEP Learn の情報を使えるようにします。" />
    <div class="mcp-layout">
      <Card
        heading="接続の URL"
        description="AI アプリで MCP サーバー（コネクタ）を追加するときに入力します。初めて使うときに STEP Learn の画面が開くので、許可してください。"
      >
        <div class="stack">
          <TextField label="MCP サーバーの URL" name="mcp_url" value={mcpUrl} readonly spellcheck={false} />
          <dl class="mcp-steps">
            {SETUP_STEPS.map((s) => (
              <>
                <dt class="strong small">{s.app}</dt>
                <dd class="muted small">{s.text}</dd>
              </>
            ))}
          </dl>
          <p class="muted small">使えるのは、教師のアカウントだけです。</p>
        </div>
      </Card>
      <section class="stack">
        <h2 class="mcp-heading">接続中のアプリ</h2>
        {grants.length === 0 ? (
          <EmptyState
            icon="link"
            title="接続中のアプリはありません"
            text="AI アプリで上の URL を追加して許可すると、ここに表示されます。"
          />
        ) : (
          grants.map((g) => (
            <Card
              heading={clientTitle(g.client)}
              description={`${g.client.host ? `${g.client.host} · ` : ''}接続: ${formatDateTime(g.createdAt)} · 最後に使った日時: ${formatDateTime(g.lastUsedAt)}`}
              actions={
                <form
                  method="post"
                  action={`/account/apps/${g.id}/delete`}
                  data-confirm="この接続を解除しますか？"
                  data-confirm-ok="解除する"
                >
                  <Button type="submit" variant="danger-outline">
                    解除
                  </Button>
                </form>
              }
            />
          ))
        )}
      </section>
    </div>
  </AppShell>
)
