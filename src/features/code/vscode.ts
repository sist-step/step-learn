import { isCodeLanguage } from './code'

/**
 * ブラウザエディターの画面に埋め込む iframe（CodeVscodeFrame）で、VS Code を動かす。
 * 中身は親の画面（src/features/code/editor.ts）から受け取り、書き換えたら親に送る
 */
export async function mountVscode(root: HTMLElement) {
  const language = root.dataset.codeVscode
  if (!isCodeLanguage(language) || root.hasAttribute('data-code-ready')) return
  root.setAttribute('data-code-ready', '')
  // 日本語の文言を先に読み込むのは、VS Code の部品が読み込まれた時点の文言で固まり、あとから読み込んでも英語のまま残るため
  await import('@codingame/monaco-vscode-language-pack-ja')
  const { startWorkbench } = await import('./vscode-workbench')
  await startWorkbench(root, language)
}
