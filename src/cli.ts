// 管理用 CLI。`npm run build` で dist/server/cli.js にビルドされる。
import readline from 'node:readline/promises'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { createUser } from './lib/auth'
import { isEmail } from './lib/http'
import { checkPassword } from './lib/password'
import { ROLE_LABELS, type Role } from './lib/types'
import { checkUsername, normalizeUsername } from './lib/username'

const USAGE = `使い方: npm run user:create -- --email <メールアドレス> --name <氏名> --username <ユーザー名> [--role admin|teacher|student]

ユーザーを作成します。ロールを省略すると管理者になります。
パスワードは対話的に入力します（パイプで渡した場合は 1 行目を使います）。`

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// 引数で受け取らないのは、シェルの履歴やプロセス一覧にパスワードが残るため
async function readPassword() {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin })
    for await (const line of rl) {
      rl.close()
      return line
    }
    return ''
  }

  let muted = false
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding)
      callback()
    },
  })
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true })
  rl.on('SIGINT', () => {
    process.stdout.write('\n')
    process.exit(130)
  })
  const ask = async (prompt: string) => {
    const answer = rl.question(prompt)
    muted = true
    try {
      return await answer
    } finally {
      muted = false
      process.stdout.write('\n')
    }
  }

  try {
    const password = await ask('パスワード: ')
    if ((await ask('パスワード（確認）: ')) !== password) fail('パスワードが一致しません。')
    return password
  } finally {
    rl.close()
  }
}

async function createUserCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      username: { type: 'string' },
      role: { type: 'string', default: 'admin' },
    },
  })
  const email = (values.email ?? '').trim().toLowerCase()
  const name = (values.name ?? '').trim()
  const username = normalizeUsername(values.username ?? '')
  const role = values.role as Role

  if (!isEmail(email)) fail('--email に有効なメールアドレスを指定してください。')
  if (!name || name.length > 60) fail('--name に 60 文字以内の氏名を指定してください。')
  const usernameError = checkUsername(username)
  if (usernameError) fail(`--username: ${usernameError}`)
  if (!Object.hasOwn(ROLE_LABELS, role)) fail('--role には admin / teacher / student のいずれかを指定してください。')

  // ログインフォームの field() と同じ扱いにしないと、作成したパスワードでログインできなくなる
  const password = (await readPassword()).trim()
  if (password.length > 200) fail('パスワードは 200 文字以内にしてください。')
  const passwordError = checkPassword(password, { email, name, username })
  if (passwordError) fail(passwordError)

  const created = await createUser({ email, name, username, password, role })
  if ('taken' in created)
    fail(created.taken === 'email' ? `${email} はすでに登録されています。` : `ユーザー名 ${username} はすでに使われています。`)
  console.log(`${ROLE_LABELS[role]}「${name}」（@${username}、${email}）を作成しました。`)
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'user:create') await createUserCommand(rest)
  else fail(USAGE)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
