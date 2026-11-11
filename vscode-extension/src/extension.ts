import path from 'node:path'
import * as vscode from 'vscode'
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

/** 用意するフォルダーと書き込むファイルを決める。やめるときは null */
async function choose(manifest: Manifest, previous: Synced | undefined): Promise<Choice | null> {
  const base = path.join(await configuredRoot(), folderName(manifest.course), folderName(manifest.title))
  const folder = previous && (await exists(previous.folder)) ? previous.folder : base
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
  if (answer === fresh) return { folder: await freshFolder(base), files: manifest.files, same: [] }
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
    const records = context.globalState.get<Record<string, Synced>>(RECORDS_KEY, {})
    const choice = await choose(manifest, records[key])
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
  } catch (e) {
    const message = e instanceof SyncError ? e.message : `ファイルを用意できませんでした（${e instanceof Error ? e.message : String(e)}）。`
    void vscode.window.showErrorMessage(message)
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri: (uri) => openFromLink(context, uri) }),
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
