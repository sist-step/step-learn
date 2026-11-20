import fs from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { AI_TIMEOUT, AiError, OPENROUTER_EMBEDDING_MODELS, isProviderEnabled, type AiUsage, type EmbeddingModel } from './ai'
import type { AiLedger } from './ai-ledger'
import { defineTool, describedString, failure, success, type AiAgentTool } from './ai-tool-kit'
import { config } from '../../lib/config'

/** STEP Docs の 1 ページ。content は MDX の記法と画像を落とした本文 */
export type DocsDocument = { id: string; title: string; description: string; url: string; content: string; redacted: boolean }

/** 見出しで分けた本文の断片。vector は正規化した Float32 の base64、hash は埋め込んだ文章のハッシュ */
export type DocsChunk = { doc: string; heading: string | null; text: string; hash: string; vector: string }

/** scripts/docs-index.ts が作る索引 */
export type DocsIndex = {
  version: 1
  model: string
  dimensions: number
  queryInstruction: string
  documents: DocsDocument[]
  chunks: DocsChunk[]
}

// 本番では step-docs のワークフローが書いたサーバーのディレクトリを、compose.yaml でここに読み取り専用でマウントする
const INDEX_PATH = path.resolve('ai-docs/step-docs.json')

const MASK = '[非公開: 元のドキュメントを参照]'

// usage.cost だけに頼らないのは、cost のない応答を 0 として数えると、上限の計算から漏れるため。料金表（100 万トークンで 0.01 ドル）より高めに見積もる
const FALLBACK_INPUT_PRICE = 0.02e-6

const MAX_QUERY_LENGTH = 500
const MATCHED_CHUNKS = 6
const MAX_DOCS = 3

type LoadedIndex = {
  model: EmbeddingModel
  dimensions: number
  queryInstruction: string
  documents: Map<string, DocsDocument>
  chunks: (DocsChunk & { values: Float32Array })[]
}

const isEmbeddingModel = (model: string): model is EmbeddingModel => (OPENROUTER_EMBEDDING_MODELS as readonly string[]).includes(model)

function decodeVector(encoded: string) {
  const bytes = Buffer.from(encoded, 'base64')
  // Buffer のまま読まないのは、バイトの位置が 4 の倍数とは限らず、Float32Array で読めないことがあるため
  return new Float32Array(new Uint8Array(bytes).buffer)
}

function parseIndex(raw: string): LoadedIndex {
  const index = JSON.parse(raw) as DocsIndex
  if (index.version !== 1 || !isEmbeddingModel(index.model)) throw new Error(`形式かモデル（${index.model}）に対応していません`)
  return {
    model: index.model,
    dimensions: index.dimensions,
    queryInstruction: index.queryInstruction,
    documents: new Map(index.documents.map((d) => [d.id, d])),
    chunks: index.chunks.map((c) => ({ ...c, values: decodeVector(c.vector) })),
  }
}

let loaded: { mtimeMs: number; index: LoadedIndex } | null = null

// 起動時に一度だけ読まないのは、step-docs のワークフローがマウントしたファイルを書き換えたら、再起動せずに新しい内容で答えるため
/** 今の索引。ファイルが変わっていれば読み直す。索引がなければ null */
function currentIndex(): LoadedIndex | null {
  let mtimeMs: number
  try {
    mtimeMs = fs.statSync(INDEX_PATH).mtimeMs
  } catch {
    loaded = null
    return null
  }
  if (loaded?.mtimeMs === mtimeMs) return loaded.index
  try {
    loaded = { mtimeMs, index: parseIndex(fs.readFileSync(INDEX_PATH, 'utf8')) }
    return loaded.index
  } catch (e) {
    // 前の索引を使い続けるのは、壊れたファイルを読んだだけで、検索できていたものまでできなくしないため
    console.error('[ai]', INDEX_PATH, e)
    return loaded?.index ?? null
  }
}

/** システムプロンプトの「できること」に足す行 */
export const DOCS_ABILITIES: readonly string[] = [
  'STEP の活動のマニュアル（STEP Docs）を search_docs で検索し、read_doc で読めます。STEP Learn の使い方や STEP の活動について聞かれたら、推測で答えずに、まず search_docs で調べてから答えてください。答えの最後に「実際のドキュメント」という見出しを付け、答えに使ったページのタイトルを、結果の url へのリンク（[タイトル](url)）で載せてください。url は書き換えずにそのまま使ってください。見つからなかったときは、ドキュメントに書かれていないことを伝えてください。',
]

type WireEmbedding = { data?: { embedding?: number[] }[]; usage?: { prompt_tokens?: number; cost?: number }; error?: unknown }

/** 索引と同じ作り方（先頭の次元だけを取って正規化）で、検索語をベクトルにする */
async function embedQuery(index: LoadedIndex, query: string): Promise<{ vector: Float32Array; usage: AiUsage }> {
  if (!config.openRouter) throw new AiError('OPENROUTER_API_KEY が設定されていないため、ドキュメントを検索できません')
  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openRouter.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: index.model,
        input: [`Instruct: ${index.queryInstruction}\nQuery:${query}`],
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT),
    })
  } catch (e) {
    console.error('[ai]', e)
    throw new AiError('AI に接続できません')
  }
  const data = (await res.json().catch(() => null)) as WireEmbedding | null
  const values = data?.data?.[0]?.embedding
  if (!res.ok || !values || values.length < index.dimensions) {
    console.error('[ai]', index.model, res.status, data?.error)
    throw new AiError('ドキュメントを検索できませんでした')
  }
  const head = values.slice(0, index.dimensions)
  const norm = Math.hypot(...head) || 1
  const promptTokens = data.usage?.prompt_tokens ?? 0
  return {
    vector: Float32Array.from(head, (v) => v / norm),
    usage: { promptTokens, completionTokens: 0, cost: data.usage?.cost ?? promptTokens * FALLBACK_INPUT_PRICE },
  }
}

function dot(a: Float32Array, b: Float32Array) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

const summaryOf = (doc: DocsDocument) => ({ doc_id: doc.id, title: doc.title, description: doc.description || undefined })

const redactionNotice = (doc: DocsDocument) =>
  doc.redacted
    ? 'パスワードなどの非公開情報を伏せています。その部分は推測せず、url の実際のドキュメントで確かめるよう案内してください。'
    : undefined

async function search(index: LoadedIndex, query: string, ledger: Pick<AiLedger, 'recordUsage'>) {
  const { vector, usage } = await embedQuery(index, query)
  // 利用者に数えないのは、Claude で話している人まで OpenRouter の利用者に数え、週の枠を割る人数が増えるため
  ledger.recordUsage(null, index.model, usage)
  const hits = index.chunks
    .map((chunk) => ({ chunk, score: dot(vector, chunk.values) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MATCHED_CHUNKS)
  const byDoc = new Map<string, { doc: DocsDocument; score: number; sections: { heading: string | null; text: string }[] }>()
  for (const { chunk, score } of hits) {
    const doc = index.documents.get(chunk.doc)
    if (!doc) continue
    const entry = byDoc.get(doc.id) ?? { doc, score, sections: [] }
    entry.sections.push({ heading: chunk.heading, text: chunk.text })
    byDoc.set(doc.id, entry)
  }
  return [...byDoc.values()].slice(0, MAX_DOCS).map(({ doc, score, sections }) => ({
    ...summaryOf(doc),
    url: doc.url,
    score: Number(score.toFixed(3)),
    notice: sections.some((s) => s.text.includes(MASK)) ? redactionNotice(doc) : undefined,
    sections,
  }))
}

const NOT_IMPORTED = 'STEP Docs はまだ取り込まれていないため、検索できません。利用者にはドキュメントを見られないことを伝えてください。'

// 索引がないときもツールを渡すのは、あとからマウントしたファイルが書かれても、再起動せずに使えるようにするため
/** STEP Docs を検索して読むツール。ledger は検索語の埋め込みの使用量を記録する先 */
export function docsTools(ledger: Pick<AiLedger, 'recordUsage' | 'withinMonthlyLimit'>): AiAgentTool[] {
  const searchDocs = defineTool(
    'search_docs',
    'STEP の活動のマニュアル（STEP Docs。STEP Learn の使い方、かけでじ、ドキュメントの書き方・Git・GitHub など）を意味で検索し、関係の深いページと、その中で当てはまった部分を返す。ページ全体は read_doc で読む。',
    z.object({ query: describedString('調べたいこと。利用者の質問を、そのまま自然な文で書く', MAX_QUERY_LENGTH, 1) }),
    async (_c, { query }) => {
      const label = `ドキュメントを検索しました（${query}）`
      const index = currentIndex()
      if (!index) return failure(NOT_IMPORTED, 'ドキュメントを検索できません')
      // 検索できないときにページの一覧を返すのは、AI がタイトルから選んで read_doc で読めば、答えられることが多いため
      if (!isProviderEnabled('openrouter') || !ledger.withinMonthlyLimit('openrouter')) {
        return success(
          { note: '今は検索できないため、ページの一覧を返します。', documents: [...index.documents.values()].map(summaryOf) },
          label,
        )
      }
      try {
        return success({ results: await search(index, query, ledger) }, label)
      } catch (e) {
        if (!(e instanceof AiError)) throw e
        return success(
          { note: '今は検索できないため、ページの一覧を返します。', documents: [...index.documents.values()].map(summaryOf) },
          label,
        )
      }
    },
  )

  const readDoc = defineTool(
    'read_doc',
    'STEP Docs のページ全体を返す。doc_id は search_docs の結果のもの。',
    z.object({ doc_id: describedString('ページの doc_id', 200, 1) }),
    (_c, { doc_id }) => {
      const index = currentIndex()
      if (!index) return failure(NOT_IMPORTED, 'ドキュメントを読めません')
      const doc = index.documents.get(doc_id)
      if (!doc) return failure('その doc_id のページはありません。search_docs で探し直してください。', 'ドキュメントが見つかりません')
      return success(
        { ...summaryOf(doc), url: doc.url, notice: redactionNotice(doc), content: doc.content },
        `ドキュメント「${doc.title}」を読みました`,
      )
    },
  )

  return [searchDocs, readDoc]
}
