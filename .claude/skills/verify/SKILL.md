---
name: verify
description: "StepLearn で実装を終えたあと、完了を報告する・コミットする・PR を作る前に行う確認手順（型チェック・ビルド・マイグレーション確認・開発サーバーでの動作確認・規約のセルフレビュー）。コードを変更した作業の最後には必ず読み込む。「確認して」「動くか見て」「チェックして」「できた？」などの依頼も対象。"
---

# 完了前の確認

テストフレームワークはないので、以下を順に行い、結果をそのまま報告する。通らなかったものを「通った」と書かない。

## 1. 機械的なチェック

```sh
npm run typecheck
npm run build
```

スキーマや `migrations/` を変えた場合は追加で:

```sh
npm run db:check
```

どれかが失敗したら直してから先へ進む。

## 2. 動作確認

```sh
npm run dev   # http://localhost:5173
```

- 開発サーバーはバックグラウンドで起動し、終わったら止める
- ログインが必要な画面は、ユーザーを CLI で作ってから確かめる（CLI は `npm run build` 後に使える。作成済みのユーザーはエラーになるので飛ばしてよい）

  ```sh
  printf 'step-learn-dev-pass\n' | npm run user:create -- --email admin@example.com --name "管理者"
  printf 'step-learn-dev-pass\n' | npm run user:create -- --email teacher@example.com --name "教師" --role teacher
  printf 'step-learn-dev-pass\n' | npm run user:create -- --email student@example.com --name "学生" --role student
  ```

- ブラウザで確認できる環境なら、変更した画面を実際に操作する。できなければ `curl` でステータスコードと HTML を確かめる
- 確認すること
  - 正常系: 入力 → 送信 → リダイレクト → トースト表示 → 結果が反映されている
  - 異常系: 空欄・長すぎる入力・不正な ID（`/courses/999999` など）
  - 権限: 管理者 / 教師 / 学生 / 未ログインで URL を直接開き、見えてはいけない画面が 404 になる
  - UI を変えた場合: ダークモードとスマホ幅（375px 前後）
- サーバーのログにエラーが出ていないこと

`data/` は開発用の DB なので、作ったテストデータは残してよい。消したいときはサーバーを止めて `data/` を削除する。

## 3. セルフレビュー

`git diff master...HEAD` と未コミットの差分を読み、以下を確かめる。

- [ ] `coding-style` の書式（セミコロンなし・シングルクォート・2 スペース）に合っている
- [ ] 何をしているかを説明するだけのコメントを書いていない。コメントは Why not だけ
- [ ] 全ハンドラの先頭で `intParam` と権限チェックをしており、権限がなければ `c.notFound()`
- [ ] フォームの値は `field(form, key, 最大長)` で取っている
- [ ] SQL に値を連結していない（`?` で渡している）
- [ ] 色を直接書かず CSS トークンを使っている
- [ ] 既存の `migrations/` を変更していない
- [ ] 不要な依存を足していない
- [ ] 環境変数を足したなら `.env.example` と README を更新した
- [ ] 使わなくなったコード・CSS・import を残していない

## 4. 報告

何を確認し、どうなったかを短く書く。確認できなかった項目（ブラウザがなくて画面を見ていない、など）があれば、その旨をはっきり書く。
