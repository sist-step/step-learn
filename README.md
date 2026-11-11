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
  - セクションとアイテム（ページ＝Markdown / リンク / ファイル / 画面共有 / コード / ファイル自動配布）
  - 編集モードでの追加・並べ替え・削除（オンにするとブラウザを閉じるかログアウトするまで、どのコースでも続く）。オフのときは教師にも学生と同じ見え方で表示する
  - セクション・アイテムごとの「学生に非表示」（学生には一覧にも出さず、URL を開いても 404。進捗の計算からも外す）
  - 学生ごとの完了チェックと進捗表示、前後ナビと目次付きの閲覧画面
  - 参加者管理（メールで追加、ロール変更、除外）
  - コード：セクションに「コード」アイテムを追加すると、学生がブラウザのエディターでコードを書いて提出できる。言語は Web（HTML / CSS / JavaScript。書きながら隣にプレビューとコンソールを表示）か Python（sandbox のコンテナで実行して結果を表示。下の「コードを実行する sandbox」）。書きかけのコードは自動で保存され、提出は出し直せる（前の提出も残る）。教師は問題文・最初に入れておくコード・採点基準・満点を設定する
    - 採点：`OPENROUTER_API_KEY` を設定していると、提出のたびに AI が採点基準に沿って点数と講評を付ける（Python は、提出されたコードを sandbox で実行した結果も AI に渡す）。採点は順番に行い、終わると学生の画面に結果が出る。AI が採点するときは、続けて提出できるのは 1 分に 1 回まで。設定していなければ自動では採点しない
    - 教師はアイテムの「提出」から、学生ごとの提出（コード・プレビュー・実行結果・AI の採点・提出の履歴）を見て、点数とコメントを付けられる。教師が付けた点数は AI の点数より優先して成績になる。AI の採点はやり直せる
  - AI アシスタント：教師（`AI_EMAIL_DOMAIN` のメールアドレスで、管理者・全体ロールが教師・いずれかのコースの教師のどれか）は、ヘッダー右上の ✦ から右側のパネルを開き、AI に頼める。今は管理しているコースの内容（コースの構成・アイテムの中身）を読んで答えるだけで、内容は変更しない。受講者・成績・提出は扱わない
    - チャットを始めるときにモデルを選び（API キーを設定した提供元のモデルだけ）、その会話の途中では変えない。チャットは 1 人に 1 つで、閉じるとその場で消え、開き直せない。閉じずに置いたチャットも最後の発言から 5 日で消える
    - 会話は、やり取りの続きに文脈を渡すためだけにサーバーへ保存する。`SESSION_SECRET` から導いた鍵で AES-256-GCM で暗号化し、管理者にも中身は見せない
    - 呼び出しのたびに使用量を記録し、提供元ごとの週の枠（管理 > AI の月の上限を日割りして、直近 4 週間に使った人数で割ったもの）を使い切ると、その週は使えない
  - ファイル自動配布：セクションに「ファイル自動配布」アイテムを追加し、編集画面でフォルダーごと（またはファイルや zip を選んで）アップロードすると、学生はアイテムの「VS Code で開く」を押すだけで、VS Code の拡張機能「STEP Learn for VSCode」（`vscode-extension/`。下の「VS Code の拡張機能」）がファイルを `ドキュメント/STEP Learn/<コース名>/<アイテム名>` に用意してフォルダーを開く。拡張機能がない人のために zip でもダウンロードできる
    - フォルダーの構成はそのまま配る。`.git`・`node_modules`・`__pycache__`・`.venv` などは外し、実行ファイル（.exe など）は受け付けない。同じ場所のファイルは置き換わる。1 アイテムに 500 個・合計 50MB まで（1 回のアップロードは 30MB まで）
    - アップロードは、ドラッグ＆ドロップするか選んだ時点で始まる。zip を選ぶかドロップすると、サーバーで展開して中身を配る（中身がすべて 1 つのフォルダーに入っていれば、そのフォルダーの中身。フォルダーの中にある zip は展開せずにそのまま配る）。ファイルの名前は UTF-8 のほか、日本語の Windows で作った zip（Shift_JIS）も読める。パスワード付きの zip には対応しない
    - 2 回目からは前に用意したフォルダーを開く。教師がファイルを足したり更新したりしていれば、取り込むかを聞き、学生が書き換えたファイルは上書きしない
    - 「VS Code で開く」のリンクには、その学生とアイテムに限った鍵（数分で切れ、1 回だけ使える）を付ける。拡張機能はそれを、ファイルの一覧と受け取るための鍵（15 分）に引き換える（`/api/vscode/claim`）。鍵は `SESSION_SECRET` から導いた鍵で署名し、DB には保存しない
    - データを同期する（オプション）：編集画面の「データを同期する」を有効にすると、学生が VS Code でファイルを保存するたびに、拡張機能がその内容を STEP Learn に送り（`/api/vscode/sync`）、ファイルごとの変更履歴として残す。教師はアイテムの「変更履歴」から、学生ごとに、保存のたびの差分（1 つ前の記録との違い。最初の記録は配ったファイルとの違い）とその時点のファイル全体を見られる。学生も自分の変更履歴を見られる
      - 学生には、アイテムの画面と、VS Code で最初に開くときの確認（同意するまで送らない）で、記録されることを知らせる。同期しているあいだは VS Code のステータスバーに表示が出る
      - 記録するのは文字のファイル（1 つ 256KB まで）で、`.git`・`node_modules` などは除く。新しく作ったファイルと、消したファイルも記録する。1 人がアイテム 1 つに残せるのは合計 30MB まで。中身は gzip で縮めて DB（`bundle_sync_versions`）に置き、アイテムや利用者を消すと一緒に消える
      - 同期の鍵（180 日）は「VS Code で開く」のときに渡す。有効にする前に開いた学生も、次に VS Code でそのフォルダーを開いたとき（開いたままなら 5 分以内）に確認が出て、送り始める。同期を止めても、それまでの変更履歴は残る
  - 画面共有：セクションに「画面共有」アイテムを追加すると、教師がブラウザから画面をライブ配信でき、参加者はアイテムを開くと別タブいっぱいに映像を視聴できる（最大 1920×1080・30fps、回線と画面の動きに応じた可変ビットレート）
- **管理画面**（管理者、`/admin`）：ユーザーのロール変更、全コースの一覧と作成
- **テーマ**：既定はライト。ヘッダーのユーザーメニューで選んだときだけダークにし、選択はブラウザ（localStorage）に保持する

## 設計方針

| 方針 | 実装 |
| --- | --- |
| 速さ | SSR（hono/jsx）＋ 小さなクライアント JS。リンクとフォーム送信を fetch に置き換え、ホバー時の先読みと View Transitions で再読み込みなしに遷移する（SPA）。JavaScript は必須で、無効なブラウザには有効化を求める案内だけを表示する |
| DB | `better-sqlite3`（WAL モード）＋ Drizzle ORM。DB サーバーは要らない。テーブル定義は `src/lib/schema.ts` で、マイグレーションは drizzle-kit で生成する。クエリも Drizzle のクエリビルダーで書き、結果に型が付く |
| コスト | 必要なのは Node.js が動くサーバー 1 台だけ。R2 を使う場合、ダウンロードは署名付き URL で R2 から直接配信されるので、サーバーの帯域を使わない（R2 は転送料無料） |
| 依存の少なさ | ランタイム依存は `hono`・`@hono/node-server`・`aws4fetch`（R2 用、数 KB）・`nodemailer`（確認メールの SMTP 送信）・`better-sqlite3`・`drizzle-orm`・`socket.io`（画面共有の中継）・`zod`（入力の検証。同じ規則をブラウザでも使うので、ブラウザ側は軽量版の `zod/mini`）・`@anthropic-ai/sdk`（Claude の呼び出し）・`yauzl`（ファイル自動配布でアップロードされた zip の展開）だけ。ネイティブアドオンの `better-sqlite3` 以外は 1 ファイルにバンドルされる。ブラウザ側のライブラリは入力の検証の `zod/mini` と、Markdown エディターの CodeMirror、ログイン画面の 3D アニメーションの three.js、PDF ビューアーの pdf.js だけ。CodeMirror はエディターのある画面でだけ（HTML / CSS / JavaScript / Python の文法は、コードのアイテムとその編集画面でだけ）、three.js はログイン前の画面でだけ、pdf.js は PDF のアイテムをビューアーで開いたときだけ読み込む |
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
- `SESSION_SECRET`：セッション Cookie の署名鍵（32 文字以上）。未設定なら `data/session-secret` を自動生成して使います。変更すると全員がログアウトされ、保存中の AI のチャットも読めなくなるので消えます
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`：確認メールの送信に使う SMTP サーバー。`SMTP_HOST` を設定する場合は `MAIL_FROM` と `APP_ORIGIN` も必須です
- `OPENROUTER_API_KEY`：[OpenRouter](https://openrouter.ai/) 経由のモデル（DeepSeek V4.1 Flash）に使う API キー。未設定ならこのモデルは使えません。コードのアイテムの採点はこのモデルを使い、学生が提出したコードと問題文・採点基準が OpenRouter を通してモデルに送られます
- `CLAUDE_API_KEY`：Claude（Claude Sonnet 5.5）に使う [Anthropic](https://platform.claude.com/) の API キー。未設定ならこのモデルは使えません
- 使うモデルは `src/lib/ai-models.ts` に並べたものだけです。月の上限（USD）は提供元ごとに管理 > AI で設定します（保存するまでは OpenRouter が $3、Anthropic が $15）。コードのアイテムの採点にかかった額も OpenRouter の使用量に数え、月の上限に達している間は、提出しても自動では採点しません
- `AI_EMAIL_DOMAIN`：AI エージェントを使えるメールアドレスのドメイン（`@` より後ろの完全一致）。未設定なら `sist.ac.jp`
- `SANDBOX_URL`：学生が書いたコードを実行する sandbox のコンテナ（下の「コードを実行する sandbox」）の接続先。未設定ならコードの実行は使えません。Docker Compose で動かす場合は自動で設定されます
- `TRUST_PROXY`：リバースプロキシの後ろで動かす場合は `1` にしてください。`X-Forwarded-For` からクライアントの IP を取ってレート制限に使います（未設定だと全員がプロキシの IP として扱われます）
- 画面共有は `/socket.io/` で WebSocket を使います。リバースプロキシでは WebSocket の Upgrade を通してください（nginx なら `proxy_http_version 1.1;` と `Upgrade` / `Connection` ヘッダーの転送）。通らない場合は HTTP のロングポーリングに切り替わって動きますが、遅延と負荷が増えます
- 配信中の状態と、コードの採点の順番待ちはプロセスのメモリに持つため、複数のプロセスやサーバーに分散させないでください。採点の途中で再起動すると、その提出は「採点できませんでした」になり、教師が採点し直せます
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
- コード（コードを書いて提出し、AI が採点するアイテム）も、Moodle モードだけにある種類のアイテム（下）として追加できます。機能は通常モードと同じで、一覧や目次から開くと、新しいタブでエディターの画面を開きます。提出の一覧に並ぶのは提出した学生だけです（参加者は Moodle にあるため）。書きかけのコード・提出・採点は `data/moodle-mode.db` に置き、Moodle の評定には反映しません。完全移行では引き継ぎません。採点にかかった AI の使用量も `data/moodle-mode.db` に記録し、通常モードと同じく月の上限に達している間は自動では採点しません
- ファイル自動配布も、Moodle モードだけにある種類のアイテム（下）として追加できます。機能は通常モードと同じです。配るファイルの一覧と、データを同期するアイテムの変更履歴は `data/moodle-mode.db` に、ファイルの中身は教材ファイルと同じストレージの `moodle-mode/` の下に置きます。変更履歴の一覧に並ぶのは記録がある人だけです（参加者は Moodle にあるため）。完全移行では引き継ぎません
  - Moodle には、URL の活動ではなく専用の活動「ファイル自動配布」（`moodle/mod_stepbundle/` のプラグイン）を置きます。Moodle の画面で開くと STEP Learn のアイテムの画面に移り、Moodle の画面（活動の追加）からも作れます。このプラグインが Moodle に入っていないときは、アイテムを追加する画面にファイル自動配布を出しません
  - ごみ箱から戻した活動は、前に配っていたファイルにつながります。複製した活動とコピーしたコースの活動は、ファイルのない状態から始まります
  - 拡張機能から変更が届くたびに、送った学生の Moodle のトークンで、その活動が今も見えるかを確かめます（コースの情報と同じく 30 秒キャッシュします）。活動を消した（STEP Learn・Moodle のどちらの画面からでも）、非表示にした、学生がコースから外れた、Moodle のトークンの期限が切れた（STEP Learn にログインし直すと直る）ときは記録せず、拡張機能は「同期できません」と表示して止まります。ごみ箱から戻したり表示に戻したりしたあとは、学生が「VS Code で開く」をもう一度押すと再開します。Moodle に接続できないあいだは、拡張機能が 1 分ごとに送り直します
  - 専用の活動にする前の形（URL の活動）で残っているファイル自動配布は、教師がそのコースを開いたときに、Moodle の活動・配るファイルごと自動で削除します（学生には、それまでも一覧に出しません）
- 管理（`/admin`。Moodle のサイト管理者だけが開けます）は、AI の月の上限と使用量の画面です。上限と使用量は通常モードとは別に `data/moodle-mode.db` に置きます。ユーザーとコースの管理は Moodle のサイト管理で行い、画面の右上から移れます
- Moodle モードだけにある種類のアイテム（`src/moodle-mode/extra-kinds.tsx` に定義する）は、中身を `data/moodle-mode.db` に保存し、Moodle には同じ位置に STEP Learn へ移る URL の活動（リンク先は `/m/<キー>`。ファイル自動配布だけは専用の活動）を置きます。並び順・表示・アクセス制限・完了は Moodle の活動のものを使います。URL の活動に置いた種類は、Moodle でコースをコピーしたときは、コピー先では開けません。完全移行では引き継ぎません
- STEP Learn 側の DB は `data/moodle-mode.db`（ユーザーの写し・セッション・暗号化したトークンと、Moodle モードだけにある種類のアイテムの中身、コードのアイテムの書きかけのコードと提出、ファイル自動配布の配るファイルの一覧と変更履歴、AI の使用量と月の上限）で、`data/step-learn.db` は作りも開きもしません。完全移行のときに引き継ぐ必要はありません

Moodle 側には、このリポジトリの `moodle/local_steplearn/` のプラグインを入れて設定します。ファイル自動配布を使うときは `moodle/mod_stepbundle/` も入れます。手順は [moodle/README.md](moodle/README.md) を参照してください。

| 環境変数 | 内容 |
| --- | --- |
| `MOODLE_URL` | Moodle の URL（例 `https://moodle.example.ac.jp`）。設定すると Moodle モードになります |
| `MOODLE_EXCHANGE_TOKEN` | ログインのコードを交換する専用アカウントのトークン（必須） |
| `MOODLE_BACKCHANNEL_SECRET` | Moodle でのログアウトの通知を検証し、STEP Learn からのログアウトに署名する鍵（32 文字以上。プラグインの設定と同じ値）。未設定なら通知を受け付けず、ログアウトのたびに Moodle の確認画面が出ます |

完全移行して Moodle モードを使わなくなったら、次を削除します。

- `src/moodle-mode/`・`migrations-moodle/`・`drizzle.moodle.config.ts`・`moodle/`
- `src/index.tsx` のモードの切り替え（`./app` だけを読み込む形に戻す）と、`src/server.ts`・`vite.config.ts` の `config.moodle` の分岐
- `src/lib/config.ts` の `moodle` / `moodleDatabasePath` / `moodleMigrate`、`src/lib/db.ts` の Moodle モードのガード、`src/components/style.tsx` の `moodle-mode.css`
- `src/moodle/remote.ts` と `src/cli.ts` の `moodle:migrate`、`src/lib/forms.ts` の `extraItemFields` / `extraItem` / `extraCode`、`src/lib/bundle.ts` の `BUNDLE_MODULE`、`src/client.ts` の `setKindOnly`
- コードのアイテムを 2 つのモードで使い回すための分け方（`src/routes/code/handlers.tsx` の `CodeBackend`、`src/lib/code-store.ts` の `CodeStore`、`src/lib/code-grader.ts` の `createGrader`、`src/routes/code/views.tsx` の `CodePage`）は、通常モードの実装（`src/routes/code/backend.ts`・`src/lib/code-items.ts`・`src/lib/code-grading.ts`）だけになるので、まとめてかまいません
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
- 一緒に起動する `sandbox` サービスは、学生が書いたコードを実行するコンテナです（下の「コードを実行する sandbox」）。ボリューム `step-learn_sandbox-socket` はアプリとの通信用のソケットを置くだけなので、バックアップは要りません

### コードを実行する sandbox

コードのアイテムで学生が書いた Python は、アプリとは別のコンテナ（`sandbox/`、Compose の `sandbox` サービス）で実行します（`SANDBOX_URL` が未設定のサーバーでは、コードのアイテムで Python を選べません）。HTML / CSS / JavaScript はサーバーでは実行せず、学生のブラウザの中の、STEP Learn とは別オリジンとして扱われる iframe（`sandbox` 属性）でプレビューします。`docker compose up` でアプリと一緒に起動し、アプリからは共有ボリュームの UNIX ドメインソケット（`SANDBOX_URL=unix:/run/sandbox/sandbox.sock`）で呼びます。

sandbox のコンテナには、次の制限をかけています。

- ネットワークにつながない（`network_mode: none`）。インターネットにも、アプリやホストのポートにも届きません
- ルートファイルシステムは読み取り専用で、書き込めるのは実行ごとの作業ディレクトリ（16MB の tmpfs）だけ。秘密情報・環境変数・データのボリュームは置きません
- ケーパビリティは、実行ごとに別の UID へ切り替えるための `SETUID` / `SETGID` 以外をすべて外し、`no-new-privileges` を付けます。コードを実行するプロセスは、どのケーパビリティも持たない一般ユーザーです
- コンテナ全体でメモリ 512MB・CPU 1 コア・256 プロセスまで
- 1 回の実行は、実時間 10 秒・CPU 時間 5 秒・メモリ 256MB・16 プロセス・出力 64KB（標準出力と標準エラー出力のそれぞれ）・ファイル 1 つ 8MB まで。超えたら止めます
- 同時に実行できるのは 4 つまでで、それぞれ別の UID と作業ディレクトリで動かすので、ほかの人のコードや出力は読めません。空きがなければ 20 秒まで待ち、それでも空かなければ「混み合っています」と返します
- 実行が終わるたびに、その UID のプロセスをすべて止め、作業ディレクトリを空にします。止められない・消せないときは sandbox を終了させ、Docker の再起動で作り直します

同時に実行できる数は `compose.yaml` の `tmpfs` の行の数で決まります（8 まで）。増やすときは `mem_limit` も合わせて見直してください。

コンテナはホストとカーネルを共有するので、カーネルの脆弱性を突かれた場合までは防げません。もう一段固くしたい場合は、サーバーに [gVisor](https://gvisor.dev/) を入れ、`SANDBOX_RUNTIME=runsc` を付けて起動すると、sandbox だけを gVisor で動かせます（gVisor での動作は未確認です。共有ボリュームにソケットを作るので、runsc の `--host-uds=create` が必要になるはずです）。

Docker Compose を使わずに `npm start` で動かす場合は、下の開発用と同じくポートで待ち受ける形になりますが、この形では実行中のコードが外部と通信できます。本番では Docker Compose で動かしてください。

開発サーバー（`npm run dev`）から使うときは、sandbox だけを起動し、`.env` に接続先を書きます。

```sh
docker compose -f sandbox/compose.dev.yaml up -d --build   # 127.0.0.1:8091 で待ち受ける
```

```sh
SANDBOX_URL=http://127.0.0.1:8091
```

### VS Code の拡張機能（STEP Learn for VSCode）

ファイル自動配布のアイテムで使う VS Code の拡張機能は `vscode-extension/` にあります。本体とは別のパッケージで、型チェック・lint・ビルドも別に行います（本体の `npm run lint` は拡張機能を対象から外し、入れ子の設定も読みません。拡張機能の中に同じルールの `.oxlintrc.json` を置き、拡張機能の `npm run lint` で検査します。実行時の依存はなく、esbuild で 1 ファイルにまとめます）。拡張機能の使い方は [vscode-extension/README.md](vscode-extension/README.md)（Marketplace のページにもなる）にあります。

```sh
cd vscode-extension
npm install
npm run typecheck
npm run lint
npm run package     # step-learn-for-vscode-<バージョン>.vsix を作る（手元の VS Code に「VSIX からのインストール」で入れて試せる）
```

Marketplace への公開（無料）:

1. Microsoft アカウントで [Azure DevOps](https://dev.azure.com/) の組織を作り、「Personal access tokens」で Organization を「All accessible organizations」、Scopes を「Marketplace の Manage」にしたトークンを作る
2. [Marketplace の管理画面](https://marketplace.visualstudio.com/manage) で publisher `mint1535` を作る
3. `cd vscode-extension && npm ci && npx vsce login mint1535`（トークンを入力）→ `npm run publish`。`npm ci` を省くと、グローバルに入っている古い vsce が使われて `unknown option '--skip-license'` で失敗することがある。更新するときは `package.json` の `version` を上げてから `npm run publish`

拡張機能の ID は `mint1535.step-learn-for-vscode`（publisher と `package.json` の `name`）です。publisher か名前を変えるときは、`vscode-extension/package.json` と `src/lib/bundle.ts` の `VSCODE_EXTENSION_ID` をそろえてください。そろっていないと、「VS Code で開く」のリンクが拡張機能に届きません。

拡張機能のうち VS Code の API を使わない部分（`src/sync.ts` = ファイルを受け取って用意する、`src/history.ts` = 変更を集めて送る）は Node だけで動かせます。VS Code とつなぐのは `src/extension.ts`（リンクを受け取る）と `src/history-session.ts`（開いているフォルダーの保存を見張り、数秒待ってまとめて送る）です。

拡張機能が受け取るのは、リンクに書かれた https のサーバー（手元の開発では `http://localhost`）だけです。STEP Learn が「VS Code で開く」のリンクに入れるサーバーは `APP_ORIGIN`（なければ要求の URL）なので、リバースプロキシの配下では `APP_ORIGIN` を設定してください。

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
   - Secrets：`SESSION_SECRET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `SMTP_PASS` / `MOODLE_EXCHANGE_TOKEN` / `MOODLE_BACKCHANNEL_SECRET` / `OPENROUTER_API_KEY` / `CLAUDE_API_KEY`
   - Variables：`APP_ORIGIN` / `TRUST_PROXY` / `R2_ACCOUNT_ID` / `R2_BUCKET` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` / `MOODLE_URL` / `AI_EMAIL_DOMAIN`
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
src/lib/             設定・DB・認証・HTTP ヘルパー・Markdown・ストレージ・画像アップロード・コースの権限・AI（OpenRouter）・sandbox の呼び出し
src/moodle/          Moodle のバックアップの展開・読み取り・取り込み（CLI の moodle:import）
src/moodle-mode/     Moodle モード（MOODLE_URL を設定したときだけ使う。完全移行のあとは削除する）
moodle/              Moodle モード用の Moodle プラグイン（local_steplearn・mod_stepbundle）と検証用の Moodle（moodle/dev）
sandbox/             学生が書いたコードを実行するコンテナ（server.py が要求を受け、jail.py が権限を落として実行する）
vscode-extension/    ファイル自動配布のファイルを用意して開く VS Code の拡張機能（STEP Learn for VSCode）。本体とは別にビルドする
src/components/      レイアウトと UI 部品
src/routes/<ルート>/ auth / account / admin / dashboard / courses / content / participants / screen / code / bundle。
                     ルートごとに index.ts（ルーティング）・handlers.tsx（処理）・views.tsx（画面）・<ルート>.css に分ける
```
