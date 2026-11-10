# STEP Learn

Moodle の「よく使う機能だけ」を、速く・安く・使いやすく作り直した軽量 LMS です。
Node.js（Hono）＋ SQLite で動き、教材ファイルは開発時はローカルディスク、本番は Cloudflare R2 に保存します。
1 台の小さな VPS で十分に動く構成です。

## 機能（現時点）

- **認証**：メール＋パスワードでの登録とログイン、セッション管理、プロフィールとパスワードの変更
  - 新規登録はメールアドレスの確認が必要です（届いたリンクから氏名・ユーザー名・パスワードを設定）
  - ログインはメールアドレスとユーザー名のどちらでもできます。ユーザー名の導入前に登録したユーザーは、アカウント画面で設定します
  - パスワードを忘れた場合は、ログイン画面からメールのリンク（有効期限 1 時間）で設定し直せます。設定するとすべての端末でログアウトされます
  - 管理者は CLI（`npm run user:create`）で作成します。Web からの登録はすべて学生になります
  - Moodle のコースバックアップから、コース・参加者を CLI（`npm run moodle:import`）で取り込めます
  - ロールは 管理者 / 教師 / 学生。コースを作成できるのは管理者だけです
- **コース**
  - コース一覧と検索（参加しているコースのみ。管理者は登録していないコースも表示できる）。「進行中」と「すべて」の切り替え（開始日・終了日で判定。端末ごとに記憶。「すべて」では終了したコースも出し、開始前のコースは教師として登録している人と管理者にだけ出す。ダッシュボードとサイドバーは進行中のコースだけ）、ダッシュボード（受講中・担当コース、進捗、「続きから学習」）
  - 作成（管理者がコース一覧や管理画面のモーダルから）・編集・削除、開始日と終了日、カラー、コースアイコンとヒーロー画像（PNG / JPEG / WebP / GIF、最大 5MB。アイコンは未設定なら頭文字を表示）
  - 学生の自己登録はなく、管理者か教師が参加者として追加したコースだけが見える
  - セクションとアイテム（ページ＝Markdown / リンク / ファイル / 画面共有）
  - 編集モードでの追加・並べ替え・削除（オンにするとブラウザを閉じるかログアウトするまで、どのコースでも続く）。オフのときは教師にも学生と同じ見え方で表示する
  - セクション・アイテムごとの「学生に非表示」（学生には一覧にも出さず、URL を開いても 404。進捗の計算からも外す）
  - 学生ごとの完了チェックと進捗表示、前後ナビと目次付きの閲覧画面
  - 参加者管理（メールで追加、ロール変更、除外）
  - 画面共有：セクションに「画面共有」アイテムを追加すると、教師がブラウザから画面をライブ配信でき、参加者はアイテムを開くと別タブいっぱいに映像を視聴できる（最大 1920×1080・30fps、回線と画面の動きに応じた可変ビットレート）
- **管理画面**（管理者、`/admin`）：ユーザーのロール変更、全コースの一覧と作成
- **テーマ**：既定はライト。ヘッダーのユーザーメニューで選んだときだけダークにし、選択はブラウザ（localStorage）に保持する

## 設計方針

| 方針 | 実装 |
| --- | --- |
| 速さ | SSR（hono/jsx）＋ 小さなクライアント JS。リンクとフォーム送信を fetch に置き換え、ホバー時の先読みと View Transitions で再読み込みなしに遷移する（SPA）。JavaScript は必須で、無効なブラウザには有効化を求める案内だけを表示する |
| DB | `better-sqlite3`（WAL モード）＋ Drizzle ORM。DB サーバーは要らない。テーブル定義は `src/lib/schema.ts` で、マイグレーションは drizzle-kit で生成する。クエリも Drizzle のクエリビルダーで書き、結果に型が付く |
| コスト | 必要なのは Node.js が動くサーバー 1 台だけ。R2 を使う場合、ダウンロードは署名付き URL で R2 から直接配信されるので、サーバーの帯域を使わない（R2 は転送料無料） |
| 依存の少なさ | ランタイム依存は `hono`・`@hono/node-server`・`aws4fetch`（R2 用、数 KB）・`nodemailer`（確認メールの SMTP 送信）・`better-sqlite3`・`drizzle-orm`・`socket.io`（画面共有の中継）・`zod`（入力の検証。同じ規則をブラウザでも使うので、ブラウザ側は軽量版の `zod/mini`）だけ。ネイティブアドオンの `better-sqlite3` 以外は 1 ファイルにバンドルされる。ブラウザ側のライブラリは入力の検証の `zod/mini` と、Markdown エディターの CodeMirror、ログイン画面の 3D アニメーションの three.js、PDF ビューアーの pdf.js だけ。CodeMirror はエディターのある画面でだけ、three.js はログイン前の画面でだけ、pdf.js は PDF のアイテムをビューアーで開いたときだけ読み込む |
| セキュリティ | PBKDF2（60 万回、ログイン時に旧設定のハッシュを再計算）、推測されやすいパスワードの拒否、ログイン失敗と確認メール・再設定メール送信のレート制限、登録画面と再設定画面からメールアドレスの登録有無がわからない設計、セッション Cookie は HMAC-SHA256 で署名しトークンは SHA-256 で保存、CSRF 対策は Origin 検証と SameSite=Lax、ファイルは権限を確認したうえで配信（PDF と画像以外は添付として返す） |

## 開発

Node.js 24 以上が必要です。

```sh
npm install
npm run dev          # http://localhost:5173
```

- 初回起動時に `migrations/` のスキーマが自動で適用され、`data/step-learn.db` が作られます
- アップロードしたファイルは `data/files/` に保存されます
- データを初期化したいときはサーバーを止めて `data/` を削除してください
- SMTP を設定していない間は、確認メールは送信されずにサーバーのログに出力されます

最初の管理者は CLI で作成します（CLI は `npm run build` で生成されます）。

```sh
npm run build
npm run user:create -- --email admin@example.com --name "管理者" --username admin
```

```sh
npm run typecheck
npm run lint          # oxlint
npm run format        # Prettier で整形（確認だけなら format:check）
```

## 本番運用

```sh
npm ci
npm run build        # dist/client（CSS/JS）と dist/server/index.js を生成
npm start            # = node dist/server/index.js
```

設定は環境変数か `.env` で行います（`.env.example` を参照）。

- `PORT`：待ち受けポート（既定 3000）
- `APP_ORIGIN`：nginx や Caddy などのリバースプロキシの後ろで動かす場合は、公開 URL（例 `https://lms.example.com`）を必ず設定してください
- `SESSION_SECRET`：セッション Cookie の署名鍵（32 文字以上）。未設定なら `data/session-secret` を自動生成して使います。変更すると全員がログアウトされます
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`：確認メールの送信に使う SMTP サーバー。`SMTP_HOST` を設定する場合は `MAIL_FROM` と `APP_ORIGIN` も必須です
- `OPENROUTER_API_KEY`：AI の機能に使う [OpenRouter](https://openrouter.ai/) の API キー。未設定なら AI の機能は使えません。使うモデルは `src/lib/ai.ts` の `AI_MODELS` に並べたものだけです
- `TRUST_PROXY`：リバースプロキシの後ろで動かす場合は `1` にしてください。`X-Forwarded-For` からクライアントの IP を取ってレート制限に使います（未設定だと全員がプロキシの IP として扱われます）
- 画面共有は `/socket.io/` で WebSocket を使います。リバースプロキシでは WebSocket の Upgrade を通してください（nginx なら `proxy_http_version 1.1;` と `Upgrade` / `Connection` ヘッダーの転送）。通らない場合は HTTP のロングポーリングに切り替わって動きますが、遅延と負荷が増えます
- 配信中の状態はプロセスのメモリに持つため、複数のプロセスやサーバーに分散させないでください
- 実行時に必要なのは `dist/`・`migrations/`・`migrations-moodle/`（Moodle モードのとき）・`.env` と、`better-sqlite3` を入れた `node_modules` です（`npm ci --omit=dev` で入ります）。起動したディレクトリを基準に読み込みます
- SQLite・セッション署名鍵・（ローカル保存時の）教材ファイルは、起動したディレクトリの `data/` に保存されます（変更はできません）。**このディレクトリをバックアップ対象にしてください**

### ユーザーを CLI で作成する

```sh
npm run user:create -- --email admin@example.com --name "管理者" --username admin [--role admin|teacher|student]
```

- `--role` を省略すると管理者になります
- `--username` は半角英数字と `.` `_` `-` で 3〜30 文字です
- パスワードは対話的に入力します。パイプで渡した場合は 1 行目を使います（例 `cat password.txt | npm run user:create -- ...`）
- Web の新規登録と同じパスワードの基準を満たす必要があります

### Moodle から移行する

Moodle のコースバックアップ（.mbz）から、コース・セクション・アイテム・参加者を取り込みます（CLI は `npm run build` で生成されます）。

```sh
npm run moodle:import -- backup.mbz --dry-run   # プレビューだけを表示する
npm run moodle:import -- backup.mbz             # プレビューを表示し、確認してから取り込む
```

- Moodle の「バックアップ」でコースごとに書き出した .mbz を使います。参加者も移すときは「ユーザーを含める」をオンにし、「匿名化」はオフにしてください。展開したディレクトリも指定できます
- 取り込む前に、作られるセクション・アイテム・参加者と、取り込まないもの・変換で失われるものをプレビューに表示します。`--yes` で確認を省き、`--verbose` で学生をすべて表示します
- 1 回の実行で新しいコースを 1 つ作ります。同じバックアップを 2 回取り込むとコースが 2 つできます（プレビューで警告します）

| Moodle | STEP Learn |
| --- | --- |
| ページ・ラベル・ブック | ページ（HTML を Markdown に変換。画像は「（画像: 名前）」、表は「 \| 」区切りの行になる。ブックは章ごとの見出しを付けて 1 ページにまとめる） |
| URL | リンク（http / https のみ） |
| ファイル | ファイル（メインのファイル 1 つ） |
| フォルダ | 中のファイルごとにファイルのアイテム |
| 課題・小テスト・フォーラムなど | 取り込まない |
| 表示 / 非表示、完了トラッキング | 学生に非表示、完了の条件（「閲覧したら完了」は「開いたら完了」、それ以外は「学生が自分で完了にする」） |
| アクセス制限（日付・条件） | 取り込まない（制限なしで表示される） |
| 教師・編集権限のない教師・マネージャー / 学生 | 教師 / 学生（削除・停止されたユーザーは除く） |

- 同じメールアドレスのユーザーがすでにいれば、そのユーザーを参加者に加えます。いなければ作成します（Moodle のユーザー名が規則に合い、空いていれば引き継ぎます）
- Moodle のパスワードは引き継げません。新しく作ったユーザーには、ログイン画面の「パスワードを忘れた場合」からパスワードを設定してもらってください（SMTP の設定が必要です）
- 学生の完了状況や評定は取り込みません

#### Moodle から直接取り込む

.mbz を使わず、Moodle の Web サービスからコースを読んで取り込むこともできます。取り込むのはコース・セクションと URL・ファイル・フォルダーだけです（参加者・ページ・ラベル・課題などは取り込みません）。

```sh
MOODLE_MIGRATE_URL=https://moodle.example.ac.jp MOODLE_MIGRATE_TOKEN=<トークン> \
  npm run moodle:migrate -- 12 13 --dry-run   # コース ID 12 と 13 のプレビューだけを表示する
```

- Moodle に `moodle/local_steplearn/` のプラグインが入っている必要があります（Moodle モードと同じもの）
- トークンは、すべてのコースを見られるアカウント（システムのコンテキストで「マネージャー」を割り当てたアカウントなど）のものを、外部サービス「STEP Learn」で発行します
- コースごとにプレビューを表示し、確認してから取り込みます。`--yes`・`--verbose` は `moodle:import` と同じです
- サブセクションは、親のセクションのすぐ後ろに「親 › 子」という名前のセクションとして並べます
- Moodle モードで追加した、STEP Learn にしかない種類のアイテムは引き継ぎません

### Moodle モード（完全移行までの一時的な運用）

`MOODLE_URL` を設定すると、STEP Learn を Moodle 5.1 のフロントエンドとして動かします。データはすべて Moodle にあり、STEP Learn は画面だけを受け持ちます。

- ログインは Moodle のログイン画面で行います（ログイン画面の「旧STEP Learnでログイン」から移動）。手動のアカウントでも Microsoft アカウントでもログインでき、ログインすると STEP Learn と Moodle の両方でログインした状態になります
- Moodle のログイン画面とダッシュボードに「新しい STEP Learn を使う」ボタンを出せます（プラグインの設定でオンにします）。押すとそのまま STEP Learn にログインします
- ログアウトすると Moodle からもログアウトします。Moodle の画面でログアウトしたときも、STEP Learn から抜けます（`MOODLE_BACKCHANNEL_SECRET` を設定した場合）
- Moodle のセッションが時間切れになったときや、管理者に強制ログアウトされたときも、STEP Learn から抜けます（確認は 1 分おきで、次に画面を開いたときにログイン画面に戻ります）。STEP Learn を使っている間は Moodle のセッションも延長されます
- STEP Learn の画面で扱うのは URL とファイルの活動だけです。課題・小テストなどのほかの活動は「Moodle で開く」から Moodle の画面で使います（ラベルは本文をセクションの中に表示します）
- 教師は、セクション・リンク・ファイルの追加・編集・並べ替え・表示の切り替え・削除を STEP Learn の画面でできます。参加者・コースの設定・アカウント設定・管理は Moodle の同じ画面に移ります
- コースページは、コースフォーマットが「タイル」（format_tiles）と「折りたたみ型トピック」（format_topcoll）のコースではその見せ方に合わせます。ほかのフォーマットは、すべてのセクションを開いた一覧です
  - タイル: 一般セクションの下にセクションをタイルで並べ、押すとそのタイルの行のすぐ下にセクションを開きます（同時に開けるのは 1 つで、別のタイルを押すと前のセクションは閉じます）。タイルのアイコン（STEP Learn のアイコンに置き換え）・写真・進捗の表示・サブタイルの設定に従います
  - 折りたたみ型トピック: セクションを開閉でき、開閉は Moodle の画面と同じく利用者ごとに記録されます。並べ方（最新の週を先頭に など）・現在のセクション・すべて開く/閉じる・1 つだけ開く・段組み・閉じたときの概要の表示の設定に従います（色やアイコンの設定は使いません）
- STEP Learn にしかない機能（新規登録・パスワードの再設定・Markdown のページ・CLI）は使えません
- 画面共有は、Moodle モードだけにある種類のアイテム（下）として追加できます。一覧や目次から開くと、新しいタブで画面共有の画面を開きます（Moodle の画面から開いたときも新しいタブで開きます）。視聴できるのはアイテムを開ける参加者、配信できるのはコースを編集できる人で、接続している間も確かめ直し、見られなくなった人の接続は切ります
- Moodle モードだけにある種類のアイテム（`src/moodle-mode/extra-kinds.tsx` に定義する）は、中身を `data/moodle-mode.db` に保存し、Moodle には同じ位置に STEP Learn へ移る URL の活動（リンク先は `/m/<キー>`）を置きます。並び順・表示・アクセス制限・完了は Moodle の活動のものを使います。Moodle でコースをコピーしたときは、コピー先では開けません。完全移行では引き継ぎません
- STEP Learn 側の DB は `data/moodle-mode.db`（ユーザーの写し・セッション・暗号化したトークンと、Moodle モードだけにある種類のアイテムの中身）で、`data/step-learn.db` は作りも開きもしません。完全移行のときに引き継ぐ必要はありません

Moodle 側には、このリポジトリの `moodle/local_steplearn/` のプラグインを入れて設定します。手順は [moodle/README.md](moodle/README.md) を参照してください。

| 環境変数 | 内容 |
| --- | --- |
| `MOODLE_URL` | Moodle の URL（例 `https://moodle.example.ac.jp`）。設定すると Moodle モードになります |
| `MOODLE_EXCHANGE_TOKEN` | ログインのコードを交換する専用アカウントのトークン（必須） |
| `MOODLE_BACKCHANNEL_SECRET` | Moodle でのログアウトの通知を検証し、STEP Learn からのログアウトに署名する鍵（32 文字以上。プラグインの設定と同じ値）。未設定なら通知を受け付けず、ログアウトのたびに Moodle の確認画面が出ます |

完全移行して Moodle モードを使わなくなったら、次を削除します。

- `src/moodle-mode/`・`migrations-moodle/`・`drizzle.moodle.config.ts`・`moodle/`
- `src/index.tsx` のモードの切り替え（`./app` だけを読み込む形に戻す）と、`src/server.ts`・`vite.config.ts` の `config.moodle` の分岐
- `src/lib/config.ts` の `moodle` / `moodleDatabasePath` / `moodleMigrate`、`src/lib/db.ts` の Moodle モードのガード、`src/components/style.tsx` の `moodle-mode.css`
- `src/moodle/remote.ts` と `src/cli.ts` の `moodle:migrate`、`src/lib/forms.ts` の `extraItemFields` / `extraItem`、`src/client.ts` の `setKindOnly`
- `package.json` の `moodle:migrate` / `db:generate:moodle` / `db:check:moodle`、CI の「Check Moodle mode migrations」、`Dockerfile` の `migrations-moodle`、`.dockerignore` の `moodle`

### Docker で動かす

```sh
docker compose up -d --build   # http://127.0.0.1:3000
```

- 設定はリポジトリ直下の `.env` を読みます（`ENV_FILE` で別のパスを指定できます）
- `PORT` と `DATA_DIR` はコンテナ内で固定です。ホスト側のポートは `HOST_PORT`（既定 3000）で変えられます
- ポートは既定で `127.0.0.1` にだけ公開されます。外部へはリバースプロキシ経由で公開し、`APP_ORIGIN` を設定してください
- リバースプロキシが別のホストにある場合は、`HOST_BIND` で公開するアドレスを変えます（例 `HOST_BIND=192.168.0.10` や `0.0.0.0`）
  - Docker の公開ポートは ufw / firewalld の INPUT ルールを通りません。送信元をリバースプロキシに絞るには、iptables の `DOCKER-USER` チェーンかホストの外のファイアウォールで制限してください
  - 例：`iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3000 ! -s <リバースプロキシの IP> -j DROP`
- SQLite とローカル保存の教材ファイルは Docker ボリューム `step-learn_data` に保存されます。**このボリュームをバックアップ対象にしてください**

### 自動デプロイ（GitHub Actions のセルフホストランナー）

`master` への push で CI（`.github/workflows/ci.yml`）が成功すると、`.github/workflows/deploy.yml` が 2 つのサーバーのセルフホストランナー上で `docker compose build` → `docker compose up -d` を実行して入れ替えます。
CI はチェックだけを行い、デプロイはしません。Actions の画面から手動で再デプロイすることもできます（`master` のみ。両方のサーバーに出ます）。

| デプロイ | ランナーのラベル | Environment | Compose のプロジェクト（ボリューム） |
| --- | --- | --- | --- |
| production | `production` | `production` | `step-learn`（`step-learn_data`） |
| beta | `beta` | `beta` | `step-learn-beta`（`step-learn-beta_data`） |

片方が失敗しても、もう片方のデプロイは続きます。

サーバー側の準備：

1. Docker（Compose v2.24 以上）を入れ、ラベル `self-hosted` / `linux` と、上の表のラベル（`production` か `beta`）を付けたランナーを登録する（ランナーのユーザーが `docker` を実行できること）
2. GitHub の Environment（`production` / `beta`）に設定値を登録する。デプロイのたびに、ここから `.env` をランナーの一時ディレクトリに書き出してコンテナに渡し、終わったら消します
   - Secrets：`SESSION_SECRET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `SMTP_PASS` / `MOODLE_EXCHANGE_TOKEN` / `MOODLE_BACKCHANNEL_SECRET` / `OPENROUTER_API_KEY`
   - Variables：`APP_ORIGIN` / `TRUST_PROXY` / `R2_ACCOUNT_ID` / `R2_BUCKET` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` / `MOODLE_URL`
   - 使わない項目は登録しなくてかまいません。値に `'` と改行は使えません
   - Moodle モードで動かすサーバーの Environment にだけ `MOODLE_URL` などを登録します
3. ホスト側のポートを変える場合は変数 `DEPLOY_HOST_PORT` を、公開するアドレスを変える場合は変数 `DEPLOY_HOST_BIND` を、それぞれの Environment に設定する（両方のサーバーで同じ値ならリポジトリに設定してもかまいません）。2 つのランナーが同じホストにある場合は、`DEPLOY_HOST_PORT` を別々にしてください
4. 必要に応じて、それぞれの Environment に承認者などの保護ルールを設定する

### 教材ファイルを Cloudflare R2 に保存する

1. Cloudflare ダッシュボードで R2 バケットを作成する（例 `step-learn-files`）
2. 「R2 API トークンを管理」で、そのバケットへの「オブジェクト読み取りと書き込み」権限を持つトークンを発行する
3. `.env` に `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` を設定して再起動する

4 つすべてが設定されていると R2 に保存され、未設定ならローカルディスクに保存されます。
ダウンロードは、アプリで閲覧権限を確認したあと、有効期限 5 分の署名付き URL へリダイレクトして配信します。

## ディレクトリ構成

```
migrations/          drizzle-kit が生成するマイグレーション（起動時に未適用のものを自動で適用）
migrations-moodle/   Moodle モードの DB（data/moodle-mode.db）のマイグレーション
src/index.tsx        MOODLE_URL の有無で、通常モード（src/app.tsx）と Moodle モード（src/moodle-mode/app.tsx）を切り替える
src/app.tsx          Hono アプリ本体（ミドルウェア、ルーティング）
src/server.ts        本番用 Node.js エントリ（静的ファイル配信、起動）
src/renderer.tsx     HTML の外枠
src/client.ts        クライアント側の小さな拡張（再読み込みなしの画面遷移、トースト、確認ダイアログ、完了トグルなど）
src/styles/base.css  デザイントークンと共通スタイル（ダークモード対応）。部品・画面ごとの CSS は各 .tsx の隣に置き、使うページでだけ読み込む
src/lib/             設定・DB・認証・HTTP ヘルパー・Markdown・ストレージ・画像アップロード・コースの権限・AI（OpenRouter）
src/moodle/          Moodle のバックアップの展開・読み取り・取り込み（CLI の moodle:import）
src/moodle-mode/     Moodle モード（MOODLE_URL を設定したときだけ使う。完全移行のあとは削除する）
moodle/              Moodle モード用の Moodle プラグイン（local_steplearn）と検証用の Moodle（moodle/dev）
src/components/      レイアウトと UI 部品
src/routes/<ルート>/ auth / account / admin / dashboard / courses / content / participants / screen。
                     ルートごとに index.ts（ルーティング）・handlers.tsx（処理）・views.tsx（画面）・<ルート>.css に分ける
```
