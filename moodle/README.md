# Moodle モードとプラグイン

STEP Learn の Moodle モードと、Moodle からの取り込み（`npm run moodle:migrate`）で使うものです。完全移行のあとはディレクトリごと削除します。

```
local_steplearn/   Moodle 5.1 のプラグイン（public/local/steplearn/ に置く）
mod_stepbundle/    活動「ファイル自動配布」のプラグイン（public/mod/stepbundle/ に置く。local_steplearn が要る）
dev/               手元で試すための Moodle 5.1（Docker）
```

## Moodle モードで動かす

`MOODLE_URL` を設定すると、STEP Learn を Moodle 5.1 のフロントエンドとして動かします。データは Moodle にあり、STEP Learn は画面と、Moodle モードだけにある種類のアイテムの中身（`data/moodle-mode.db`）を受け持ちます。完全移行までの一時的な運用です。

Moodle 側は下の「本番の Moodle での設定」のとおりにプラグインを入れて設定し、STEP Learn には次の環境変数を設定して起動します。

| 環境変数 | 内容 |
| --- | --- |
| `MOODLE_URL` | Moodle の URL（例 `https://moodle.example.ac.jp`）。設定すると Moodle モードになります |
| `MOODLE_EXCHANGE_TOKEN` | ログインのコードを交換する専用アカウントのトークン（必須） |
| `MOODLE_BACKCHANNEL_SECRET` | Moodle からの通知（ログアウト・コースの内容の変更）を検証し、STEP Learn からのログアウトに署名する鍵（32 文字以上。プラグインの設定と同じ値）。未設定なら通知を受け付けず、ログアウトのたびに Moodle の確認画面が出て、Moodle の画面で変えた内容が出るまで最大 40 秒ほどかかります |

### 完全移行したら削除するもの

- `src/moodle-mode/`・`migrations-moodle/`・`drizzle.moodle.config.ts`・`moodle/`
- `src/index.tsx` のモードの切り替え（`./app` だけを読み込む形に戻す）と、`src/server.ts`・`vite.config.ts` の `config.moodle` の分岐
- `src/lib/config.ts` の `moodle` / `moodleDatabasePath` / `moodleMigrate`、`src/lib/db.ts` の Moodle モードのガード、`src/components/style.tsx` の `moodle-mode.css`
- `src/moodle/` と `src/cli.ts` の `moodle:migrate`、`src/lib/forms.ts` の `extraItemFields` / `extraItem` / `extraCode`、`src/features/bundle/bundle.ts` の `BUNDLE_MODULE`、`src/client.ts` の `setKindOnly`
- コーディング問題を 2 つのモードで使い回すための分け方（`src/features/code/handlers.tsx` の `CodeBackend`、`src/features/code/code-store.ts` の `CodeStore`、`src/features/code/code-grader.ts` の `createGrader`、`src/features/code/views.tsx` の `CodePage`）は、通常モードの実装（`src/features/code/backend.ts`・`src/features/code/code-items.ts`・`src/features/code/code-grading.ts`）だけになるので、まとめてかまいません
- ほかの機能の、2 つのモードのための分け方も同じです。実装が 1 つになるので、`backend.ts` の中身をハンドラに入れ、型だけのインターフェースは消してかまいません
  - `src/features/<機能>/backend.ts` と `create<機能>Handlers(backend)` の組（agent・bundle・code・collab・presentation・quiz・mcp・ai の `AiBackend`・admin の `AiAdminBackend`）
  - Store のインターフェース（`CodeStore`・`QuizStore`・`BundleStore`・`BundleSyncStore`・`AgentStore`・`PresentationStore`・`CollabStore`）
  - socket の Backend（`ShareBackend`・`CollabSocketBackend`・`PresentationSocketBackend`）と、通常モードの `*-access.ts`
  - DB とテーブルを受け取って作る `createOAuthStore`・`createAiLedger`・`createAiChatStore`
- `package.json` の `moodle:migrate` / `db:generate:moodle` / `db:check:moodle`、CI の「Check Moodle mode migrations」、`Dockerfile` の `migrations-moodle`、`.dockerignore` の `moodle`

## Moodle から取り込む

Moodle の Web サービスからコースを読んで、STEP Learn の新しいコースとして取り込みます（CLI は `npm run build` で生成されます）。

```sh
MOODLE_MIGRATE_URL=https://moodle.example.ac.jp MOODLE_MIGRATE_TOKEN=<トークン> \
  npm run moodle:migrate -- 12 13 --dry-run   # コース ID 12 と 13 のプレビューだけを表示する
```

- Moodle に `local_steplearn` のプラグインが入っている必要があります（Moodle モードと同じもの）
- トークンは、すべてのコースでユーザーを含めたバックアップを作れるアカウント（システムのコンテキストで「マネージャー」を割り当てたアカウントなど）のものを、外部サービス「STEP Learn」で発行します。参加者と学生のファイルを読むのに、`moodle/backup:backupcourse` と `moodle/backup:userinfo` が要ります
- コースごとに、作られるセクション・アイテム・参加者と、取り込まないもの・変換で失われるものをプレビューに表示し、確認してから取り込みます。`--yes` で確認を省き、`--verbose` で学生をすべて表示します
- 1 回の実行で、コースごとに新しいコースを 1 つ作ります。同じコースを 2 回取り込むとコースが 2 つできます（プレビューで警告します）

| Moodle | STEP Learn |
| --- | --- |
| URL | リンク（http / https のみ） |
| ファイル | ファイル（メインのファイル 1 つ） |
| フォルダ | 中のファイルごとにファイルのアイテム |
| 学生フォルダ（mod_publication） | 学生フォルダ。教師の承認・名前の表示・提出の期間と、学生のファイル（Moodle で公開されていたものは公開、承認を断られたものは非公開、それ以外は承認待ち）を引き継ぐ。学生のファイルは、持ち主を参加者として取り込むときだけ移す（グループでの提出は移さない）。学生の承認は教師の承認として扱い、期限の延長・上書き、ファイルの種類の制限、課題からの取り込みは引き継がない |
| サブセクション | 親のセクションの中の同じ位置のサブセクション |
| ページ・ラベル・ブック・課題・小テスト・フォーラムなど | 取り込まない |
| Moodle モードで追加した、STEP Learn にしかない種類のアイテム | 取り込まない |
| 表示 / 非表示、完了トラッキング | 学生に非表示、完了の条件（手動は「学生が自分で完了にする」、自動は「開いたら完了」） |
| アクセス制限（日付・条件） | 取り込まない（制限なしで表示される） |
| 教師・編集権限のない教師・マネージャー / 学生（コースで割り当てたロール） | 教師 / 学生（削除・停止されたユーザーと、受講が止まっている人は除く） |

- 同じメールアドレスのユーザーがすでにいれば、そのユーザーを参加者に加えます。いなければ作成します（Moodle のユーザー名が規則に合い、空いていれば引き継ぎます。`taro@example.ac.jp` のようなユーザー名は `@` より前の `taro` を引き継ぎます）
- Moodle のパスワードは引き継げません。新しく作ったユーザーには、ログイン画面の「パスワードを忘れた場合」からパスワードを設定してもらってください（SMTP の設定が必要です）
- 学生の完了状況や評定は取り込みません

## プラグインがすること

| 機能 | 中身 |
| --- | --- |
| ログインの受け渡し | `login.php` が Moodle でログインさせてから（手動・Microsoft など、Moodle で使えるどの方式でもよい）、使い捨てのコード（60 秒・1 回だけ、PKCE 付き）を付けて STEP Learn の `/auth/moodle/callback` に戻す。STEP Learn は `local_steplearn_exchange_code` でコードをトークンに交換する |
| ログアウト | `logout.php` が Moodle からもログアウトして STEP Learn のログイン画面に戻す。STEP Learn は Moodle のセッションと時刻をログアウトの通知の鍵で署名して渡し、署名がない（または正しくない）ときは、他のサイトから踏ませた強制ログアウトを防ぐため確認画面を出す。Moodle の画面でログアウトしたときは、STEP Learn に署名付きで知らせる（`user_loggedout` の監視）。時間切れや管理者による強制ログアウトは通知が来ないので、STEP Learn が 1 分おきに `local_steplearn_check_session` で Moodle のセッションが続いているかを確かめ、切れていればログアウトさせる（続いていれば Moodle のセッションも延長する） |
| コースの変更の通知 | Moodle の画面でコースの内容を変えたら、STEP Learn に署名付きで知らせる（ログアウトと同じ通知先と鍵）。STEP Learn はそのコースのキャッシュを捨て、開いている画面に 10 秒ほどで出す。活動・セクション・コースの作成・変更・削除とリストアはイベントで、コース画面での並べ替え・表示の切り替え・削除は `after_course_content_updated` のフックで拾い、1 回の要求で変わったコースをまとめて、要求の終わりに 1 度だけ送る |
| コースの情報 | `local_steplearn_get_my_courses` / `local_steplearn_get_course`。ロール・編集できるか・進捗・教師の名前・参加者数・コース画像をまとめて返す。`local_steplearn_get_other_courses` は、管理者（`moodle/course:view` を持つ人）に参加していないコースを同じ形で返す（コース一覧の「登録外も表示」）。`get_course` は、タイル（format_tiles）と折りたたみ型トピック（format_topcoll）のコースではその表示の設定も返す |
| セクションの開閉 | `local_steplearn_set_sections_collapsed`。STEP Learn で開閉したセクションを、Moodle のコース画面と同じユーザー設定（`coursesectionspreferences_<コース ID>`）に記録する |
| 新しい STEP Learn の案内 | 設定の「新しい STEP Learn を案内する」をオンにすると、ログイン画面（ログインフォームの中）とダッシュボード（通知）に「新しい STEP Learn を使う」ボタンを出す。ボタンは STEP Learn の `GET /auth/moodle/start` に移り、そのままログインの受け渡しを始める（Moodle にログイン済みなら画面を挟まずに入れる）。STEP Learn の「旧STEP Learnでログイン」から来てログイン画面にいる人には出さない |
| 教材の編集 | `local_steplearn_save_url` / `local_steplearn_save_resource`（URL・ファイルの活動の作成と更新）、`local_steplearn_create_section` / `local_steplearn_update_section`。Moodle 5.1 のコアには URL・ファイルの活動を作る Web サービスがないため |
| アクセス制限 | `local_steplearn_get_restrictions` が、編集できる人にセクションと活動の制限（教師向けのすべての条件の説明と、STEP Learn で編集できる形か）を返す（Moodle は条件を満たせる教師には制限の説明を返さないため）。`local_steplearn_set_restriction` は、日付（開始・終了）と活動の完了をすべて満たす形の制限で置き換える。それ以外の条件（グループ・評点・「いずれか」など）を含む制限は書き換えを断り、Moodle の画面で編集してもらう |
| 取り込み | `local_steplearn_get_participants` がコースでロールを割り当てた人（ロールの元の種類・受講の状態付き）を、`local_steplearn_get_publications` が学生フォルダ（mod_publication）の設定と学生のファイルを返す。`npm run moodle:migrate` が使う。学生の個人情報をまとめて読むので、ユーザーを含めたバックアップを作れる人（`moodle/backup:backupcourse` と `moodle/backup:userinfo`）にだけ返す。mod_publication がない Moodle では、学生フォルダは空の一覧になる |

並べ替え・表示の切り替え・削除は、コアの `core_courseformat_update_course` を使います（トピック形式・週形式など、コンポーネントに対応したコースフォーマットが必要です）。

## ファイル自動配布の活動（mod_stepbundle）

STEP Learn の「ファイル自動配布」のアイテムを、Moodle のコースに活動として置くためのプラグインです。配布するファイル・zip・「VS Code で開く」は STEP Learn にあり、Moodle が持つのは活動の名前・説明と、STEP Learn がファイルを見分けるための鍵だけです。

| 機能 | 中身 |
| --- | --- |
| 開く | `view.php` が開いたことを記録して（「開いたら完了」の条件を満たす）、STEP Learn のアイテムの画面（`<STEP Learn の URL>/courses/<コース ID>/items/<cmid>`）に移す。`local_steplearn` の「STEP Learn の URL」が空のときは、設定されていないことを表示する |
| 作る・変える | Moodle の活動の追加・編集の画面（名前と説明だけ。ファイルの欄はない）と、STEP Learn が呼ぶ `mod_stepbundle_save` |
| 開いたことの記録 | STEP Learn の画面で開いたときに呼ぶ `mod_stepbundle_view` |
| 鍵 | 活動を作るときに決め、`core_course_get_contents` の `customdata` で STEP Learn に渡す。バックアップにも含め、ごみ箱から戻したときは同じ鍵（前のファイルにつながる）、複製やコースのコピーで元の活動が残っているときは新しい鍵（ファイルのない状態から始まる）にする |

2 つの Web サービスの関数は、`local_steplearn` の外部サービス「STEP Learn」に登録してあります。STEP Learn は、`local_steplearn_get_course` の `bundle` でこのプラグインが入っているかを確かめ、入っていなければファイル自動配布を追加できないようにします。

## 本番の Moodle での設定

1. `local_steplearn/` を Moodle の `public/local/steplearn/` に置き、管理画面からインストールする。ファイル自動配布を使うときは、続けて `mod_stepbundle/` を `public/mod/stepbundle/` に置いてインストールする（`local_steplearn` を先に入れる。すでに入っているときは、先に新しいものに更新する）
   - サイト管理 > プラグイン > プラグインをインストールする から入れる場合は、次のコマンドで作った `moodle/local_steplearn.zip`・`moodle/mod_stepbundle.zip`（git では管理しない）をアップロードする。zip の中のディレクトリ名はプラグインの名前の `steplearn`・`stepbundle` にする必要がある
   - `mod_stepbundle` を入れるときは、STEP Learn を先に新しいものに更新しておく。古い STEP Learn はこの活動を知らず、Moodle の画面へのリンクとして出すので、開くと STEP Learn と Moodle の間を行き来してしまう

     ```sh
     make moodle-zip    # リポジトリのルートで実行する。消すときは make moodle-zip-clean
     ```

2. サイト管理 > 一般 > 拡張機能 > Web サービス
   - 「Web サービスを有効にする」と「REST プロトコル」を有効にする
   - 認証済みユーザーのロールに `webservice/rest:use` を許可する
3. サイト管理 > プラグイン > ローカルプラグイン > STEP Learn
   - STEP Learn の URL：`APP_ORIGIN` と同じ（例 `https://lms.example.com`）
   - 通知の鍵：STEP Learn の `MOODLE_BACKCHANNEL_SECRET` と同じ値（32 文字以上）。設定しないと、STEP Learn からログアウトするたびに Moodle の確認画面が出て、Moodle の画面で変えた内容が STEP Learn に出るまで最大 40 秒ほどかかる
   - トークンの IP 制限：STEP Learn のサーバーの IP アドレス（任意。設定すると、漏れたトークンを他の場所から使えなくなる）
   - 新しい STEP Learn を案内する：移行を案内し始めるときにオンにする（既定はオフ）。文言はサイト管理 > 言語 > 言語のカスタマイズ で `local_steplearn` の `bannermessage`・`bannerbutton` を変える
4. コードの交換に使う専用のアカウントを作る
   - ユーザー（例 `steplearn_service`）を作り、システムのコンテキストのロール（例「STEP Learn 交換」）を作って `local/steplearn:exchangecode` と `webservice/rest:use` を許可し、割り当てる
   - 外部サービス「STEP Learn exchange」の許可されたユーザーにこのアカウントを追加する
   - このアカウントのトークンを「STEP Learn exchange」で発行し（STEP Learn のサーバーの IP に制限するのがおすすめ）、STEP Learn の `MOODLE_EXCHANGE_TOKEN` に設定する
5. Microsoft アカウントの利用者で、STEP Learn からログインできることを確かめる

利用者のトークンは、プラグインが外部サービス「STEP Learn」で発行します（利用者に `moodle/webservice:createtoken` を許可する必要はありません）。期限は Moodle の「トークンの有効期間」（`tokenduration`、既定 12 週間）に従い、切れると STEP Learn がログインし直させます（Moodle のセッションが残っていれば画面は出ません）。

Moodle からログアウトの通知を送るときは Moodle の curl のセキュリティ設定が効くので、STEP Learn がプライベート IP にある場合は「cURL ブロックホスト」から外してください。

## 検証環境（moodle/dev）

```sh
cd moodle/dev
mkdir -p .moodle && curl -L https://download.moodle.org/download.php/direct/stable501/moodle-latest-501.tgz | tar xz -C .moodle
cp config.php .moodle/moodle/config.php
docker compose up -d
docker compose exec moodle chown -R www-data:www-data /var/www/moodledata
docker compose exec -u www-data moodle php admin/cli/install_database.php --agree-license \
  --fullname="STEP Learn 検証" --shortname=steplearn-dev --adminuser=admin --adminpass='admin' --adminemail=admin@example.com
docker compose exec -u www-data moodle php /opt/steplearn-dev/seed.php
```

- Moodle は http://localhost:8080（管理者 `admin`、教師 `teacher`、学生 `student`。パスワードはどれもユーザー名と同じ）
- `seed.php` が Web サービスとプラグインの設定、コード交換用のアカウント、テスト用のコース（リンク・ファイル・ラベル・課題・非表示のリンク）を作り、STEP Learn に渡す環境変数を表示します。何度実行してもかまいません
- Microsoft ログインは Entra ID の設定が要るので、この環境では試せません
- `compose.yaml` は `local_steplearn/` と `mod_stepbundle/` をコンテナに差し込みます。プラグインを足したり版を上げたりしたあとは、次のコマンドで Moodle に反映します（`compose.yaml` に差し込みが増えたときは、コンテナも作り直されます）

  ```sh
  docker compose up -d
  docker compose exec -u www-data moodle php admin/cli/upgrade.php --non-interactive
  ```
- タイルと折りたたみ型トピックを試すときは、プラグインを `.moodle/moodle/public/course/format/` に入れてから `seed.php` を実行し直すと、それぞれのコースも作ります

  ```sh
  git clone --depth 1 -b moodle51 https://bitbucket.org/dw8/moodle-format_tiles.git .moodle/moodle/public/course/format/tiles
  git clone --depth 1 -b MOODLE_501 https://github.com/gjb2048/moodle-format_topcoll.git .moodle/moodle/public/course/format/topcoll
  docker compose exec -u www-data moodle php admin/cli/upgrade.php --non-interactive
  docker compose exec -u www-data moodle php /opt/steplearn-dev/seed.php
  ```

STEP Learn は、表示された環境変数を付けて別のポートで起動します。

```sh
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=host.docker.internal \
MOODLE_URL=http://localhost:8080 MOODLE_EXCHANGE_TOKEN=<seed.php が表示した値> \
MOODLE_BACKCHANNEL_SECRET=dev-backchannel-secret-0123456789abcdef \
npx vite --port 5174 --strictPort --host 127.0.0.1
```

- ポートを 5174 にするのは、プラグインの戻り先（`seed.php` の `APP_URL`）に合わせるためです
- `--host 127.0.0.1` と `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` は、Docker の Moodle から `host.docker.internal` 経由でログアウトの通知を届けるためです
- `config.php` はデバッグ表示を有効にしているので、ログアウトの通知が失敗すると Moodle の画面に警告が出て自動の移動が止まります
