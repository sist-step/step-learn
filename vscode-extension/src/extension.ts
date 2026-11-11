import path from 'node:path'
import * as vscode from 'vscode'
import { HistorySession, confirmSync, tokenKey } from './history-session'
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
  type Synced,
} from './sync'

const TRUSTED_KEY = 'trustedServers'
const RECORDS_KEY = 'bundles'

const sessions = new Map<string, HistorySession>()

const recordsOf = (context: vscode.ExtensionContext) => context.globalState.get<Record<string, Synced>>(RECORDS_KEY, {})

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
    `${server.host} の STEP Learn からファイルを受け取りますか？`,
    { modal: true, detail: '学校の STEP Learn の画面から開いたときだけ「受け取る」を押してください。次からは確認しません。' },
    accept,
  )
  if (answer !== accept) return false
  await context.globalState.update(TRUSTED_KEY, [...trusted, server.origin])
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

async function openFromLink(context: vscode.ExtensionContext, uri: vscode.Uri) {
  const query = new URLSearchParams(uri.query)
  const server = parseServer(query.get('server') ?? '')
  const token = query.get('token') ?? ''
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
    if (manifest.sync) {
      if (manifest.sync.enabled && !(await confirmSync(context, key, manifest.title))) return
      await context.secrets.store(tokenKey(key), manifest.sync.token)
    }
    const records = recordsOf(context)
    const taken = new Set(
      Object.entries(records)
        .filter(([k]) => k !== key)
        .map(([, r]) => r.folder),
    )
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
  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri: (uri) => openFromLink(context, uri) }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void startSessions(context)),
    { dispose: () => sessions.forEach((session) => session.dispose()) },
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
}

export async function deactivate() {
  await Promise.all([...sessions.values()].map((session) => session.flushNow()))
}
