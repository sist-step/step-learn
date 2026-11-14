import fs from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'

/** 差分の左側（依頼の前の内容）を出すための URI のスキーム */
const SCHEME = 'step-learn-before'

/** 1 回の依頼で AI が書き換えたファイル（絶対パス）と、依頼の前の内容。前にはなかったファイルは null */
export type ChangeSet = Map<string, string | null>

/** いまの中身。エディターで開いていれば書きかけの内容、なければファイルから読む。ファイルがなければ null */
export async function currentText(file: string) {
  const opened = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file)
  if (opened) return opened.getText()
  return fs.readFile(file, 'utf8').catch(() => null)
}

// ファイルに直接書かないのは、エディターで開いているファイルを書き換えたときに、元に戻す（Ctrl + Z）で戻せるようにするため
export async function writeDocument(file: string, content: string) {
  const uri = vscode.Uri.file(file)
  const edit = new vscode.WorkspaceEdit()
  const opened = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file)
  const exists =
    opened ??
    (await vscode.workspace.fs.stat(uri).then(
      () => true,
      () => false,
    ))
  if (!exists) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)))
    edit.createFile(uri, { contents: new TextEncoder().encode(content) })
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('ファイルを作れませんでした')
    return
  }
  const doc = opened ?? (await vscode.workspace.openTextDocument(uri))
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), content)
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error('ファイルを書き換えられませんでした')
  await doc.save()
}

/** 依頼ごとの、AI が書き換える前の内容。差分を見せ、依頼の前に戻すのに使う。VS Code を閉じると消える */
export class ChangeHistory implements vscode.TextDocumentContentProvider {
  private sets = new Map<number, ChangeSet>()

  start(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, this))
  }

  provideTextDocumentContent(uri: vscode.Uri) {
    const params = new URLSearchParams(uri.query)
    return this.sets.get(Number(params.get('id')))?.get(params.get('file') ?? '') ?? ''
  }

  keep(id: number, set: ChangeSet) {
    this.sets.set(id, set)
  }

  has(id: number) {
    return this.sets.has(id)
  }

  forget(ids: number[]) {
    for (const id of ids) this.sets.delete(id)
  }

  /** 依頼の前の内容と、いまの内容を並べて見せる */
  async showDiff(id: number, file: string) {
    if (!this.sets.get(id)?.has(file)) return
    const name = path.basename(file)
    // パスにファイル名を入れるのは、左側にも拡張子に合った色分けが付くようにするため
    const before = vscode.Uri.from({ scheme: SCHEME, path: `/${name}`, query: new URLSearchParams({ id: String(id), file }).toString() })
    await vscode.commands.executeCommand('vscode.diff', before, vscode.Uri.file(file), `${name}（依頼の前 ↔ 今）`)
  }

  /** 書き換えたファイルを依頼の前の内容に戻す。依頼で作ったファイルは消す */
  async revert(id: number) {
    for (const [file, before] of this.sets.get(id) ?? []) {
      if (before !== null) {
        await writeDocument(file, before)
        continue
      }
      const edit = new vscode.WorkspaceEdit()
      edit.deleteFile(vscode.Uri.file(file), { ignoreIfNotExists: true })
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error('ファイルを消せませんでした')
    }
  }
}
