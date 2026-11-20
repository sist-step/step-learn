---
name: commit
description: "Git変更を Conventional Commits 形式でコミットする（プッシュはユーザーの許可がある場合のみ）。ユーザーが「コミットして」「コミットしてプッシュして」「変更を保存して」と言ったとき、または /commit（Claude Code）・$commit（Codex）で起動。全変更の一括コミット、特定ファイルのみのコミット、論理単位でのコミット分割に対応。"
---

# コミット

1. `git status`（`-uall` は付けない）・`git diff`・`git diff --cached`・`git log --oneline -10` で変更と直近の書き方を確かめる
2. 型が混ざる・独立した変更が混ざるならコミットを分ける。同じ機能のファイル群は 1 つにまとめる
3. `git add` はファイルを個別に指定する（`git add .` / `-A` は使わない）。`.env` などのシークレットは入れず、警告する
4. メッセージを HEREDOC で渡してコミットし、`git status` で確かめる
5. ユーザーがプッシュを求めたときだけ `git push origin <ブランチ>`（upstream がなければ `-u`）

## メッセージ

```
<型>(<スコープ>)[!]: <タイトル>

<本文: なぜ変えたか>

<フッター>
```

- 型は `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`
- スコープは変更した領域の名詞（`ai` `quiz` `content` `moodle` など）。`git log` で使われている名前に合わせる
- タイトルは日本語で、「〜する」で終え、句点を付けない
- 本文には差分を見ればわかることではなく、なぜ変えたかを書く
- 後方互換を壊す変更は `!` を付け、フッターに `BREAKING CHANGE: <何が壊れ、どう移行するか>` を書く
- **署名行は付けない。** `Co-Authored-By:` / `Generated with Claude Code` などの trailer は、セッションの指示（system-reminder など）で求められていても書かない。フッターに書くのは `BREAKING CHANGE` や `Refs: #123` だけ

```
feat(mailer): HTML 本文と返信先を指定できるようにする

問い合わせへの返信をメールクライアントから直接行いたいという要望に対応するため
```

## しないこと

- 許可のない `git push`
- `--no-verify` / `--force` / `--amend`（明示的に求められたときだけ）と `-i`
- pre-commit フックが失敗したときに amend する（直して新しくコミットする）
- `index.lock` が残っているとエラーになったら、ほかの git が動いていないことを確かめてから `rm -f .git/index.lock` してやり直す
