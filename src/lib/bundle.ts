// サーバーと client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

/** ファイル自動配布のアイテムの種類の名前。通常モードの items.type と、Moodle モードの extra_items.type に使う */
export const BUNDLE_KIND = 'bundle'

/** Moodle モードで、ファイル自動配布のアイテムの位置に置く Moodle の活動（moodle/mod_stepbundle）の名前 */
export const BUNDLE_MODULE = 'stepbundle'

/** VS Code の拡張機能（vscode-extension/）の ID。publisher を変えたら vscode-extension/package.json と合わせる */
export const VSCODE_EXTENSION_ID = 'mint1535.step-learn-for-vscode'

export const VSCODE_EXTENSION_NAME = 'STEP Learn for VSCode'

export const VSCODE_MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${VSCODE_EXTENSION_ID}`

/** アイテム 1 つに置けるファイルの数と合計の大きさ */
export const MAX_BUNDLE_FILES = 500
export const MAX_BUNDLE_SIZE = 50 * 1024 * 1024

const MAX_DEPTH = 32
const MAX_PATH_LENGTH = 400
const MAX_SEGMENT_LENGTH = 255

/** アップロードのときに外すフォルダーとファイル。環境ごとに作り直すものと、OS が勝手に作るもの */
const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
])

// Windows で作れない名前を受け付けないのは、学生の PC に展開できず、そのファイルだけ配られなくなるため
const INVALID_CHARS = /[\p{Cc}<>:"|?*\\]/u
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/** 配布するファイルの、アイテムの中での場所（/ 区切りの相対パス）。使えない場所なら null */
export function bundlePath(raw: string): string | null {
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.')
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null
  const valid = parts.every(
    (p) => p !== '..' && p.length <= MAX_SEGMENT_LENGTH && !INVALID_CHARS.test(p) && !/[. ]$/.test(p) && !RESERVED_NAMES.test(p),
  )
  const path = parts.join('/')
  return valid && path.length <= MAX_PATH_LENGTH ? path : null
}

/** アップロードしても配らない場所か（.git や node_modules の中など） */
export const isExcludedPath = (path: string) => path.split('/').some((p) => EXCLUDED_SEGMENTS.has(p))

// 大文字と小文字をそろえて比べるのは、Windows と macOS では大文字と小文字だけが違う名前を同じファイルとして扱うため
const foldCase = (path: string) => path.toLowerCase()

/** 同じ名前のファイルとフォルダーがぶつかっている場所。なければ null */
export function conflictingPath(paths: string[]) {
  const files = new Set(paths.map(foldCase))
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      if (files.has(foldCase(folder))) return folder
    }
  }
  return null
}

export const samePath = (a: string, b: string) => foldCase(a) === foldCase(b)

export const isInFolder = (path: string, folder: string) => foldCase(path).startsWith(`${foldCase(folder)}/`)

/** 配布するファイル 1 つ。fileKey はストレージのキー */
export type BundleFile = { path: string; fileKey: string; size: number; sha256: string }

/** モードごとの、アイテム 1 つの配布するファイルの置き場所 */
export type BundleStore = {
  list: () => BundleFile[]
  /** 同じ場所のファイルは置き換える。置き換えて要らなくなったストレージのキーを返す */
  put: (files: BundleFile[]) => string[]
  /** 消したファイルのストレージのキーを返す */
  remove: (match: (path: string) => boolean) => string[]
}

export type BundleTreeNode = { name: string; path: string; file?: Pick<BundleFile, 'size'>; children: BundleTreeNode[] }

/** パスの一覧をフォルダーの木にする。フォルダーを先に、名前の順に並べる */
export function bundleTree(files: Pick<BundleFile, 'path' | 'size'>[]): BundleTreeNode[] {
  const root: BundleTreeNode = { name: '', path: '', children: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    parts.forEach((name, i) => {
      const isFile = i === parts.length - 1
      let child = node.children.find((n) => n.name === name && !!n.file === isFile)
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join('/'), ...(isFile && { file: { size: f.size } }), children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  const sort = (nodes: BundleTreeNode[]): BundleTreeNode[] =>
    nodes
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name, 'ja'))
      .map((n) => ({ ...n, children: sort(n.children) }))
  return sort(root.children)
}

/** zip の中のフォルダー名にするアイテムのタイトル。Windows で作れない文字は _ に置き換える */
export function folderNameOf(title: string) {
  const name = title
    .replace(/[\p{Cc}<>:"|?*\\/]/gu, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return !name || RESERVED_NAMES.test(name) ? `_${name}` : name
}

export const bundleSize = (files: Pick<BundleFile, 'size'>[]) => files.reduce((sum, f) => sum + f.size, 0)
