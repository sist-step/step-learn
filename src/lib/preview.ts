export type PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'text'

// 種類が空や別物（.ts が video/mp2t など）で届くことがあるので、テキストは拡張子でも判定する
const TEXT_FILE_NAME =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|log|ya?ml|toml|ini|xml|html?|css|scss|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|sql|r)$/i

export function previewKind(type: string, name: string): PreviewKind | null {
  if (type === 'application/pdf') return 'pdf'
  if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) return 'image'
  if (/^video\/(mp4|webm|ogg)$/.test(type)) return 'video'
  if (/^audio\/(mpeg|mp4|x-m4a|aac|wav|x-wav|wave|ogg|webm|flac)$/.test(type)) return 'audio'
  if (type.startsWith('text/') || /^application\/(json|xml)$/.test(type) || TEXT_FILE_NAME.test(name)) return 'text'
  return null
}

export const isMediaFile = (file: { type: string; name: string }) => {
  const kind = previewKind(file.type, file.name)
  return kind === 'video' || kind === 'audio'
}
