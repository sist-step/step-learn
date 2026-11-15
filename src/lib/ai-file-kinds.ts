// DB やストレージを読み込まないのは、AI のパネル（components/ai-panel.tsx）も、受け取れる種類の名前と accept を作るのに使うため

/** AI が request_file で受け取れるファイルの種類。any はすべて（実行ファイルはどの種類でも受け取らない） */
export const AI_FILE_KINDS = ['pdf', 'image', 'video', 'audio', 'word', 'excel', 'powerpoint', 'text', 'code', 'zip', 'any'] as const

export type AiFileKind = (typeof AI_FILE_KINDS)[number]

export const AI_FILE_KIND_LABELS: Record<AiFileKind, string> = {
  pdf: 'PDF',
  image: '画像',
  video: '動画',
  audio: '音声',
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  text: 'テキスト',
  code: 'ソースコード',
  zip: 'ZIP',
  any: 'すべての種類',
}

// MIME タイプで見分けないのは、ブラウザが送る種類は OS の設定で空や別物になり（.ts が video/mp2t など）、拡張子のほうが利用者の見ている名前と一致するため
const EXTENSIONS: Record<Exclude<AiFileKind, 'any'>, readonly string[]> = {
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac'],
  word: ['doc', 'docx'],
  excel: ['xls', 'xlsx', 'csv'],
  powerpoint: ['ppt', 'pptx'],
  text: ['txt', 'md', 'csv', 'tsv', 'json'],
  code: ['py', 'js', 'mjs', 'ts', 'html', 'htm', 'css', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'go', 'rs', 'php', 'sql', 'ipynb'],
  zip: ['zip'],
}

/** AI_FILE_KINDS の説明。AI に渡すツールの説明に使う */
export const AI_FILE_KIND_HINTS = AI_FILE_KINDS.map((k) =>
  k === 'any' ? 'any: 種類を問わない' : `${k}: ${AI_FILE_KIND_LABELS[k]}（${EXTENSIONS[k].join(' / ')}）`,
).join('、')

const restricts = (kinds: readonly AiFileKind[]) => !kinds.includes('any')

/** ファイルの選択に渡す accept。種類を問わないなら undefined */
export const fileKindsAccept = (kinds: readonly AiFileKind[]) =>
  restricts(kinds) ? [...new Set(kinds.flatMap((k) => (k === 'any' ? [] : EXTENSIONS[k])))].map((ext) => `.${ext}`).join(',') : undefined

/** 受け取れる種類の名前（例: 「PDF・画像」） */
export const fileKindsLabel = (kinds: readonly AiFileKind[]) =>
  restricts(kinds) ? kinds.map((k) => AI_FILE_KIND_LABELS[k]).join('・') : AI_FILE_KIND_LABELS.any

const extensionOf = (name: string) => name.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase() ?? ''

export const matchesFileKinds = (name: string, kinds: readonly AiFileKind[]) =>
  !restricts(kinds) || kinds.some((k) => k !== 'any' && EXTENSIONS[k].includes(extensionOf(name)))
