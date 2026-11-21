import { IWorkbenchLayoutService, getService, initialize } from '@codingame/monaco-vscode-api'
import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override/common'
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override'
import getEmmetServiceOverride from '@codingame/monaco-vscode-emmet-service-override'
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override'
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import {
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
  type IFileWriteOptions,
} from '@codingame/monaco-vscode-files-service-override'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override'
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override'
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getNotificationServiceOverride from '@codingame/monaco-vscode-notifications-service-override'
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override'
import getSnippetServiceOverride from '@codingame/monaco-vscode-snippets-service-override'
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getWorkbenchServiceOverride, {
  Parts,
  ViewContainerLocation,
  registerCustomView,
  setPartVisibility,
  viewContainerRegistry,
} from '@codingame/monaco-vscode-workbench-service-override'
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override'
import * as vscode from 'vscode'
import 'vscode/localExtensionHost'
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-theme-seti-default-extension'
import '@codingame/monaco-vscode-html-default-extension'
import '@codingame/monaco-vscode-html-language-features-default-extension'
import '@codingame/monaco-vscode-css-default-extension'
import '@codingame/monaco-vscode-css-language-features-default-extension'
import '@codingame/monaco-vscode-javascript-default-extension'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import '@codingame/monaco-vscode-typescript-language-features-default-extension'
import '@codingame/monaco-vscode-emmet-default-extension'
import '@codingame/monaco-vscode-python-default-extension'
import { diffLines } from '../../lib/diff'
import {
  CODE_FILES,
  onCodeMessage,
  sendCodeMessage,
  type CodeFiles,
  type CodeLanguage,
  type CodeViewPane,
  type VscodeMessage,
  type WorkspaceMessage,
} from './code'

// 本物の Worker を作らずに URL と設定だけを持つのは、VS Code が必要になったときに自分で Worker を作るため。
// クラスの名前を Worker にしているのは、Vite が new Worker(new URL(...)) の形を見つけたときだけ、Worker のファイルを別にビルドするため
class Worker {
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {}
}

const WORKERS: Partial<Record<string, Worker>> = {
  editorWorkerService: new Worker(new URL('@codingame/monaco-vscode-api/workers/editor.worker', import.meta.url), { type: 'module' }),
  extensionHostWorkerMain: new Worker(new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url), {
    type: 'module',
  }),
  TextMateWorker: new Worker(new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url), { type: 'module' }),
  LocalFileSearchWorker: new Worker(new URL('@codingame/monaco-vscode-search-service-override/worker', import.meta.url), {
    type: 'module',
  }),
}

const FIXED_FILES = 'このアイテムでは、ファイルを足したり、消したり、名前を変えたりできません。'

// 止めるのは、サーバーが受け取るのは決まったファイルだけで、足したファイルは保存も提出もされず、読み込み直すと消えるため。
// NoPermissions で断らないのは、VS Code がその下の保存先（メモリ）に書き込み直し、足せたように見えてしまうため
class FixedFileSystemProvider extends RegisteredFileSystemProvider {
  override async writeFile(resource: vscode.Uri, content: Uint8Array, opts: IFileWriteOptions) {
    try {
      await super.writeFile(resource, content, opts)
    } catch (e) {
      if (e instanceof FileSystemProviderError && e.code === FileSystemProviderErrorCode.FileNotFound) throw fixedFilesError()
      throw e
    }
  }
  override async rename() {
    await Promise.reject(fixedFilesError())
  }
  override async mkdir() {
    await Promise.reject(fixedFilesError())
  }
  override async delete() {
    await Promise.reject(fixedFilesError())
  }
}

const fixedFilesError = () => FileSystemProviderError.create(FIXED_FILES, FileSystemProviderErrorCode.Unknown)

const THEMES = { light: 'Default Light Modern', dark: 'Default Dark Modern' } as const

const themeOf = (doc: Document) => (doc.documentElement.dataset.theme === 'dark' ? THEMES.dark : THEMES.light)

/** 学生が開いたときの VS Code の設定。設定の画面で変えた値は、その画面を開いている間だけ効く */
const userSettings = (theme: string) => ({
  'workbench.colorTheme': theme,
  'workbench.iconTheme': 'vs-seti',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'workbench.layoutControl.enabled': false,
  'window.commandCenter': false,
  'window.menuBarVisibility': 'compact',
  // VS Code に聞かせないのは、⌘R で読み込み直すたびに、サーバーに保存してあっても離れるかを聞くため（聞くかどうかは editor.ts が保存の状況で決める）
  'window.confirmBeforeClose': 'never',
  // 書き換えてから少し待って保存するのは、保存のたびに書きかけのコードをサーバーへ送るため（Ctrl + S でもすぐに送る）
  'files.autoSave': 'afterDelay',
  'files.autoSaveDelay': 1000,
  'editor.fontSize': 14,
  'editor.tabSize': 2,
  'editor.minimap.enabled': false,
  'editor.wordWrap': 'on',
  'editor.stickyScroll.enabled': false,
  'security.workspace.trust.enabled': false,
  'extensions.ignoreRecommendations': true,
  'telemetry.telemetryLevel': 'off',
  'chat.disableAIFeatures': true,
})

/** 親の画面（CodePage）。この画面だけを開いたときは自分 */
const page = () => window.frameElement?.ownerDocument ?? document

/** コードを扱う画面（src/features/code/editor.ts）から、最初の中身（open）を受け取るまで待つ */
function waitForFiles(host: HTMLElement, workspace: HTMLElement) {
  return new Promise<CodeFiles>((resolve) => {
    const stop = onCodeMessage<VscodeMessage>(host, (message) => {
      if (message.type !== 'open') return
      stop()
      resolve(message.files)
    })
    sendCodeMessage<WorkspaceMessage>(workspace, { type: 'ready' })
  })
}

const FLASH_MS = 3200
const NARROW_WIDTH = 600
const AUX_RATIO = 0.36

const VIEW_IDS: Record<CodeViewPane, string> = {
  problem: 'stepLearn.problem',
  output: 'stepLearn.output',
  submissions: 'stepLearn.submissions',
}

/**
 * VS Code の外で描いた中身（data-code-view-pane。VS Code の Shadow DOM の外の子）を、slot で VS Code のビューに差し込む。
 * 問題はエクスプローラーの上、プレビューか実行結果と提出は右のサイドバー。
 * 中身を VS Code の中で描き直さないのは、問題文・判定・提出のフォームが STEP Learn の部品で、STEP Learn の CSS と client.ts の処理もそのまま使うため
 */
function registerViews(workspace: HTMLElement, language: CodeLanguage) {
  const paneOf = (view: CodeViewPane) => workspace.querySelector<HTMLElement>(`[data-code-view-pane="${view}"]`)
  const send = (message: WorkspaceMessage) => sendCodeMessage(workspace, message)
  const register = (view: CodeViewPane, location: ViewContainerLocation, options: Partial<Parameters<typeof registerCustomView>[0]>) => {
    const pane = paneOf(view)
    if (!pane) return
    registerCustomView({
      id: VIEW_IDS[view],
      name: pane.dataset.codeViewName ?? view,
      location,
      renderBody: (container) => {
        const slot = document.createElement('slot')
        slot.name = view
        container.style.height = '100%'
        container.append(slot)
        pane.hidden = false
        return { dispose: () => slot.remove() }
      },
      ...options,
    })
  }
  register('problem', ViewContainerLocation.Sidebar, { order: 0, viewContainer: viewContainerRegistry.get('workbench.view.explorer') })
  register('output', ViewContainerLocation.AuxiliaryBar, {
    order: 0,
    default: true,
    actions: [
      language === 'web'
        ? { id: 'stepLearn.refresh', title: 'プレビューを読み込み直す', icon: 'refresh', run: async () => send({ type: 'refresh' }) }
        : { id: 'stepLearn.runView', title: '実行（⌘Enter / Ctrl+Enter）', icon: 'play', run: async () => send({ type: 'run' }) },
    ],
  })
  register('submissions', ViewContainerLocation.AuxiliaryBar, { order: 1 })
}

export async function startWorkbench(host: HTMLElement, language: CodeLanguage) {
  const workspace = host.closest<HTMLElement>('[data-code-workspace]')
  if (!workspace) return
  const send = (message: WorkspaceMessage) => sendCodeMessage(workspace, message)
  const files = await waitForFiles(host, workspace)
  // アイテムごとにフォルダーを分けるのは、開いていたタブや画面の配置を VS Code がフォルダーごとに覚えていて、別のアイテムを開いたときに持ち越さないため
  const folder = vscode.Uri.file(`/items/${host.dataset.codeVscodeItem}/${host.dataset.codeVscodeFolder || 'code'}`)
  const uriOf = (name: string) => vscode.Uri.joinPath(folder, name)
  const specs = CODE_FILES[language]
  const provider = new FixedFileSystemProvider(false)
  for (const f of specs) provider.registerFile(new RegisteredMemoryFile(uriOf(f.name), files[f.key] ?? ''))
  registerFileSystemOverlay(1, provider)

  window.MonacoEnvironment = {
    getWorkerUrl: (_, label) => WORKERS[label]?.url.toString(),
    getWorkerOptions: (_, label) => WORKERS[label]?.options,
  }
  await initUserConfiguration(JSON.stringify(userSettings(themeOf(page()))))

  // Shadow DOM に置くのは、STEP Learn の CSS（.tabs などのクラス）が VS Code の部品に効いて崩れ、VS Code の CSS も STEP Learn の部品に効くため
  const container = document.createElement('div')
  container.style.height = '100%'
  host.attachShadow({ mode: 'open' }).append(container)
  await initialize(
    {
      ...getLogServiceOverride(),
      ...getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
      ...getModelServiceOverride(),
      ...getNotificationServiceOverride(),
      ...getDialogsServiceOverride(),
      ...getConfigurationServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getThemeServiceOverride(),
      ...getLanguagesServiceOverride(),
      // アカウントとキーボードの配列の表示を消すのは、ここではどちらも使わず、押しても何もできないため
      ...getStorageServiceOverride({
        fallbackOverride: {
          'workbench.activity.showAccounts': false,
          'workbench.statusbar.hidden': JSON.stringify(['status.workbench.keyboardLayout']),
        },
      }),
      ...getLifecycleServiceOverride(),
      ...getWorkingCopyServiceOverride(),
      ...getExplorerServiceOverride(),
      ...getSearchServiceOverride(),
      ...getMarkersServiceOverride(),
      ...getOutlineServiceOverride(),
      ...getSnippetServiceOverride(),
      ...getEmmetServiceOverride(),
      ...getWorkbenchServiceOverride(),
      ...getQuickAccessServiceOverride({ isKeybindingConfigurationVisible: () => false, shouldUseGlobalPicker: () => true }),
    },
    container,
    {
      workspaceProvider: { trusted: true, workspace: { folderUri: folder }, open: async () => false },
      defaultLayout: { editors: [{ uri: uriOf(specs[0].name) }] },
      productConfiguration: { nameShort: 'VS Code', nameLong: 'VS Code' },
    },
  )
  registerViews(workspace, language)

  const extension = registerExtension(
    {
      name: 'step-learn',
      publisher: 'sist-step',
      version: '1.0.0',
      engines: { vscode: '*' },
      contributes: {
        commands: [{ command: 'stepLearn.run', title: '実行する', category: 'STEP Learn' }],
        keybindings: [{ command: 'stepLearn.run', key: 'ctrl+enter', mac: 'cmd+enter', when: 'editorLangId == python' }],
      },
    },
    ExtensionHostKind.LocalProcess,
  )
  const api = await extension.getApi()
  const keyOf = (uri: vscode.Uri) => specs.find((f) => uri.toString() === uriOf(f.name).toString())?.key
  const showView = (view: CodeViewPane) => void api.commands.executeCommand(`${VIEW_IDS[view]}.focus`)

  api.commands.registerCommand('stepLearn.run', () => send({ type: 'run' }))
  // 配置の既定（defaultLayout）だけに任せないのは、覚えていた配置を戻すときは使われず、提出などで画面を読み込み直したときに、タブが 1 つもない状態で開くことがあるため
  if (api.window.tabGroups.all.every((group) => group.tabs.length === 0))
    void api.window.showTextDocument(uriOf(specs[0].name), { preview: false })
  // 狭い画面で左右のサイドバーを開いたままにしないのは、エディターが数文字の幅しか残らないため（右はステータスバーの auxToggle で開く）
  if (innerWidth < NARROW_WIDTH) {
    void api.commands.executeCommand('workbench.action.closeSidebar')
    void api.commands.executeCommand('workbench.action.closeAuxiliaryBar')
  } else {
    // 右のサイドバーを開いておくのは、プレビューと提出が、閉じたままだと見つけにくいため。
    // 既定の幅のままにしないのは、プレビューが 300px ほどしかなく、作っているページの見た目がわからないため（広げた幅は狭めない）
    setPartVisibility(Parts.AUXILIARYBAR_PART, true)
    const layout = await getService(IWorkbenchLayoutService)
    const { width, height } = layout.getSize(Parts.AUXILIARYBAR_PART)
    const wide = Math.round(innerWidth * AUX_RATIO)
    if (width < wide) layout.setSize(Parts.AUXILIARYBAR_PART, { width: wide, height })
  }
  if (workspace.dataset.codeStartView === 'submissions') showView('submissions')
  api.workspace.onDidChangeTextDocument((e) => {
    const key = keyOf(e.document.uri)
    if (key) send({ type: 'change', key, content: e.document.getText() })
  })
  api.workspace.onDidSaveTextDocument((doc) => keyOf(doc.uri) && send({ type: 'save' }))

  const saveStatus = api.window.createStatusBarItem(api.StatusBarAlignment.Left)
  // ステータスバーにも置くのは、狭い画面では右のサイドバーを閉じて始めるうえ、開くボタン（レイアウトの操作）を出していないため
  const auxToggle = api.window.createStatusBarItem(api.StatusBarAlignment.Left)
  const auxNames = [...workspace.querySelectorAll<HTMLElement>('[data-code-view-pane="output"], [data-code-view-pane="submissions"]')]
  auxToggle.text = `$(layout-sidebar-right) ${auxNames.map((pane) => pane.dataset.codeViewName).join('・')}`
  auxToggle.tooltip = '右のサイドバーを開く・閉じる'
  auxToggle.command = 'workbench.action.toggleAuxiliaryBar'
  auxToggle.show()
  const flash = api.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new api.ThemeColor('diffEditor.insertedLineBackground'),
  })

  async function replace(next: CodeFiles, show: boolean) {
    const changed: { doc: vscode.TextDocument; before: string }[] = []
    for (const f of specs) {
      const content = next[f.key]
      if (typeof content !== 'string') continue
      const doc = await api.workspace.openTextDocument(uriOf(f.name))
      const before = doc.getText()
      if (before === content) continue
      const edit = new api.WorkspaceEdit()
      edit.replace(doc.uri, new api.Range(doc.positionAt(0), doc.positionAt(before.length)), content)
      await api.workspace.applyEdit(edit)
      await doc.save()
      changed.push({ doc, before })
    }
    if (!show || changed.length === 0) return
    for (const { doc, before } of changed) {
      const editor = await api.window.showTextDocument(doc, { preview: false })
      const ranges = diffLines(before, doc.getText()).flatMap((l) =>
        l.kind === 'add' && l.after ? [new api.Range(l.after - 1, 0, l.after - 1, 0)] : [],
      )
      editor.setDecorations(flash, ranges)
      if (ranges[0]) editor.revealRange(ranges[0], api.TextEditorRevealType.InCenter)
      window.setTimeout(() => editor.setDecorations(flash, []), FLASH_MS)
    }
  }

  onCodeMessage<VscodeMessage>(host, (message) => {
    switch (message.type) {
      case 'open':
        return void replace(message.files, false)
      case 'update':
        return void replace(message.files, true)
      case 'status':
        saveStatus.text = message.text
        if (message.text) saveStatus.show()
        else saveStatus.hide()
        return
      case 'show':
        return showView(message.view)
    }
  })

  // ビューに移した STEP Learn の部品の色はこの画面の data-theme で決まるので、上のページではなく VS Code のテーマに合わせる（VS Code の中でテーマを変えたときに、暗い背景に暗い文字になるのを避けるため）
  const followColorTheme = (kind: vscode.ColorThemeKind) => {
    const theme = kind === api.ColorThemeKind.Dark || kind === api.ColorThemeKind.HighContrast ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    document.querySelector<HTMLMetaElement>('meta[name=color-scheme]')?.setAttribute('content', theme)
  }
  followColorTheme(api.window.activeColorTheme.kind)
  api.window.onDidChangeActiveColorTheme((theme) => followColorTheme(theme.kind))

  new MutationObserver(() => {
    void api.workspace.getConfiguration('workbench').update('colorTheme', themeOf(page()), api.ConfigurationTarget.Global)
  }).observe(page().documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}
