#!/usr/bin/env bash
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

input=$(cat)
# 型エラーを直せないまま止め続けると無限に再開してしまうので、フックで再開された回では止めない
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

if [ -z "$(git status --porcelain -- src scripts '*.ts' '*.tsx' 2>/dev/null)" ]; then
  exit 0
fi

if ! output=$(npm run --silent typecheck 2>&1); then
  {
    echo "型チェック（npm run typecheck）が失敗しています。修正してから終了してください。"
    echo "$output" | tail -n 40
  } >&2
  exit 2
fi
exit 0
