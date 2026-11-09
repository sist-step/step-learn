// 管理用 CLI。`npm run build` で dist/server/cli.js にビルドされる。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { USERNAME_TAKEN, createUser, isUsernameTaken } from './lib/auth'
import { config } from './lib/config'
import { isEmail } from './lib/forms'
import { checkPassword } from './lib/password'
import { ROLE_LABELS, type Role } from './lib/types'
import { checkUsername, normalizeUsername } from './lib/username'
import { openBackup } from './moodle/archive'
import { readBackup } from './moodle/backup'
import { PARTICIPANT_LIMIT, planImport, printPreview, runImport, type Plan } from './moodle/import'
import { readRemoteCourse } from './moodle/remote'

const USER_CREATE_USAGE = `使い方: npm run user:create -- --email <メールアドレス> --name <氏名> --username <ユーザー名> [--role admin|teacher|student]

ユーザーを作成します。ロールを省略すると管理者になります。
パスワードは対話的に入力します（パイプで渡した場合は 1 行目を使います）。`

const MOODLE_IMPORT_USAGE = `使い方: npm run moodle:import -- <バックアップ.mbz または展開したディレクトリ> [--dry-run] [--yes] [--verbose]

Moodle のコースバックアップから、コース・セクション・アイテム・参加者を取り込みます。
取り込む前に内容のプレビューを表示し、確認してから書き込みます。

  --dry-run   プレビューだけを表示して、何も書き込まずに終了する
  --yes, -y   確認せずに取り込む（パイプやスクリプトから実行するとき）
  --verbose   プレビューで学生をすべて表示する（既定は ${PARTICIPANT_LIMIT} 人まで）`

const MOODLE_MIGRATE_USAGE = `使い方: npm run moodle:migrate -- <コース ID>... [--dry-run] [--yes] [--verbose]

Moodle の Web サービスからコースを読み、セクションと URL・ファイル・フォルダーを取り込みます（参加者とほかの活動は取り込みません）。
コースごとに内容のプレビューを表示し、確認してから書き込みます。

  --dry-run   プレビューだけを表示して、何も書き込まずに終了する
  --yes, -y   確認せずに取り込む（パイプやスクリプトから実行するとき）
  --verbose   プレビューで学生をすべて表示する

環境変数 MOODLE_MIGRATE_URL（Moodle の URL）と MOODLE_MIGRATE_TOKEN（すべてのコースを見られるアカウントの、外部サービス「STEP Learn」のトークン）が必要です。`

const USAGE = `${USER_CREATE_USAGE}\n\n${MOODLE_IMPORT_USAGE}\n\n${MOODLE_MIGRATE_USAGE}`

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

async function confirm(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(question).catch(() => '')
    return /^y(es)?$/i.test(answer.trim())
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
  const usernameError = checkUsername(username) ?? (isUsernameTaken(username) ? USERNAME_TAKEN : null)
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

/** プレビューのあと、確認してから書き込む */
async function confirmAndImport(plan: Plan, values: { 'dry-run': boolean; yes: boolean }) {
  if (values['dry-run']) {
    console.log('--dry-run のため、何も書き込まずに終了します。')
    return
  }
  if (!values.yes) {
    if (!process.stdin.isTTY) throw new Error('確認の入力ができないため中止しました。確認せずに取り込むには --yes を付けてください。')
    if (!(await confirm('この内容で取り込みますか？ [y/N] '))) {
      console.log('取り込みを中止しました。')
      return
    }
  }

  const tty = process.stdout.isTTY
  const result = await runImport(plan, (message) => (tty ? process.stdout.write(`\r\x1b[K${message}`) : console.log(message)))
  if (tty) process.stdout.write('\r\x1b[K')
  console.log(
    [
      `コース「${plan.backup.course.title}」を作成しました（/courses/${result.courseId}）。`,
      `セクション ${result.sections}・アイテム ${result.items}・参加者 ${result.enrolled} 人（うち新規ユーザー ${result.createdUsers} 人）`,
    ].join('\n'),
  )
}

async function moodleImportCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      verbose: { type: 'boolean', default: false },
    },
  })
  if (positionals.length !== 1) fail(MOODLE_IMPORT_USAGE)
  const [source] = positionals

  console.log(`${source} を読み込んでいます…`)
  const { dir, cleanup } = await openBackup(source)
  // fail() を使わずに throw するのは、process.exit() だと finally が動かず、展開した一時ファイルが残るため
  try {
    const plan = await planImport(readBackup(dir))
    printPreview(plan, path.basename(source), { verbose: values.verbose })

    await confirmAndImport(plan, values)
  } finally {
    await cleanup()
  }
}

async function moodleMigrateCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      verbose: { type: 'boolean', default: false },
    },
  })
  const ids = positionals.map(Number)
  if (!ids.length || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) fail(MOODLE_MIGRATE_USAGE)
  const site = config.moodleMigrate
  if (!site) fail('MOODLE_MIGRATE_URL と MOODLE_MIGRATE_TOKEN を設定してください。\n\n' + MOODLE_MIGRATE_USAGE)

  for (const id of ids) {
    const source = `${site.url}/course/view.php?id=${id}`
    console.log(`${source} を読み込んでいます…`)
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'step-learn-migrate-'))
    // fail() を使わずに throw するのは、process.exit() だと finally が動かず、取得したファイルが残るため
    try {
      const plan = await planImport(await readRemoteCourse(site, id, dir))
      printPreview(plan, source, { verbose: values.verbose })
      await confirmAndImport(plan, values)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  }
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'user:create') await createUserCommand(rest)
  else if (command === 'moodle:import') await moodleImportCommand(rest)
  else if (command === 'moodle:migrate') await moodleMigrateCommand(rest)
  else fail(USAGE)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
