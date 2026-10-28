# 開発の進め方

## 必要なもの

- Node.js 24 以上（`.nvmrc` 参照。`nvm use` で切り替えられます）
- npm

```sh
npm install
npm run dev
```

## ブランチ

`master` から作業ブランチを切り、PR でマージします。`master` へ直接 push はしません。

| 種類 | ブランチ名の例 |
| --- | --- |
| 新機能 | `feature/assignments` |
| バグ修正 | `fix/login-redirect` |
| 開発環境・CI・依存関係 | `chore/dev-setup` |
| ドキュメント | `docs/readme-deploy` |

## コミットメッセージ

`種類: 内容` の形で、日本語で簡潔に書きます。

```
feat: 課題の提出機能を追加
fix: 登録キーが空のときに参加できない問題を修正
chore: CI に型チェックを追加
```

種類は `feat` / `fix` / `refactor` / `style` / `docs` / `chore` / `test` のいずれかです。

## プルリクエスト

1. PR テンプレートに沿って概要・動作確認を書く
2. CI（型チェック・ビルド）が通っていることを確認する
3. CODEOWNERS のレビュー承認を得てからマージする

UI を変更した場合はスクリーンショットを添付してください。
DB のスキーマを変える場合は `migrations/` に新しい連番ファイルを追加し、既存のマイグレーションは編集しないでください。
