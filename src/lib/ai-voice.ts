import { AiError, type AiUsage, type TranscriptionModel } from './ai-models'
import { config } from './config'

export const VOICE_MODEL: TranscriptionModel = 'openai/whisper-large-v3-turbo'

/** 1 回の音声入力で録れる長さ（秒）。client.ts はこの長さで録音を止めて送る */
export const MAX_VOICE_SECONDS = 60

/** 1 回の音声入力で文字にできる長さ。client.ts は途中の文字起こしがこの長さに届いたら録音を止めて送る */
export const MAX_VOICE_CHARS = 500

// 少し超えるのを許すのは、client.ts が録音を止めてから最後の断片が届くまでに、数百ミリ秒ずれるため
const VOICE_SECONDS_MARGIN = 3

/** 文字起こしの提供元が数えた長さ（秒）が、1 回の上限を超えているか。usage.seconds がなければ超えていないとみなす */
export const isVoiceTooLong = (seconds: number | null) => seconds !== null && seconds > MAX_VOICE_SECONDS + VOICE_SECONDS_MARGIN

// 録った長さから決めないのは、送られてくるのは圧縮した音声で、長さを確かめるには中身を読む必要があるため。
// iOS の AAC（128 kbps 前後）で MAX_VOICE_SECONDS を録っても収まる大きさにしている
export const MAX_VOICE_BYTES = 4 * 1024 * 1024

// 拡張子ではなく MIME で決めるのは、client.ts が MediaRecorder の Blob をそのまま送り、ファイル名に意味がないため
const VOICE_FORMATS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
}

/** 受け取れる音声なら OpenRouter に渡す形式の名前。codecs などの付いた MIME（audio/webm;codecs=opus）も受け付ける */
export const voiceFormat = (type: string) => VOICE_FORMATS[type.split(';')[0].trim().toLowerCase()] ?? null

// 料金表の高いほうの提供元の額で見積もるのは、usage.cost がない応答を少なく数えて、月の上限を超えないようにするため
const FALLBACK_PRICE_PER_SECOND = 0.000011

type WireTranscription = {
  text?: string
  usage?: { seconds?: number; cost?: number }
  error?: { code?: number | string; message?: string }
}

/** 音声を文字にする。language は ISO-639-1（自動で判定させると、短い発話を別の言語として起こすことがあるため） */
export async function transcribe(
  audio: Blob,
  format: string,
  signal?: AbortSignal,
): Promise<{ text: string; seconds: number | null; usage: AiUsage }> {
  if (!config.openRouter) throw new AiError('OPENROUTER_API_KEY が設定されていないため、音声入力を利用できません')
  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openRouter.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VOICE_MODEL,
        input_audio: { data: Buffer.from(await audio.arrayBuffer()).toString('base64'), format },
        language: 'ja',
        temperature: 0,
        // 学習に使わない提供元に限るのは、教師の声と話した内容を外部に残さないため
        provider: { data_collection: 'deny' },
      }),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    })
  } catch (e) {
    if (signal?.aborted) throw new AiError('音声入力を取り消しました')
    console.error('[ai] voice', e)
    throw new AiError('音声を文字にできませんでした')
  }
  const data = (await res.json().catch(() => null)) as WireTranscription | null
  if (!res.ok || !data || data.error || typeof data.text !== 'string') {
    console.error('[ai] voice', res.status, data?.error)
    if (res.status === 401 || res.status === 403) throw new AiError('AI の API キーが使えません')
    if (res.status === 402) throw new AiError('OpenRouter のクレジットが足りません')
    if (res.status === 429) throw new AiError('音声入力が混み合っています。しばらくしてからお試しください')
    throw new AiError('音声を文字にできませんでした')
  }
  const seconds = typeof data.usage?.seconds === 'number' ? data.usage.seconds : null
  return {
    text: data.text.trim(),
    seconds,
    usage: { promptTokens: 0, completionTokens: 0, cost: data.usage?.cost ?? (seconds ?? 0) * FALLBACK_PRICE_PER_SECOND },
  }
}
