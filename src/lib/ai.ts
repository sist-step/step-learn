import { completeAnthropic, countFileTokens } from './ai-anthropic'
import {
  AI_MODEL_LABELS,
  AI_PROVIDERS,
  AiError,
  isAiModel,
  isAnthropicModel,
  isModelPaused,
  type AiFilePart,
  type AiModel,
  type AiProvider,
  type AiReply,
  type AiRequest,
} from './ai-models'
import { completeOpenRouter } from './ai-openrouter'
import { config } from './config'

export * from './ai-models'

export const isProviderEnabled = (provider: AiProvider) => (provider === 'anthropic' ? config.anthropic : config.openRouter) !== null

/** どれかの提供元の API キーが設定されている。モデルごとに使えるかは isProviderEnabled(aiProvider(model)) で確かめる */
export const aiEnabled = AI_PROVIDERS.some(isProviderEnabled)

export const hasAiEmail = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase() === config.aiEmailDomain

export async function complete(request: AiRequest): Promise<AiReply> {
  const { model } = request
  // 型だけに任せないのは、as でのキャストや設定・入力から来た文字列が、一覧にないモデルのまま提供元に届くのを防ぐため
  if (!isAiModel(model)) throw new AiError(`利用できないモデルです（${String(model)}）`)
  if (isModelPaused(model)) throw new AiError(`${AI_MODEL_LABELS[model]} は一時的に停止しています`)
  return isAnthropicModel(model) ? completeAnthropic({ ...request, model }) : completeOpenRouter({ ...request, model })
}

export async function generateText(request: Omit<AiRequest, 'tools' | 'onText'>): Promise<string> {
  const { text, stop } = await complete(request)
  if (stop === 'refusal') throw new AiError('AI がこの依頼には応答できませんでした')
  if (!text) throw new AiError('AI の応答が空でした')
  return text
}

/** file を model に見せたときの入力のトークン数。readsFiles のモデルだけで呼ぶ。読めないファイルなら 'unreadable' */
export async function countFileInput(model: AiModel, file: AiFilePart) {
  if (!isAnthropicModel(model)) throw new AiError(`${AI_MODEL_LABELS[model]} はファイルを読めません`)
  return countFileTokens(model, file)
}
