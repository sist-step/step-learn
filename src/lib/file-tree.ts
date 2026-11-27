// サーバーと client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

const MAX_DEPTH = 32
const MAX_PATH_LENGTH = 400
const MAX_SEGMENT_LENGTH = 255

/** アップロードのときに外すフォルダーとファイル。環境ごとに作り直すものと、OS が勝手に作るもの */
export const EXCLUDED_NAMES = [
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
]
const EXCLUDED_SEGMENTS = new Set(EXCLUDED_NAMES)

// Windows で作れない名前を受け付けないのは、学生の PC に展開できず、そのファイルだけ配られなくなるため
const INVALID_CHARS = /[\p{Cc}<>:"|?*\\]/u
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

const segmentsOf = (raw: string) =>
  raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.')

/** ファイルの、フォルダーの中での場所（/ 区切りの相対パス）。使えない場所なら null */
export function treePath(raw: string): string | null {
  const parts = segmentsOf(raw)
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null
  const valid = parts.every(
    (p) => p !== '..' && p.length <= MAX_SEGMENT_LENGTH && !INVALID_CHARS.test(p) && !/[. ]$/.test(p) && !RESERVED_NAMES.test(p),
  )
  const path = parts.join('/')
  return valid && path.length <= MAX_PATH_LENGTH ? path : null
}

/** 名前を、Windows でも作れる名前に直す。使えない文字は _ に置き換える */
export function safeSegment(name: string, maxLength = MAX_SEGMENT_LENGTH) {
  const safe = name
    .replace(/[\p{Cc}<>:"|?*\\/]/gu, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, maxLength)
  return !safe || safe === '..' || RESERVED_NAMES.test(safe) ? `_${safe}` : safe
}

/** ほかのシステムから受け取った場所を、使える場所に直す。直しても使えなければ null */
export const toTreePath = (raw: string) =>
  treePath(
    segmentsOf(raw)
      .map((p) => safeSegment(p))
      .join('/'),
  )

/** アップロードしても置かない場所か（.git や node_modules の中など） */
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

export type TreeFile = { path: string; size: number }

/** 木の中のファイルを開くリンク。download なら、ブラウザで開かずに保存させる */
export type TreeLink = { href: string; download: boolean }

export type FileTreeNode = { name: string; path: string; file?: TreeFile; children: FileTreeNode[] }

/** パスの一覧をフォルダーの木にする。フォルダーを先に、名前の順に並べる */
export function fileTree(files: TreeFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', children: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    parts.forEach((name, i) => {
      const isFile = i === parts.length - 1
      let child = node.children.find((n) => n.name === name && !!n.file === isFile)
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join('/'), ...(isFile && { file: f }), children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  const sort = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name, 'ja'))
      .map((n) => ({ ...n, children: sort(n.children) }))
  return sort(root.children)
}

export const treeSize = (files: Pick<TreeFile, 'size'>[]) => files.reduce((sum, f) => sum + f.size, 0)
