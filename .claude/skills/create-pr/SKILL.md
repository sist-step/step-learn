---
name: create-pr
description: "StepLearn のプルリクエストを .github/pull_request_template.md に沿って作成する手順。ユーザーが「PR を作って」「プルリクを出して」「レビューに出して」と言ったとき、または /create-pr（Claude Code）・$create-pr（Codex）で起動。ブランチの確認・プッシュ・gh pr create まで行う。"
---

# PR の作成

## 1. 前提の確認

- 現在のブランチが `master` なら、作業内容に合った名前（`feature/` `fix/` `chore/` `docs/`）のブランチを切る
- 未コミットの変更があれば `commit` スキルでコミットする
- `verify` スキルの確認をまだしていなければ先に行う

## 2. 差分の把握（並列実行）

- `git log --oneline master..HEAD`
- `git diff master...HEAD --stat`
- `git diff master...HEAD`

## 3. 本文の作成

`.github/pull_request_template.md` の見出しをすべて残して埋める。

- **概要**: 何をなぜ変えたかを 1〜3 行。関連 Issue があれば `Closes #番号`
- **変更の種類**: 当てはまるものを `[x]` にする
- **変更内容**: 主な変更を箇条書き。レビューしてほしい箇所があれば明記
- **スクリーンショット**: UI を変えた場合は「Before / After を添付してください」とユーザーに伝える（自分で撮れた場合は貼る）。UI 変更がなければ「UI の変更なし」と書く
- **動作確認**: `verify` で実際に確認したものだけ `[x]` にする。確認していない項目にチェックを付けない
- **DB・設定の変更**: マイグレーションを足したならファイル名を書く
- **補足**: やらなかったこと、既知の問題、今後の TODO

タイトルはコミットメッセージと同じ `種類: 内容` の形で日本語。コミットが 1 つならそのタイトルを使う。

## 4. 作成

プッシュと PR の作成は外部に公開する操作なので、ユーザーが PR の作成を依頼した場合だけ行う。

```bash
git push -u origin <branch>
gh pr create --base master --title "<タイトル>" --body "$(cat <<'EOF'
<本文>
EOF
)"
```

作成したら PR の URL を報告する。
