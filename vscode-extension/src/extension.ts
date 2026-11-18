import path from 'node:path'
import * as vscode from 'vscode'
import { claimAgent } from './agent-core'
import { AgentController } from './agent-view'
import { claimCode, markSynced, planCode, readLocal, saveDraft, writeLocal, type CodeRecord, type CodeSynced } from './code-item'
import { CodeSession, chooseSide, codeSyncedKey, codeTokenKey } from './code-session'
import { HistorySession, confirmSync, tokenKey } from './history-session'
import { claimPresentation } from './presentation-core'
import { PRESENTATION_MENU_COMMAND, PresentationSession, powerPointFor } from './presentation-session'
import {
  SyncError,
  claim,
  download,
  exists,
  folderName,
  freshFolder,
  parseServer,
  plan,
  record,
  rootFolder,
  type Manifest,
  type ManifestFile,
  type ManifestUser,
  type Synced,
} from './sync'

const TRUSTED_KEY = 'trustedServers'
const RECORDS_KEY = 'bundles'
const CODE_RECORDS_KEY = 'codeItems'
const ACCOUNTS_KEY = 'accounts'

const sessions = new Map<string, HistorySession>()
const codeSessions = new Map<string, CodeSession>()

let agent: AgentController | null = null

let presentation: PresentationSession | null = null

const recordsOf = (context: vscode.ExtensionContext) => context.globalState.get<Record<string, Synced>>(RECORDS_KEY, {})

const codeRecordsOf = (context: vscode.ExtensionContext) => context.globalState.get<Record<string, CodeRecord>>(CODE_RECORDS_KEY, {})

const openFolders = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath)

/** 開いているフォルダーのうち、コードのアイテムとして用意したフォルダーで、STEP Learn とのやりとりを始める */
async function startCodeSessions(context: vscode.ExtensionContext) {
  for (const session of codeSessions.values()) session.dispose()
  codeSessions.clear()
  const open = openFolders()
  for (const [key, record] of Object.entries(codeRecordsOf(context))) {
    if (!open.some((folder) => path.relative(folder, record.folder) === '')) continue
    const server = parseServer(key.split(' ')[0])
    const token = await context.secrets.get(codeTokenKey(key))
    if (!server || !token) continue
    const session = new CodeSession(context, key, record, server, token)
    codeSessions.set(key, session)
    session.start()
  }
  await vscode.commands.executeCommand('setContext', 'stepLearn.codeOpen', codeSessions.size > 0)
}

/** 提出するアイテム。key がなければ、開いているエディターのファイルのアイテムか、1 つしかなければそれ */
async function sessionToSubmit(key?: string) {
  if (key) return codeSessions.get(key)
  const all = [...codeSessions.values()]
  const active = vscode.window.activeTextEditor?.document.uri
  const found = active && all.find((s) => s.contains(active))
  if (found || all.length <= 1) return found ?? all[0]
  const picked = await vscode.window.showQuickPick(
    all.map((s) => ({ label: s.title, session: s })),
    { placeHolder: '提出するアイテムを選んでください' },
  )
  return picked?.session
}

/** 開いているフォルダーのうち、前に用意したフォルダーで変更履歴の同期を始める。鍵が新しくなっているかもしれないので、動いているものも始め直す */
async function startSessions(context: vscode.ExtensionContext) {
  for (const session of sessions.values()) session.dispose()
  sessions.clear()
  const open = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath)
  for (const [key, record] of Object.entries(recordsOf(context))) {
    if (!open.some((folder) => path.relative(folder, record.folder) === '')) continue
    const server = parseServer(key.split(' ')[0])
    const token = await context.secrets.get(tokenKey(key))
    // 鍵がないのは、同期に対応する前の拡張機能で用意したフォルダー。STEP Learn の画面から開き直すと鍵を受け取る
    if (!server || !token || sessions.has(key)) continue
    const session = new HistorySession(context, key, record.folder, server, token, () => recordsOf(context)[key]?.files ?? {})
    sessions.set(key, session)
    session.start()
  }
}

const configuredRoot = () => rootFolder(vscode.workspace.getConfiguration('stepLearn').get<string>('folder') ?? '')

async function trust(context: vscode.ExtensionContext, server: URL) {
  const trusted = context.globalState.get<string[]>(TRUSTED_KEY, [])
  if (trusted.includes(server.origin)) return true
  const accept = '受け取る'
  const answer = await vscode.window.showWarningMessage(
    `${server.host} でのSTEP Learn からファイルを受け取りますか？`,
    { modal: true, detail: '初回時のみのチェックになります。次回からは聞きません。' },
    accept,
  )
  if (answer !== accept) return false
  await context.globalState.update(TRUSTED_KEY, [...trusted, server.origin])
  return true
}

/** 前に開いたときと違うアカウントのリンクなら、開いてよいかを確かめる。開くときは、このサーバーのアカウントとして覚えておく */
async function confirmAccount(
  context: vscode.ExtensionContext,
  server: URL,
  title: string,
  user: ManifestUser,
  consequence = '保存した内容がその人の変更履歴として記録されることがあります',
) {
  const accounts = context.globalState.get<Record<string, ManifestUser>>(ACCOUNTS_KEY, {})
  // アイテムごとに覚えないのは、まだ開いていないアイテムのリンクでも、ほかの人のアカウントのフォルダーを黙って用意しないため
  const known = accounts[server.origin]
  // 覚えたアカウントがなくても前に開いたアイテムがあれば確かめるのは、アカウントを覚える前の拡張機能が受け取った鍵は、誰のものか分からないため
  const opened = Object.keys(recordsOf(context)).some((key) => key.startsWith(`${server.origin} `))
  if (known ? known.id !== user.id : opened) {
    const accept = '続ける'
    const answer = await vscode.window.showWarningMessage(
      known
        ? `「${title}」のリンクは、前回とは違うアカウント（${user.name} さん）のものです。`
        : `「${title}」を ${user.name} さんのアカウントで開きます。`,
      {
        modal: true,
        detail: [
          known && `前回は ${known.name} さんのアカウントで開いていました。`,
          `ほかの人から送られたリンクを開くと、${consequence}。自分で STEP Learn の画面から開いたときだけ「${accept}」を押してください。`,
          !known && '次からは、違うアカウントのリンクのときだけ確認します。',
        ]
          .filter(Boolean)
          .join(''),
      },
      accept,
    )
    if (answer !== accept) return false
  }
  await context.globalState.update(ACCOUNTS_KEY, { ...accounts, [server.origin]: user })
  return true
}

type Choice = { folder: string; files: ManifestFile[]; same: ManifestFile[] }

/** 用意するフォルダーと書き込むファイルを決める。taken はほかのアイテムに用意したフォルダー。やめるときは null */
async function choose(manifest: Manifest, previous: Synced | undefined, taken: ReadonlySet<string>): Promise<Choice | null> {
  const base = path.join(await configuredRoot(), folderName(manifest.course), folderName(manifest.title))
  // base をそのまま使わないのは、同じコースに同じ名前のアイテムがあると、ほかのアイテムのフォルダーを開いてファイルや変更履歴が混ざるため
  const folder = previous && (await exists(previous.folder)) ? previous.folder : taken.has(base) ? await freshFolder(base, taken) : base
  if (!(await exists(folder))) return { folder, files: manifest.files, same: [] }

  const { missing, updatable, same } = await plan(folder, manifest, previous?.folder === folder ? previous : undefined)
  if (!missing.length && !updatable.length) return { folder, files: [], same }

  const take = '取り込んで開く'
  const keep = 'そのまま開く'
  const fresh = '別のフォルダーに用意し直す'
  const counts = [missing.length && `新しいファイル ${missing.length} 個`, updatable.length && `更新されたファイル ${updatable.length} 個`]
    .filter(Boolean)
    .join('・')
  const answer = await vscode.window.showInformationMessage(
    `「${manifest.title}」には、まだ取り込んでいないファイルがあります（${counts}）。`,
    { modal: true, detail: '取り込んでも、自分で書き換えたファイルはそのまま残します。' },
    take,
    keep,
    fresh,
  )
  if (answer === take) return { folder, files: [...missing, ...updatable], same }
  if (answer === keep) return { folder, files: [], same: [] }
  if (answer === fresh) return { folder: await freshFolder(base, taken), files: manifest.files, same: [] }
  return null
}

async function openFolder(folder: string) {
  const uri = vscode.Uri.file(folder)
  const open = vscode.workspace.workspaceFolders ?? []
  if (open.some((f) => f.uri.fsPath === uri.fsPath)) {
    void vscode.window.showInformationMessage(`「${path.basename(folder)}」はこのウィンドウで開いています。`)
    return
  }
  // フォルダーを開いていないウィンドウなら、新しいウィンドウを増やさずにそのウィンドウで開く
  await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: open.length > 0 })
}

/** STEP Learn のコーディングエージェントのアイテムの「VS Code で使う」から開いたとき。トークンを受け取ってサイドバーを出す */
async function connectAgent(context: vscode.ExtensionContext, server: URL, token: string) {
  if (!(await trust(context, server))) return
  try {
    const grant = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'STEP Learn: コーディングエージェントを確認しています' },
      () => claimAgent(server, token),
    )
    if (!(await confirmAccount(context, server, grant.title, grant.user, 'その人の利用枠で AI を使うことになります'))) return
    await agent?.connect(server, grant)
  } catch (e) {
    const message =
      e instanceof SyncError
        ? e.message
        : `コーディングエージェントを用意できませんでした（${e instanceof Error ? e.message : String(e)}）。`
    void vscode.window.showErrorMessage(message)
  }
}

/** STEP Learn のコードのアイテムの「VS Code で開く」から開いたとき。今のコードをファイルにして、フォルダーを開く */
async function openCode(context: vscode.ExtensionContext, server: URL, token: string) {
  if (!(await trust(context, server))) return
  try {
    const manifest = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'STEP Learn: コードを確認しています' },
      () => claimCode(server, token),
    )
    const consequence = '保存したコードがその人の書きかけとして送られ、その人として提出できてしまいます'
    if (!(await confirmAccount(context, server, manifest.title, manifest.user, consequence))) return
    const key = `${server.origin} ${manifest.ref}`
    await context.secrets.store(codeTokenKey(key), manifest.token)

    const records = codeRecordsOf(context)
    const previous = records[key]
    const taken = new Set([
      ...Object.values(recordsOf(context)).map((r) => r.folder),
      ...Object.entries(records)
        .filter(([k]) => k !== key)
        .map(([, r]) => r.folder),
    ])
    const base = path.join(await configuredRoot(), folderName(manifest.course), folderName(manifest.title))
    // 前のフォルダーがなく、同じ名前のフォルダーがあるときに使わないのは、ほかのアイテムや自分で作ったフォルダーのファイルを書き換えないため
    const folder = previous && (await exists(previous.folder)) ? previous.folder : await freshFolder(base, taken)
    let synced = previous?.folder === folder ? context.globalState.get<CodeSynced>(codeSyncedKey(key), {}) : {}

    const plan = await planCode(folder, manifest.files, synced)
    const side = plan.conflicts.length ? await chooseSide(manifest.title, plan.conflicts) : null
    if (plan.conflicts.length && !side) return
    await writeLocal(folder, [...plan.write, ...(side === 'server' ? plan.conflicts : [])])
    const names = manifest.files.map((f) => f.path)
    const local = await readLocal(folder, names)
    // 開いたときに手元の分を送っておくのは、このあとブラウザエディターを開いても、VS Code と同じコードが入っているようにするため
    if (plan.ahead.length || side === 'local') await saveDraft(server, manifest.token, local)
    synced = markSynced({}, local)

    const record: CodeRecord = { folder, title: manifest.title, files: names, canSubmit: manifest.canSubmit, page: manifest.page }
    // 開く前に記録するのは、このウィンドウでフォルダーを開くと拡張機能が止まり、あとの処理が動かないため
    await context.globalState.update(codeSyncedKey(key), synced)
    await context.globalState.update(CODE_RECORDS_KEY, { ...codeRecordsOf(context), [key]: record })
    await openFolder(folder)
    await startCodeSessions(context)
  } catch (e) {
    const message = e instanceof SyncError ? e.message : `コードを用意できませんでした（${e instanceof Error ? e.message : String(e)}）。`
    void vscode.window.showErrorMessage(message)
  }
}

/** STEP Learn の発表ファイルのアイテムの「PowerPoint と同期」から開いたとき。PowerPoint のファイルを PDF にして上げ、映しているスライドを送り始める */
async function syncPresentation(context: vscode.ExtensionContext, server: URL, token: string) {
  // OS より先に確かめるのは、WSL や SSH につないだウィンドウでは拡張機能がつないだ先で動き、OS も PowerPoint もこの PC のものではないため
  if (vscode.env.remoteName) {
    void vscode.window.showWarningMessage(
      'PowerPoint との同期は、この PC のフォルダーを開いたウィンドウで使えます。WSL や SSH につないでいないウィンドウを前に出してから、STEP Learn の「PowerPoint と同期」をもう一度押してください。',
    )
    return
  }
  const powerPoint = powerPointFor(process.platform)
  if (!powerPoint) {
    void vscode.window.showInformationMessage('PowerPoint との同期は、Windows と Mac で使えます。')
    return
  }
  if (!(await trust(context, server))) return
  try {
    const grant = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'STEP Learn: 発表ファイルを確認しています' },
      () => claimPresentation(server, token),
    )
    const consequence = 'その人のアイテムの PDF と、学生に見せる範囲を変えることになります'
    if (!(await confirmAccount(context, server, grant.title, grant.user, consequence))) return
    presentation?.dispose()
    const session: PresentationSession = new PresentationSession(context, server, grant, powerPoint, () => {
      if (presentation !== session) return
      presentation = null
      void vscode.commands.executeCommand('setContext', 'stepLearn.presentationSyncing', false)
    })
    presentation = session
    await vscode.commands.executeCommand('setContext', 'stepLearn.presentationSyncing', true)
    if (!(await session.publish(true))) return session.dispose()
    session.start()
  } catch (e) {
    const message = e instanceof SyncError ? e.message : `同期を始められませんでした（${e instanceof Error ? e.message : String(e)}）。`
    void vscode.window.showErrorMessage(message)
  }
}

async function openFromLink(context: vscode.ExtensionContext, uri: vscode.Uri) {
  const query = new URLSearchParams(uri.query)
  const server = parseServer(query.get('server') ?? '')
  const token = query.get('token') ?? ''
  if (uri.path === '/agent' && server && token) return connectAgent(context, server, token)
  if (uri.path === '/code' && server && token) return openCode(context, server, token)
  if (uri.path === '/presentation' && server && token) return syncPresentation(context, server, token)
  if (uri.path !== '/open' || !server || !token) {
    void vscode.window.showErrorMessage('リンクが正しくありません。STEP Learn の画面からもう一度開いてください。')
    return
  }
  if (!(await trust(context, server))) return

  try {
    const manifest = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'STEP Learn: ファイルを確認しています' },
      () => claim(server, token),
    )
    const key = `${server.origin} ${manifest.ref}`
    if (manifest.user && !(await confirmAccount(context, server, manifest.title, manifest.user))) return
    if (manifest.sync) {
      if (manifest.sync.enabled && !(await confirmSync(context, key, manifest.title))) return
      await context.secrets.store(tokenKey(key), manifest.sync.token)
    }
    const records = recordsOf(context)
    const taken = new Set([
      ...Object.entries(records)
        .filter(([k]) => k !== key)
        .map(([, r]) => r.folder),
      ...Object.values(codeRecordsOf(context)).map((r) => r.folder),
    ])
    const choice = await choose(manifest, records[key], taken)
    if (!choice) return
    if (choice.files.length) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `STEP Learn: 「${manifest.title}」を用意しています` },
        (progress) =>
          download(server, manifest, choice.files, choice.folder, (done) =>
            progress.report({ message: `${done} / ${choice.files.length}`, increment: 100 / choice.files.length }),
          ),
      )
    }
    // 開く前に記録するのは、このウィンドウでフォルダーを開くと拡張機能が止まり、あとの処理が動かないため
    await context.globalState.update(RECORDS_KEY, { ...records, [key]: record(choice.folder, records[key], choice.files, choice.same) })
    await openFolder(choice.folder)
    await startSessions(context)
  } catch (e) {
    const message = e instanceof SyncError ? e.message : `ファイルを用意できませんでした（${e instanceof Error ? e.message : String(e)}）。`
    void vscode.window.showErrorMessage(message)
  }
}

export function activate(context: vscode.ExtensionContext) {
  void startSessions(context)
  void startCodeSessions(context)
  const controller = new AgentController(context)
  agent = controller
  controller.start()
  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri: (uri) => openFromLink(context, uri) }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void startSessions(context)
      void startCodeSessions(context)
    }),
    { dispose: () => sessions.forEach((session) => session.dispose()) },
    { dispose: () => codeSessions.forEach((session) => session.dispose()) },
    { dispose: () => presentation?.dispose() },
    vscode.commands.registerCommand(PRESENTATION_MENU_COMMAND, () => presentation?.menu()),
    vscode.commands.registerCommand('stepLearn.presentation.stop', () => presentation?.stop()),
    vscode.commands.registerCommand('stepLearn.code.submit', async (key?: unknown) => {
      const session = await sessionToSubmit(typeof key === 'string' ? key : undefined)
      if (!session) {
        void vscode.window.showInformationMessage(
          'STEP Learn のコードのアイテムを開いていません。STEP Learn の画面の「VS Code で開く」から始めてください。',
        )
        return
      }
      if (!session.record.canSubmit) {
        void vscode.window.showInformationMessage('提出できるのは、コースの学生だけです。')
        return
      }
      await session.submit()
    }),
    vscode.commands.registerCommand('stepLearn.openRootFolder', async () => {
      const root = await configuredRoot()
      if (!(await exists(root))) {
        void vscode.window.showInformationMessage(
          'まだファイルを用意していません。STEP Learn の画面の「VS Code で開く」から始めてください。',
        )
        return
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(root))
    }),
    vscode.commands.registerCommand('stepLearn.forgetServers', async () => {
      await context.globalState.update(TRUSTED_KEY, [])
      void vscode.window.showInformationMessage('ファイルを受け取ってよいサーバーの記録を消しました。次に開くときに、もう一度確認します。')
    }),
  )
  // ふだんは何も返さないのは、ほかの拡張機能からコーディングエージェントを操作できないようにするため。
  // テストとして起動したとき（--extensionTestsPath）だけ、本物の VS Code の中で動きを確かめられるように渡す
  return context.extensionMode === vscode.ExtensionMode.Test ? { agent: controller } : undefined
}

export async function deactivate() {
  await Promise.all([...sessions.values(), ...codeSessions.values()].map((session) => session.flushNow()))
}
