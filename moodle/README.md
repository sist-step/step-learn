# Moodle モード用のプラグインと検証環境

STEP Learn の Moodle モード（README の「Moodle モード」）で使う Moodle 側のものです。完全移行のあとはディレクトリごと削除します。

```
local_steplearn/   Moodle 5.1 のプラグイン（public/local/steplearn/ に置く）
dev/               手元で試すための Moodle 5.1（Docker）
```

## プラグインがすること

| 機能 | 中身 |
| --- | --- |
| ログインの受け渡し | `login.php` が Moodle でログインさせてから（手動・Microsoft など、Moodle で使えるどの方式でもよい）、使い捨てのコード（60 秒・1 回だけ、PKCE 付き）を付けて STEP Learn の `/auth/moodle/callback` に戻す。STEP Learn は `local_steplearn_exchange_code` でコードをトークンに交換する |
| ログアウト | `logout.php` が Moodle からもログアウトして STEP Learn のログイン画面に戻す。Moodle の画面でログアウトしたときは、STEP Learn に署名付きで知らせる（`user_loggedout` の監視） |
| コースの情報 | `local_steplearn_get_my_courses` / `local_steplearn_get_course`。ロール・編集できるか・進捗・教師の名前・参加者数・コース画像をまとめて返す |
| 教材の編集 | `local_steplearn_save_url` / `local_steplearn_save_resource`（URL・ファイルの活動の作成と更新）、`local_steplearn_create_section` / `local_steplearn_update_section`。Moodle 5.1 のコアには URL・ファイルの活動を作る Web サービスがないため |

並べ替え・表示の切り替え・削除は、コアの `core_courseformat_update_course` を使います（トピック形式・週形式など、コンポーネントに対応したコースフォーマットが必要です）。

## 本番の Moodle での設定

1. `local_steplearn/` を Moodle の `public/local/steplearn/` に置き、管理画面からインストールする
   - サイト管理 > プラグイン > プラグインをインストールする から入れる場合は、次のコマンドで作った `moodle/local_steplearn.zip`（git では管理しない）をアップロードする。zip の中のディレクトリ名はプラグインの名前の `steplearn` にする必要がある

     ```sh
     cd moodle && rm -f local_steplearn.zip && mkdir -p .zip && cp -R local_steplearn .zip/steplearn \
       && (cd .zip && zip -rqX ../local_steplearn.zip steplearn -x '*.DS_Store') && rm -rf .zip
     ```

2. サイト管理 > 一般 > 拡張機能 > Web サービス
   - 「Web サービスを有効にする」と「REST プロトコル」を有効にする
   - 認証済みユーザーのロールに `webservice/rest:use` を許可する
3. サイト管理 > プラグイン > ローカルプラグイン > STEP Learn
   - STEP Learn の URL：`APP_ORIGIN` と同じ（例 `https://lms.example.com`）
   - ログアウトの通知の鍵：STEP Learn の `MOODLE_BACKCHANNEL_SECRET` と同じ値（32 文字以上）
   - トークンの IP 制限：STEP Learn のサーバーの IP アドレス（任意。設定すると、漏れたトークンを他の場所から使えなくなる）
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
  --fullname="STEP Learn 検証" --shortname=steplearn-dev --adminuser=admin --adminpass='Moodle-dev-pass-1' --adminemail=admin@example.com
docker compose exec -u www-data moodle php /opt/steplearn-dev/seed.php
```

- Moodle は http://localhost:8080（管理者 `admin`、教師 `teacher1`、学生 `student1`、パスワードはすべて `Moodle-dev-pass-1`）
- `seed.php` が Web サービスとプラグインの設定、コード交換用のアカウント、テスト用のコース（リンク・ファイル・ラベル・課題・非表示のリンク）を作り、STEP Learn に渡す環境変数を表示します。何度実行してもかまいません
- Microsoft ログインは Entra ID の設定が要るので、この環境では試せません

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
