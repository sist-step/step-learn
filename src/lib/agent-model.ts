import { isAgentClaudeModel, isAgentOpenRouterModel, type AgentModel } from './agent'
import type { OpenRouterModelInfo } from './ai-models'
import { cachedOpenRouterModels, listOpenRouterModels } from './ai-openrouter'

/** 編集画面で選べる OpenRouter のモデル（名前の順）。一覧を取れなければ null */
export async function agentOpenRouterModels(): Promise<OpenRouterModelInfo[] | null> {
  const list = await listOpenRouterModels()
  return list && list.filter(isAgentOpenRouterModel)
}

/** agentOpenRouterModels で取ってある一覧。同期で描く Moodle モードの入力欄に使う。まだ取っていなければ null */
export const cachedAgentOpenRouterModels = () => cachedOpenRouterModels()?.filter(isAgentOpenRouterModel) ?? null

/** 編集画面で選んだモデル（agent_model の値）。current は保存してあるモデル */
export async function resolveAgentModel(value: string, current: AgentModel | null): Promise<{ model: AgentModel } | { error: string }> {
  if (isAgentClaudeModel(value)) return { model: { provider: 'anthropic', id: value } }
  // 一覧を引く前に返すのは、OpenRouter に届かないときも、期間など別の欄を直すだけの保存を止めないため
  if (current?.provider === 'openrouter' && current.id === value) {
    const latest = (await listOpenRouterModels().catch(() => null))?.find((m) => m.id === value)
    return { model: latest && isAgentOpenRouterModel(latest) ? { provider: 'openrouter', ...latest } : current }
  }
  const list = await listOpenRouterModels()
  if (!list) return { error: 'OpenRouter のモデル一覧を読み込めませんでした。しばらくしてからお試しください。' }
  const info = list.find((m) => m.id === value)
  if (!info) return { error: '選んだモデルは OpenRouter にありません。一覧から選び直してください。' }
  if (!isAgentOpenRouterModel(info)) return { error: `「${info.name}」はツールを使えないか、扱える会話が短いため、使えません。` }
  return { model: { provider: 'openrouter', ...info } }
}
