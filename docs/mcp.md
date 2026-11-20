# AI アプリから使う（MCP）

STEP Learn は MCP サーバー（Streamable HTTP、`<APP_ORIGIN>/mcp`）で、自分自身が OAuth 2.1 の認可サーバーにもなります。教師が AI アプリにこの URL を追加すると、初回に STEP Learn の同意の画面が開き、ログインしている本人として接続します。

- 使えるのは、`AI_EMAIL_DOMAIN` のメールアドレスの教師・管理者です（Moodle モードでは、Moodle のサイト管理者かいずれかのコースを管理できる人）
- つなげるのは Claude・ChatGPT と、手元のアプリ（`http://localhost` などの任意のポート）だけです。ほかのアプリを足すときは `src/features/mcp/oauth.ts` を変えます
- リバースプロキシの後ろでは `APP_ORIGIN` を設定してください。AI アプリは、利用者が入力した URL とサーバーが返す resource（`<APP_ORIGIN>/mcp`）が完全に一致することを求めます
- Moodle モードでは、同意するときに Moodle にログインしている必要があります
