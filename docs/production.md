# 本番運用

```sh
npm ci
npm run build        # dist/client（CSS/JS）と dist/server/index.js を生成
npm start            # = node dist/server/index.js
```

## 環境変数

`.env` か環境変数で設定します（`.env.example` を参照）。ここには、何を設定するかと、設定しないとどうなるかだけを書きます。読み込んでいるのは `src/lib/config.ts` です。

| 環境変数 | 設定するもの | 設定しないと |
| --- | --- | --- |
| `PORT` | 待ち受けポート | 3000 |
| `APP_ORIGIN` | 公開 URL（例 `https://lms.example.com`）。リバースプロキシの後ろでは必須 | 要求の URL を使う |
| `TRUST_PROXY` | リバースプロキシの後ろで `1` | 全員がプロキシの IP としてレート制限される |
| `SESSION_SECRET` | セッション Cookie の署名鍵（32 文字以上）。変えると全員がログアウトされ、保存中の AI のチャットも消える | `data/session-secret` を自動生成して使う |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 確認メールを送る SMTP サーバー。`SMTP_HOST` を設定するなら `MAIL_FROM` と `APP_ORIGIN` も必須 | メールを送らず、サーバーのログに出す |
| `CLAUDE_API_KEY` | Anthropic の API キー（AI エージェントとコーディング問題の採点） | Claude のモデルを使えない |
| `OPENROUTER_API_KEY` | OpenRouter の API キー（関係ない依頼の判定・STEP Docs の検索・予備のモデル） | 判定を省き、STEP Docs はページの一覧から読む |
| `AI_EMAIL_DOMAIN` | AI エージェントを使えるメールアドレスのドメイン | `sist.ac.jp` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT` | Microsoft アカウントでのログイン（[Microsoft アカウントでのログイン](microsoft-login.md)） | Microsoft でログインできない |
| `MICROSOFT_SIGNUP_DOMAIN` | Microsoft アカウントで新しく登録できるメールアドレスのドメイン | `sist.ac.jp` |
| `SANDBOX_URL` | Python を実行する sandbox の接続先（[sandbox/README.md](../sandbox/README.md)）。Docker Compose なら自動で設定される | コーディング問題で Python を選べない |
| `BROWSER_URL` | Web の提出を開く browser の接続先（[browser/README.md](../browser/README.md)）。Docker Compose なら自動で設定される | Web の提出をコードだけで判定する |
| `MOODLE_URL` ほか | Moodle モード（[moodle/README.md](../moodle/README.md)） | 通常モードで動く |

AI の月の上限は、提供元ごとに管理 > AI で設定します。

## 動かすときの注意

- 画面共有（`/socket.io/`）と発表ファイル（`/presentation-io/`）は WebSocket を使います。リバースプロキシでは Upgrade を通してください（nginx なら `proxy_http_version 1.1;` と `Upgrade` / `Connection` ヘッダーの転送）。通らないと遅延と負荷が増えます
- 配信中の状態と、コードの採点の順番待ちはプロセスのメモリに持つため、複数のプロセスやサーバーに分散させないでください。採点の途中で再起動すると、その提出は「採点できませんでした」になり、教師が採点し直せます
- 実行時に必要なのは `dist/`・`migrations/`・`migrations-moodle/`（Moodle モードのとき）・`.env` と、`better-sqlite3` を入れた `node_modules` です（`npm ci --omit=dev` で入ります）。起動したディレクトリを基準に読み込みます
- SQLite・セッション署名鍵・教材ファイルは、起動したディレクトリの `data/` に保存されます。**このディレクトリをバックアップ対象にしてください**（[バックアップ](backup.md)）

## ユーザーを CLI で作成する

```sh
npm run user:create -- --email admin@example.com --name "管理者" --username admin [--role admin|teacher|student]
```

- `--role` を省略すると管理者になります
- `--username` は半角英数字と `.` `_` `-` で 3〜30 文字です
- パスワードは対話的に入力します。パイプで渡した場合は 1 行目を使います（例 `cat password.txt | npm run user:create -- ...`）
- Web の新規登録と同じパスワードの基準を満たす必要があります
