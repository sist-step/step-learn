import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { DocsChunk, DocsDocument, DocsIndex } from '../src/lib/ai-docs'

// npm の依存を使わないのは、step-docs のワークフローが step-learn の依存を入れずに、このファイルだけを node で動かすため
const USAGE = `使い方: node scripts/docs-index.ts --docs <step-docs の src/content/docs> --out <索引を置くディレクトリ> [--dry-run]

STEP Docs の Markdown を読み、パスワードなどを伏せて見出しごとに分け、AI エージェントが検索する索引 <out>/step-docs.json を作り直します。
ふだんは step-docs のリポジトリのワークフローが self-hosted ランナーで実行し、STEP Learn のコンテナはそのディレクトリをマウントして読みます。
中身が変わっていない部分は前の索引のベクトルを使い回すので、埋め込みの API を呼ぶのは変わった部分だけです。

  --dry-run   取り込むページと伏せた箇所を表示して、何も書き込まずに終了する

環境変数の OPENROUTER_API_KEY が必要です（.env があれば読みます）。`

const INDEX_FILE = 'step-docs.json'
const SITE_URL = 'https://step-docs.siststep.workers.dev'

// src/lib/ai-docs.ts に置かないのは、モデル・次元・指示文を索引に書いて渡すので、サーバーと値をそろえ忘れる余地がないため
const MODEL = 'qwen/qwen3-embedding-8b'
// 4096 次元のまま持たないのは、検索のたびに全断片と比べるので、索引の大きさと計算を抑えたいため。Qwen3-Embedding は先頭の次元だけで使えるように学習されている
const DIMENSIONS = 1024
// ドキュメント側に付けないのは、Qwen3-Embedding が指示文を検索語の側だけに付ける前提で学習されているため
const QUERY_INSTRUCTION = 'Given a question, retrieve relevant passages from internal documentation that answer the question'
const BATCH_SIZE = 32
const MAX_CHUNK_CHARS = 1200
const OVERLAP_CHARS = 150

const MASK = '[非公開: 元のドキュメントを参照]'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// ---------------------------------------------------------------- 秘密情報を伏せる

// ASCII のキーワードは mapping の pin や Android の id のように単語の一部にも現れるので、前後が英字でないものだけを拾う。
// ID まで伏せるのは、パスワードを伏せても、ID が分かれば残りを推測するだけでログインを試せるため
const SECRET_LABEL = String.raw`(?:(?<![A-Za-z])(?:password|passwd|passcode|pass|pwd|pw|pin|secret|token|api[_ -]?key|id|user ?name)(?![A-Za-z])|パスワード|パスコード|暗証番号|シークレット|トークン|ユーザー名)`

// 値に日本語を含めないのは「PW: 508も利用可能らしい?」のように値の直後へ説明文が続く書き方があるため
const LABELED_SECRET = new RegExp(
  String.raw`((?:^|[\s,、])[^\s:：=,、]{0,20}?${SECRET_LABEL}[^\n:：=,、]{0,20}?[ \t　]*[:：=][ \t　]*)([^\s,、。\\぀-ヿ一-鿿]+)`,
  'gim',
)

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
]

const URL_CREDENTIAL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi

// 伏せるのは、Google のフォームやドライブはリンクを知っていれば開けることが多く、Discord はサーバーとチャンネルの ID が分かるため
const SHARED_LINK_PATTERNS = [
  /https?:\/\/(?:docs|drive|forms)\.google\.com\/[^\s)>\]]+/g,
  /https?:\/\/forms\.gle\/[^\s)>\]]+/g,
  /https?:\/\/(?:(?:www|ptb|canary)\.)?discord(?:app)?\.com\/(?:channels|invite)\/[^\s)>\]]+/g,
  /https?:\/\/discord\.gg\/[^\s)>\]]+/g,
]

// 3 文字以下まで伏せないのは「PW: 508」の 508 が「508 教室」のような普通の語にもなるため
const MIN_PROPAGATE_LENGTH = 4

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function redactSecrets(text: string) {
  const values: string[] = []
  let out = text.replace(LABELED_SECRET, (_, label: string, value: string) => {
    values.push(value)
    return `${label}${MASK}`
  })
  const words = new Set(values.flatMap((v) => v.split(/[～〜~]/)).filter((w) => w.length >= MIN_PROPAGATE_LENGTH))
  for (const word of words) out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(word)}(?![A-Za-z0-9])`, 'g'), MASK)
  out = out.replace(URL_CREDENTIAL, (_, head: string, __: string, at: string) => `${head}${MASK}${at}`)
  for (const pattern of [...TOKEN_PATTERNS, ...SHARED_LINK_PATTERNS]) out = out.replace(pattern, MASK)
  return out
}

// ---------------------------------------------------------------- 読み込み

function listMarkdown(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listMarkdown(full)
      return /\.mdx?$/.test(entry.name) ? [full] : []
    })
    .sort()
}

// YAML のライブラリを入れないのは、使うのが title と description の 1 行の値だけのため
function parseFrontmatter(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {} as Record<string, string>, body: raw }
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    const value = kv?.[2].trim().replace(/^["'](.*)["']$/, '$1')
    if (kv && value) data[kv[1]] = value
  }
  return { data, body: raw.slice(match[0].length) }
}

// 画像を残さないのは、docs サイトがログイン必須で、AI の回答に載せても表示できる URL がないため
function toPlainText(body: string) {
  return body
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? `（画像: ${alt}）` : '（画像）'))
    .replace(/<\/?[A-Z][\w.]*[^>]*>/g, '')
    .replace(/\\$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Starlight のページの URL（例: kakedeji/Junior/first → <サイト>/kakedeji/junior/first/） */
function pageUrl(id: string) {
  const slug = id
    .replace(/(^|\/)index$/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
  return `${SITE_URL}/${slug ? `${slug}/` : ''}`
}

function loadDocuments(dir: string): DocsDocument[] {
  return listMarkdown(dir).map((full) => {
    const original = fs.readFileSync(full, 'utf8')
    const raw = redactSecrets(original)
    const { data, body } = parseFrontmatter(raw)
    const id = path
      .relative(dir, full)
      .split(path.sep)
      .join('/')
      .replace(/\.mdx?$/, '')
    return {
      id,
      title: data.title || path.basename(id),
      description: data.description ?? '',
      url: pageUrl(id),
      content: toPlainText(body),
      redacted: raw !== original,
    }
  })
}

// ---------------------------------------------------------------- 分割

function splitByHeading(text: string) {
  const sections: { heading: string | null; lines: string[] }[] = []
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] }
  let inCodeFence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inCodeFence = !inCodeFence
    const heading = inCodeFence ? null : /^(#{2,4})\s+(.*)$/.exec(line)
    if (heading) {
      if (current.lines.join('\n').trim()) sections.push(current)
      current = { heading: heading[2].trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (current.lines.join('\n').trim()) sections.push(current)
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() }))
}

/** 長すぎるセクションを段落ごとに分ける（1 段落で超えるときは行ごと）。前の断片の末尾を少し重ねる */
function splitLongText(text: string) {
  if (text.length <= MAX_CHUNK_CHARS) return [text]
  const pieces: string[] = []
  let buffer = ''
  let carried = 0
  const flush = () => {
    const trimmed = buffer.trim()
    if (trimmed && buffer.length > carried) pieces.push(trimmed)
    buffer = buffer.slice(-OVERLAP_CHARS)
    carried = buffer.length
  }
  for (const paragraph of text.split(/\n{2,}/)) {
    let block = paragraph
    while (block.length > MAX_CHUNK_CHARS) {
      const newline = block.lastIndexOf('\n', MAX_CHUNK_CHARS)
      const cut = newline > 0 ? newline : MAX_CHUNK_CHARS
      if (buffer) flush()
      buffer += block.slice(0, cut)
      flush()
      block = block.slice(cut)
    }
    if (buffer && buffer.length + block.length > MAX_CHUNK_CHARS) flush()
    buffer += (buffer ? '\n\n' : '') + block
  }
  flush()
  return pieces
}

type Piece = Omit<DocsChunk, 'vector'> & { embeddingText: string }

function buildChunks(doc: DocsDocument): Piece[] {
  const sections = splitByHeading(doc.content)
  const parts = sections.length > 0 ? sections : [{ heading: null, text: doc.content }]
  return parts.flatMap((section) =>
    splitLongText(section.text)
      .filter((text) => text.trim())
      .map((text) => {
        // 見出しを前に付けるのは、本文だけで埋め込むより、見出しの言葉で聞かれたときに見つかりやすいため
        const embeddingText = `${[doc.title, section.heading].filter(Boolean).join(' > ')}\n\n${text}`
        return { doc: doc.id, heading: section.heading, text, hash: sha(embeddingText), embeddingText }
      }),
  )
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

// ---------------------------------------------------------------- 埋め込み

// src/lib/ai-docs.ts の関数を使わないのは、拡張子なしの import を node がそのままでは解決できないため。ベクトルの作り方はそちらに合わせる
function toVector(values: number[]) {
  const head = values.slice(0, DIMENSIONS)
  const norm = Math.hypot(...head) || 1
  return Buffer.from(Float32Array.from(head, (v) => v / norm).buffer).toString('base64')
}

type EmbeddingResponse = { data?: { index?: number; embedding?: number[] }[]; usage?: { prompt_tokens?: number; cost?: number } }

async function embed(apiKey: string, texts: string[]) {
  const vectors: string[] = []
  let tokens = 0
  let cost = 0
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: batch, encoding_format: 'float' }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) fail(`\n埋め込みの API がエラーを返しました（${res.status}）: ${(await res.text()).slice(0, 500)}`)
    const json = (await res.json()) as EmbeddingResponse
    const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (data.length !== batch.length || data.some((d) => !d.embedding || d.embedding.length < DIMENSIONS)) {
      fail('\n埋め込みの API の応答が正しくありません。')
    }
    vectors.push(...data.map((d) => toVector(d.embedding!)))
    tokens += json.usage?.prompt_tokens ?? 0
    cost += json.usage?.cost ?? 0
    process.stdout.write(`\rベクトル化: ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`)
  }
  process.stdout.write('\n')
  return { vectors, tokens, cost }
}

// ---------------------------------------------------------------- 書き出し

/** 前の索引の断片。モデルが変わって使い回せなければ空 */
function readPrevious(file: string): DocsChunk[] {
  try {
    const index = JSON.parse(fs.readFileSync(file, 'utf8')) as DocsIndex
    return index.version === 1 && index.model === MODEL && index.dimensions === DIMENSIONS ? index.chunks : []
  } catch {
    return []
  }
}

// 1 行にまとめないのは、索引を見比べるときに、変わったドキュメントと断片の行だけを差分で出せるようにするため
function serialize(index: DocsIndex) {
  const { documents, chunks, ...head } = index
  const lines = (rows: unknown[]) => rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')
  const fields = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return `{\n${fields.join(',\n')},\n  "documents": [\n${lines(documents)}\n  ],\n  "chunks": [\n${lines(chunks)}\n  ]\n}\n`
}

// 直接書き込まないのは、動いている STEP Learn が書きかけのファイルを読まないようにするため
function writeAtomically(file: string, text: string) {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, text, { mode: 0o644 })
  fs.renameSync(temp, file)
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      docs: { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(USAGE)
    return
  }
  if (!values.docs || (!values.out && !values['dry-run'])) fail(USAGE)
  const docsDir = path.resolve(values.docs)
  if (!fs.existsSync(docsDir)) fail(`${docsDir} がありません。`)

  const documents = loadDocuments(docsDir)
  if (documents.length === 0) fail(`${docsDir} に Markdown が見つかりません。`)
  const pieces = documents.flatMap(buildChunks)
  console.log(`ドキュメント: ${documents.length} 件、断片: ${pieces.length} 件`)
  for (const doc of documents.filter((d) => d.redacted)) console.log(`伏せた箇所があります: ${doc.id}`)

  if (values['dry-run'] || !values.out) {
    for (const doc of documents) console.log(`- ${doc.id}「${doc.title}」`)
    for (const line of documents.flatMap((d) => d.content.split('\n').filter((l) => l.includes(MASK)))) console.log(`  ${line.trim()}`)
    return
  }

  try {
    process.loadEnvFile()
  } catch {
    // .env がないときに止めないのは、ワークフローでは環境変数でキーを渡すため
  }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) fail('OPENROUTER_API_KEY を環境変数か .env に設定してください。')

  const outDir = path.resolve(values.out)
  const output = path.join(outDir, INDEX_FILE)
  fs.mkdirSync(outDir, { recursive: true })
  const reusable = new Map(readPrevious(output).map((c) => [c.hash, c.vector] as const))
  const missing = pieces.filter((p) => !reusable.has(p.hash))
  console.log(`前の索引から使い回す断片: ${pieces.length - missing.length} 件、新しくベクトル化する断片: ${missing.length} 件`)
  if (missing.length > 0) {
    const { vectors, tokens, cost } = await embed(
      apiKey,
      missing.map((p) => p.embeddingText),
    )
    missing.forEach((p, i) => reusable.set(p.hash, vectors[i]))
    console.log(`埋め込み: ${tokens} トークン、$${cost.toFixed(6)}`)
  }

  const index: DocsIndex = {
    version: 1,
    model: MODEL,
    dimensions: DIMENSIONS,
    queryInstruction: QUERY_INSTRUCTION,
    documents,
    chunks: pieces.map(({ embeddingText: _, ...p }) => ({ ...p, vector: reusable.get(p.hash)! })),
  }
  const text = serialize(index)
  const unchanged = fs.existsSync(output) && fs.readFileSync(output, 'utf8') === text
  if (unchanged) {
    console.log(`変更はありません: ${output}`)
    return
  }
  writeAtomically(output, text)
  console.log(`保存しました: ${output}（${(Buffer.byteLength(text) / 1024).toFixed(0)}KB）`)
}

await main()
