#!/usr/bin/env bash
set -uo pipefail

input=$(cat)
cwd=$(printf '%s' "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
# CLAUDE_PROJECT_DIR だけで決めないのは、セッションの途中で worktree に入ったときも起動時のディレクトリを指したままになるため
cd "$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}")" || exit 0

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
