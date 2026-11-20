/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { AiAgentEvent, AiUsageMeter } from './ai-agent'
import { AI_BUDDY_LABELS, AI_BUDDY_LOOKS, type AiBuddyState } from './ai-buddy'
import type { AiTouched } from './ai-tool-kit'
import { formatClock } from '../../lib/clock'
import { renderMarkdown } from '../../lib/markdown'
import { AI_PANEL_DOCKED, setSetting } from '../../lib/settings'
import { carriesFiles, confirmNear, dropZoneOf, toast } from '../../client/core'
import { initMascots } from '../../client/mascot'
import { $$, fetchJson, reducedMotion } from '../../client/dom'

// --- AI アシスタントのパネル（features/ai/components/ai-panel.tsx）

// client.ts を import しないのは、循環すると読み込みの順番が変わり、AI の submit を画面遷移より先に受ける登録の順番が崩れるため
/** client.ts が起動時に差し込む、画面の描き直しに関わる処理 */
export const aiHooks = {
  /** AI のツールが変えた内容を、開いている画面に反映する */
  showChange: (() => {}) as (touched: AiTouched) => void,
  /** 画面を開いてから、書き換えて保存していない入力がある */
  isUnsaved: (() => false) as (form: HTMLFormElement) => boolean,
}
// 送信を再読み込みなしの遷移に任せないのは、応答を言い終えるまで待たずに、届いた分から画面に出すため
const aiPanel = () => document.getElementById('ai-panel')
const aiInput = () => aiPanel()?.querySelector<HTMLTextAreaElement>('.ai-textarea') ?? null
let aiSending = false
let aiComposing = false
let aiStopping = false
let aiSync: Promise<void> | null = null
let aiSyncTimer = 0
const AI_SYNC_INTERVAL = 10_000
const AI_BUSY_SYNC_INTERVAL = 3000
const AI_THINKING_AFTER_TEXT = 1500
// サーバーへの問い合わせだけで済ませないのは、同じブラウザのほかのタブで言い終えた応答を、次の問い合わせまで待たずに出すため
const aiChannel = new BroadcastChannel('ai-panel')

function aiTemplate(
  kind:
    | 'user'
    | 'assistant'
    | 'tool'
    | 'replies'
    | 'reply'
    | 'suggestion'
    | 'suggestion-loading'
    | 'pending'
    | 'stopped'
    | 'compacted'
    | 'error',
  text?: string,
) {
  const template = aiPanel()?.querySelector<HTMLTemplateElement>(`template[data-ai-template="${kind}"]`)
  const el = template?.content.firstElementChild?.cloneNode(true)
  if (!(el instanceof HTMLElement)) throw new Error(`template ${kind} がありません`)
  if (text !== undefined) el.querySelector('[data-ai-text]')!.textContent = text
  return el
}

function aiToolLine(label: string, touched?: AiTouched) {
  const line = aiTemplate('tool', label)
  const link = line.querySelector<HTMLAnchorElement>('.ai-spot-link')
  if (link && touched) {
    link.href = touched.href
    link.dataset.aiSpot = JSON.stringify(touched)
    link.hidden = false
  }
  return line
}

function aiReplies(replies: string[]) {
  const group = aiTemplate('replies')
  for (const text of replies) {
    const button = aiTemplate('reply', text)
    button.dataset.aiSuggest = text
    group.append(button)
  }
  return group
}

const aiLogAtBottom = (log: HTMLElement) => log.scrollHeight - log.scrollTop - log.clientHeight < 80

function scrollAiLog(force = false) {
  const log = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
  if (!log) return
  // 読み返しているときに最下部へ戻さないのは、応答が流れているあいだ、上の発言を読めなくなるため
  if (force || aiLogAtBottom(log)) log.scrollTop = log.scrollHeight
}

function fitAiInput(input: HTMLTextAreaElement) {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

export const aiDocked = () => matchMedia(AI_PANEL_DOCKED).matches

export function setAiOpen(open: boolean) {
  document.documentElement.toggleAttribute('data-ai-open', open)
  $$('.ai-panel-toggle').forEach((el) => el.setAttribute('aria-expanded', String(open)))
  setSetting('aiPanel', open)
  if (!open) {
    cancelAiVoice()
    return scheduleAiSync()
  }
  void fillAiSuggestions()
  void syncAiPanel()
  scrollAiLog(true)
  watchAiCards()
  // 狭い画面で入力欄にフォーカスしないのは、開いただけでキーボードが出て会話が隠れるため
  if (aiDocked()) aiInput()?.focus()
}

type AiModelLabels = Record<string, { label: string; hard: string | null; hardOff: string | null; images: boolean }>

const aiLabelsOf = (form: HTMLFormElement) => JSON.parse(form.dataset.aiLabels ?? '{}') as AiModelLabels

const chosenAiModel = (form: HTMLFormElement) =>
  (
    form.querySelector<HTMLInputElement>('input[name="model"]:checked') ??
    form.querySelector<HTMLInputElement>('input[type="hidden"][name="model"]')
  )?.value

/** 選んでいるモデルと「難しい依頼」に合わせて、ヘッダーのモデル名・送信する hard・入力欄の下の利用状況をそろえる */
function syncAiModel(form: HTMLFormElement) {
  const model = chosenAiModel(form)
  const entry = model ? aiLabelsOf(form)[model] : undefined
  $$<HTMLElement>('[data-ai-usage]', form).forEach((el) => (el.hidden = el.dataset.aiUsage !== model))
  const imageButton = form.querySelector<HTMLButtonElement>('button[data-ai-image]')
  if (imageButton) imageButton.hidden = !entry?.images
  // 選んだ画像を残したまま隠さないのは、読めないモデルに選び直したあと、見えない画像が発言と一緒に送られて断られるため
  if (!entry?.images && aiImage) setAiImage(null)
  const toggle = form.querySelector<HTMLButtonElement>('button[data-ai-hard]')
  const hardField = form.elements.namedItem('hard')
  if (!toggle || !(hardField instanceof HTMLInputElement)) return
  toggle.hidden = !entry?.hard
  toggle.disabled = !!entry?.hardOff
  toggle.setAttribute('aria-label', entry?.hardOff ? `難しい依頼（${entry.hardOff}）` : '難しい依頼')
  const hard = !!entry?.hard && !entry.hardOff && toggle.getAttribute('aria-pressed') === 'true'
  toggle.setAttribute('aria-pressed', String(hard))
  hardField.value = hard ? '1' : ''
  const name = aiPanel()?.querySelector('[data-ai-model]')
  if (name && entry) name.textContent = hard ? entry.hard : entry.label
}

/** 応答のあとの利用状況を反映する。同じ枠（key）はどのモデルの欄でも同じなので、key の合う行をすべて書き換える */
function paintAiUsage(panel: HTMLElement, usage: AiUsageMeter[], hardOff: string | null) {
  for (const meter of usage) {
    $$<HTMLElement>(`[data-ai-meter="${CSS.escape(meter.key)}"]`, panel).forEach((el) => {
      el.dataset.state = meter.state
      el.toggleAttribute('data-high', meter.state === 'ok' && meter.percent >= 80)
      el.style.setProperty('--ai-used', `${meter.percent}%`)
      const percent = el.querySelector('[data-ai-meter-percent]')
      if (percent) percent.textContent = String(meter.percent)
      const note = el.querySelector('[data-ai-meter-note]')
      if (note) note.textContent = meter.note
      el.querySelector('[role=progressbar]')?.setAttribute('aria-valuenow', String(meter.percent))
    })
  }
  $$<HTMLElement>('[data-ai-usage-trigger]', panel).forEach((trigger) => {
    const main = trigger.closest('[data-ai-usage]')?.querySelector<HTMLElement>('.ai-meter')
    const percent = main?.querySelector('[data-ai-meter-percent]')?.textContent ?? '0'
    const label = main?.querySelector('.ai-meter-label')?.textContent ?? ''
    trigger.setAttribute('aria-label', `今週の利用状況（${label} ${percent}% 使用）`)
    const text = trigger.querySelector('[data-ai-usage-main]')
    if (text) text.textContent = percent
  })
  const form = panel.querySelector<HTMLFormElement>('[data-ai-form]')
  const model = form && chosenAiModel(form)
  if (!form || !model) return
  const labels = aiLabelsOf(form)
  if (labels[model]) labels[model].hardOff = hardOff
  form.dataset.aiLabels = JSON.stringify(labels)
  syncAiModel(form)
}

function paintAiContext(panel: HTMLElement, percent: number) {
  const meter = panel.querySelector<HTMLElement>('[data-ai-context]')
  if (!meter) return
  meter.style.setProperty('--ai-used', `${percent}%`)
  meter.querySelector('summary')?.setAttribute('aria-label', `会話の長さ（${percent}%）`)
  meter.querySelector('[role=progressbar]')?.setAttribute('aria-valuenow', String(percent))
  $$('[data-ai-context-percent]', meter).forEach((text) => (text.textContent = String(percent)))
}

document.addEventListener('change', (e) => {
  const input = e.target as Element
  if (input instanceof HTMLInputElement && input.name === 'model' && input.form?.matches('[data-ai-form]')) syncAiModel(input.form)
})

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-toggle]')) return setAiOpen(!document.documentElement.hasAttribute('data-ai-open'))
  const focusStart = target.closest<HTMLElement>('[data-ai-focus-start]')
  if (focusStart) return void startAiFocus(focusStart)
  if (target.closest('[data-ai-focus-clear]')) return clearAiFocus()
  if (target.closest('[data-ai-stop]')) return void stopAi()
  if (target.closest('[data-ai-approve-next]')) return showNextAiCard()
  const hardToggle = target.closest<HTMLElement>('[data-ai-hard]')
  const hardForm = hardToggle?.closest<HTMLFormElement>('[data-ai-form]')
  if (hardToggle && hardForm) {
    hardToggle.setAttribute('aria-pressed', String(hardToggle.getAttribute('aria-pressed') !== 'true'))
    return syncAiModel(hardForm)
  }
  const suggestion = target.closest<HTMLElement>('[data-ai-suggest]')
  const input = aiInput()
  if (!suggestion || !input) return
  input.value = suggestion.dataset.aiSuggest ?? ''
  fitAiInput(input)
  input.form?.requestSubmit()
})

document.addEventListener('keydown', (e) => {
  const input = e.target as Element
  if (e.key === 'Escape' && aiVoice) {
    e.preventDefault()
    return cancelAiVoice()
  }
  if (e.key === 'Escape' && !aiDocked() && aiPanel()?.contains(input)) return setAiOpen(false)
  if (!(input instanceof HTMLTextAreaElement) || !input.matches('.ai-textarea') || e.key !== 'Enter' || e.shiftKey) return
  // keyCode も見るのは、Safari では変換を確定した Enter の keydown で isComposing が false になるため
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  input.form?.requestSubmit()
})

document.addEventListener('input', (e) => {
  const input = e.target as Element
  if (input instanceof HTMLTextAreaElement && input.matches('.ai-textarea')) fitAiInput(input)
})

document.addEventListener('compositionstart', (e) => {
  if ((e.target as Element).matches('.ai-textarea')) aiComposing = true
})

document.addEventListener('compositionend', (e) => {
  if ((e.target as Element).matches('.ai-textarea')) aiComposing = false
})

/** パネルを取り直す。入力中の文と選んでいたモデル・「難しい依頼」はそのまま残し、model を渡せば、新しいチャットのモデルにそれを選んでおく */
async function refreshAiPanel(model?: string) {
  window.clearTimeout(aiSyncTimer)
  const res = await fetch('/ai/chat', { headers: { Accept: 'text/html' } })
  const doc = res.ok ? new DOMParser().parseFromString(await res.text(), 'text/html') : null
  const next = doc?.getElementById('ai-panel')
  const current = aiPanel()
  if (!next || !current) return
  const draft = aiInput()?.value ?? ''
  const focused = document.activeElement === aiInput()
  const chosen = model ?? current.querySelector<HTMLInputElement>('input[name=model]:checked')?.value
  const hard = current.querySelector('[data-ai-hard]')?.getAttribute('aria-pressed')
  const focus = aiFocusField(current)?.value ? current.querySelector('[data-ai-focus]') : null
  const buddy = aiBuddy(current)
  const buddyBox = buddy && !buddy.hidden ? aiMascotBox(buddy) : null
  current.replaceWith(document.adoptNode(next))
  // 作業していたマスコットを持ち越すのは、描き直したものに替えると、見せていた反応や動きが途中で切れて、飛び移ったように見えるため
  const nextBuddy = aiBuddy(next)
  if (buddy && buddyBox && nextBuddy && !nextBuddy.hidden) nextBuddy.replaceWith(buddy)
  else if (buddyBox) {
    const introMascot = next.querySelector<HTMLElement>('[data-ai-intro]:not([hidden]) .mascot')
    if (introMascot) flyAiBuddy(buddyBox, introMascot)
  }
  settleAiBuddy(next)
  // 選ぼうとしているアイテムを持ち越すのは、最初の発言を断られて入力欄に戻ったとき、送り直すとアイテムを選ばずに始まるため
  const nextFocus = next.querySelector('[data-ai-focus]')
  const focusField = aiFocusField(next)
  if (focus && nextFocus && focusField) {
    focusField.value = aiFocusField(current)!.value
    nextFocus.replaceWith(focus)
  }
  const option = $$<HTMLInputElement>('input[type=radio][name=model]', next).find((r) => r.value === chosen)
  if (option) option.checked = true
  const form = next.querySelector<HTMLFormElement>('[data-ai-form]')
  if (hard) next.querySelector('[data-ai-hard]')?.setAttribute('aria-pressed', hard)
  if (form) syncAiModel(form)
  const input = aiInput()
  if (input && draft) {
    input.value = draft
    fitAiInput(input)
  }
  if (input && focused) input.focus()
  paintAiImage()
  showAiVoice()
  initMascots()
  void fillAiSuggestions()
  scrollAiLog(true)
  watchAiCards()
  scheduleAiSync()
}

const aiWatching = () => !!aiPanel() && !document.hidden && document.documentElement.hasAttribute('data-ai-open')

function scheduleAiSync() {
  window.clearTimeout(aiSyncTimer)
  if (!aiWatching()) return
  const delay = aiPanel()!.hasAttribute('data-busy') ? AI_BUSY_SYNC_INTERVAL : AI_SYNC_INTERVAL
  aiSyncTimer = window.setTimeout(() => void syncAiPanel(), delay)
}

/** ほかのタブや端末での発言や応答を、パネルがまだ反映していなければ true */
async function aiPanelOutdated() {
  const panel = aiPanel()
  if (!panel) return false
  const res = await fetchJson('/ai/chat/state', { cache: 'no-store' })
  if (!res.ok) return false
  const state = (await res.json()) as { revision: string; busy: boolean }
  return state.revision !== (panel.dataset.revision ?? '') || state.busy !== panel.hasAttribute('data-busy')
}

/** 古ければ取り直す。取り直したら true。model は refreshAiPanel と同じ */
async function refreshAiIfOutdated(model?: string) {
  try {
    if (!(await aiPanelOutdated())) return false
    await refreshAiPanel(model)
    return true
  } catch {
    return false
  }
}

// 作成中の応答を開き直した画面に流し直さないのは、流れていた続きを受け取る手段がなく、言い終えて保存されたものを取り直せば足りるため
// 変換中に取り直さないのは、入力欄が差し替わって、確定していない文字が消えるため。音声入力の途中も、入力欄を差し替えると録った文が消えるので取り直さない
function syncAiPanel() {
  if (aiSending) return Promise.resolve()
  if (aiComposing || aiVoice || !aiWatching()) {
    scheduleAiSync()
    return Promise.resolve()
  }
  aiSync ??= (async () => {
    try {
      if ((await aiPanelOutdated()) && !aiSending && !aiComposing) await refreshAiPanel()
    } catch {}
  })().finally(() => {
    aiSync = null
    if (!aiSending) scheduleAiSync()
  })
  return aiSync
}

aiChannel.addEventListener('message', () => void syncAiPanel())
document.addEventListener('visibilitychange', () => void syncAiPanel())
addEventListener('focus', () => void syncAiPanel())

// --- AI のパネルのヘッダーで作業するマスコット（features/ai/components/ai-panel.tsx の AiBuddy）
// 状態を保存せずにクライアントで持つのは、応答を作っているあいだの細かな動きは、流れてくるイベントからしか分からないため
const AI_BUDDY_FLASH_MS: Partial<Record<AiBuddyState, number>> = { applied: 1400, done: 2200, error: 3000, stopped: 1400 }
const AI_BUDDY_BREAK_AFTER = 25_000
const AI_BUDDY_DOZE_AFTER = 120_000
const AI_BUDDY_FLY_MS = 750
// ツールを終えた時点で「考えています」に戻さないのは、ツールの多くは一瞬で終わり、何を見ていたのかが見えないまま次へ移るため
const AI_BUDDY_HOLD_MS = 1600
let aiBuddyBase: AiBuddyState = 'idle'
let aiBuddyFlashTimer = 0
let aiBuddyReady = false
const aiBuddyIdleTimers: number[] = []

const aiBuddy = (root: ParentNode | null = aiPanel()) => root?.querySelector<HTMLElement>('[data-ai-buddy]') ?? null

function paintAiBuddy(state: AiBuddyState) {
  const buddy = aiBuddy()
  const mascot = buddy?.querySelector<HTMLElement>('[data-mascot]')
  if (!buddy || !mascot || buddy.dataset.state === state) return
  buddy.dataset.state = state
  Object.assign(mascot.dataset, AI_BUDDY_LOOKS[state])
  mascot.toggleAttribute('data-steady', state !== 'idle')
  mascot.removeAttribute('data-quirk')
  for (const mark of $$<HTMLElement>('[data-ai-buddy-mark]', buddy)) mark.hidden = mark.dataset.aiBuddyMark !== state
}

/** マスコットの今の状態を決める。applied などの反応を見せているあいだは、反応を見せ終えてからこの状態に移る */
function setAiBuddy(state: AiBuddyState) {
  aiBuddyBase = state
  aiBuddyIdleTimers.splice(0).forEach((t) => clearTimeout(t))
  if (!aiBuddyFlashTimer) paintAiBuddy(state)
  if (state !== 'idle') return
  const rest = (next: AiBuddyState) => () => {
    if (aiBuddyBase === 'idle' && !aiBuddyFlashTimer) paintAiBuddy(next)
  }
  aiBuddyIdleTimers.push(window.setTimeout(rest('break'), AI_BUDDY_BREAK_AFTER), window.setTimeout(rest('doze'), AI_BUDDY_DOZE_AFTER))
}

/** 少しのあいだだけ反応を見せて、setAiBuddy で決めた状態に戻る */
function flashAiBuddy(state: keyof typeof AI_BUDDY_FLASH_MS) {
  clearTimeout(aiBuddyFlashTimer)
  paintAiBuddy(state)
  aiBuddyFlashTimer = window.setTimeout(() => {
    aiBuddyFlashTimer = 0
    setAiBuddy(aiBuddyBase)
  }, AI_BUDDY_FLASH_MS[state])
}

/** 確認やファイルを待つカードがあればそれを待つ状態に、なければ手が空いた状態にする */
function restAiBuddy(panel: HTMLElement) {
  const pending = $$<HTMLElement>('.ai-card[data-state=pending]', panel)
  setAiBuddy(pending.some((c) => !c.matches('.ai-file-card')) ? 'ask' : pending.length > 0 ? 'wait-file' : 'idle')
}

/** 描いたパネルの様子にマスコットを合わせる */
function settleAiBuddy(panel: HTMLElement) {
  if (panel.hasAttribute('data-busy')) setAiBuddy('think')
  else restAiBuddy(panel)
}

/** ヘッダーのマスコットを出すか隠す。チャットがないあいだは、代わりにアイコンを出す */
function showAiBuddy(panel: HTMLElement, shown: boolean) {
  const buddy = aiBuddy(panel)
  const mark = panel.querySelector<HTMLElement>('[data-ai-mark]')
  if (buddy) buddy.hidden = !shown
  if (mark) mark.hidden = shown
}

// 位置を変える要素そのものではなく見た目だけを動かすのは、ヘッダーとチャットの始まりの画面の並びを、飛んでいるあいだも崩さないため
/** from の位置から to のマスコットのいる場所まで、弧を描いて飛ばす */
function flyAiBuddy(from: DOMRect, to: HTMLElement) {
  if (reducedMotion()) return
  const end = to.getBoundingClientRect()
  if (!from.width || !end.width) return
  const dx = from.left - end.left
  const dy = from.top - end.top
  const scale = from.width / end.width
  const lift = Math.min(60, Math.abs(dy) / 3 + 20)
  to.animate(
    [
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      {
        transformOrigin: '0 0',
        transform: `translate(${dx * 0.45}px, ${Math.min(dy, 0) * 0.45 - lift}px) scale(${(scale + 1) / 2}) rotate(-10deg)`,
        offset: 0.45,
      },
      { transformOrigin: '0 0', transform: 'scale(1.12, 0.88)', offset: 0.85 },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    { duration: AI_BUDDY_FLY_MS, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
  )
}

const aiMascotBox = (root: Element | null) => root?.querySelector('.mascot-svg')?.getBoundingClientRect() ?? null

type AiStreamHooks = { onRetract?: () => void; onChat?: (id: number) => void }

/**
 * 応答を届いた分から会話に書き足す。closed はチャットがもうないこと、confirmed は確認カードを出したこと、
 * outdated はパネルが古く、発言を受け付けられなかったこと、errors は出したエラーの文言
 */
async function streamAi(url: string, data: FormData, { onRetract, onChat }: AiStreamHooks = {}) {
  const panel = aiPanel()
  const log = panel?.querySelector<HTMLElement>('[data-ai-log]')
  const outcome = { closed: false, retracted: false, confirmed: false, outdated: false, stopped: false, errors: [] as string[] }
  if (!panel || !log) return outcome
  data.set('page', location.pathname)
  data.set('revision', panel.dataset.revision ?? '')
  panel.toggleAttribute('data-busy', true)
  const pending = aiTemplate('pending')
  const pendingLabel = pending.querySelector('[data-ai-pending-label]')
  const thinkingText = pendingLabel?.textContent ?? ''
  log.append(pending)
  scrollAiLog(true)

  let bubble: HTMLElement | null = null
  let markdown = ''
  let thinkingTimer = 0
  let activity: AiBuddyState = 'think'
  let answered = false
  let failed = false
  let holdUntil = 0
  let holdTimer = 0
  const work = (next: AiBuddyState) => {
    clearTimeout(holdTimer)
    activity = next
    setAiBuddy(next)
    if (pendingLabel) pendingLabel.textContent = AI_BUDDY_LABELS[next] ?? thinkingText
  }
  work('think')
  // 本文が届いた時点で消したままにしないのは、本文のあとにツールを呼ぶあいだ、何も動いていないように見えるため
  const updateThinking = (writing: boolean) => {
    clearTimeout(thinkingTimer)
    pending.hidden = writing
    if (writing)
      thinkingTimer = window.setTimeout(() => {
        pending.hidden = false
        setAiBuddy(activity)
      }, AI_THINKING_AFTER_TEXT)
  }
  const handle = (event: AiAgentEvent) => {
    // 書き足したあとに最下部か確かめないのは、続きの依頼のような高さのある塊を足すと、最下部から離れたと見なされて止まるため
    const following = aiLogAtBottom(log)
    updateThinking(event.type === 'text')
    if (event.type === 'compacting') return work('summarize')
    if (event.type === 'working') {
      holdUntil = performance.now() + AI_BUDDY_HOLD_MS
      return work(event.activity)
    }
    if (event.type === 'text') {
      clearTimeout(holdTimer)
      answered = true
      activity = 'think'
      if (pendingLabel) pendingLabel.textContent = thinkingText
      setAiBuddy('write')
      if (!bubble) {
        bubble = aiTemplate('assistant')
        pending.before(bubble)
      }
      markdown += event.text
      bubble.querySelector('[data-ai-text]')!.innerHTML = renderMarkdown(markdown)
    } else if (event.type === 'tool' || event.type === 'confirm') {
      answered = true
      const left = holdUntil - performance.now()
      if (left > 0) holdTimer = window.setTimeout(() => work('think'), left)
      else work('think')
      bubble = null
      markdown = ''
      if (event.type === 'tool') pending.before(aiToolLine(event.label, event.touched))
      else outcome.confirmed = true
    } else if (event.type === 'error') {
      if (event.retract) {
        outcome.retracted = true
        onRetract?.()
      }
      outcome.errors.push(event.message)
      pending.before(aiTemplate('error', event.message))
      flashAiBuddy('error')
    } else if (event.type === 'chat') {
      panel.dataset.chat = String(event.id)
      onChat?.(event.id)
    } else if (event.type === 'closed') {
      outcome.closed = true
    } else if (event.type === 'outdated') {
      outcome.outdated = true
      onRetract?.()
    } else if (event.type === 'applied') {
      aiHooks.showChange(event.touched)
      if (activity === 'apply') work('think')
      flashAiBuddy('applied')
    } else if (event.type === 'replies') {
      pending.before(aiReplies(event.replies))
    } else if (event.type === 'compacted') {
      const sent = $$<HTMLElement>('.ai-msg-user', log).at(-1)
      sent?.before(aiTemplate('compacted'))
    } else if (event.type === 'stopped') {
      outcome.stopped = true
      flashAiBuddy('stopped')
      if (event.retract) {
        outcome.retracted = true
        onRetract?.()
      } else {
        pending.before(aiTemplate('stopped'))
      }
    } else {
      panel.dataset.revision = event.revision
      paintAiUsage(panel, event.usage, event.hardOff)
      paintAiContext(panel, event.context)
    }
    scrollAiLog(following)
  }

  try {
    const res = await fetch(url, { method: 'POST', body: data, headers: { Accept: 'application/x-ndjson' } })
    if (!res.ok || !res.body) throw new Error(`status ${res.status}`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) handle(JSON.parse(line) as AiAgentEvent)
    }
  } catch {
    pending.before(aiTemplate('error', 'AI と通信できませんでした。少し待ってから、もう一度お試しください。'))
    failed = true
    flashAiBuddy('error')
  } finally {
    clearTimeout(thinkingTimer)
    clearTimeout(holdTimer)
    pending.remove()
    restAiBuddy(panel)
    if (answered && !failed && !outcome.confirmed && !outcome.stopped && outcome.errors.length === 0) flashAiBuddy('done')
    // 入力欄に移すのは、押した停止のボタンが隠れてフォーカスが消え、キーボードで続きを打てなくなるため
    const stopFocused = !!document.activeElement?.matches('[data-ai-stop]')
    panel.removeAttribute('data-busy')
    if (stopFocused) aiInput()?.focus()
    scrollAiLog()
  }
  return outcome
}

/** 作成中の応答を止める。サーバーが止めて保存し終えると、流れていた応答もそこで終わる */
// 押したボタンを disabled にしないのは、フォーカスが外れて、止めたあとに入力欄へ戻せなくなるため
async function stopAi() {
  if (aiStopping) return
  aiStopping = true
  try {
    const res = await fetchJson('/ai/chat/stop', { method: 'POST' })
    if (!res.ok) throw new Error(`status ${res.status}`)
    aiChannel.postMessage('changed')
    // 応答を流しているのがほかのタブなら取り直すのは、次の問い合わせまで、止めたのに作成中のまま見えるため
    if (!aiSending) await refreshAiPanel()
  } catch {
    toast('生成を停止できませんでした。', 'error')
  } finally {
    aiStopping = false
  }
}

function noteAiProblem(message: string) {
  aiPanel()?.querySelector('[data-ai-log]')?.append(aiTemplate('error', message))
  scrollAiLog(true)
}

// --- AI のパネルの発言に添える画像（features/ai/components/ai-panel.tsx の data-ai-image。送るのは発言と同じ /ai/chat）
// 縮めずに送らないのは、Claude は長い辺が 1568px を超える画像を縮めてから読むので、大きいまま送っても見え方は変わらず、送る量と保存する会話が膨らむだけのため
const AI_IMAGE_MAX_EDGE = 1568
const AI_IMAGE_MAX_SIZE = 5 * 1024 * 1024
const AI_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
// 入力欄の下に置かないのは、パネルを取り直すと選んだ画像が消え、送る前に外されたように見えるため
let aiImage: { file: File; url: string } | null = null

const aiImageButton = () => aiPanel()?.querySelector<HTMLButtonElement>('button[data-ai-image]') ?? null

async function shrinkAiImage(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  const scale = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= AI_IMAGE_MAX_SIZE && AI_IMAGE_TYPES.includes(file.type)) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')!
  const render = (type: 'image/png' | 'image/jpeg') => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    // 透明なまま JPEG にしないのは、透明な部分が黒く塗られて読めなくなるため
    if (type === 'image/jpeg') {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
  }
  // 画面の写しを JPEG にしないのは、文字のまわりがにじんで、AI が細かい文字を読み違えるため
  let blob = file.type === 'image/png' ? await render('image/png') : null
  if (!blob || blob.size > AI_IMAGE_MAX_SIZE) blob = await render('image/jpeg')
  bitmap.close()
  if (!blob || blob.size > AI_IMAGE_MAX_SIZE) return null
  const base = file.name.replace(/\.[^.]*$/, '') || 'image'
  return new File([blob], `${base}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type })
}

/** 送る前の画像を出し直す。パネルを取り直したあとにも呼ぶ */
function paintAiImage() {
  const chip = aiPanel()?.querySelector<HTMLElement>('[data-ai-attach]')
  const thumb = chip?.querySelector<HTMLImageElement>('[data-ai-attach-thumb]')
  const name = chip?.querySelector('[data-ai-attach-name]')
  if (!chip || !thumb || !name) return
  chip.hidden = !aiImage
  if (aiImage) thumb.src = aiImage.url
  else thumb.removeAttribute('src')
  name.textContent = aiImage?.file.name ?? ''
}

/** 送る前の画像を替える。sent は、外す画像を送った発言がまだ画面で使っていること */
function setAiImage(file: File | null, sent = false) {
  if (aiImage && !sent) URL.revokeObjectURL(aiImage.url)
  aiImage = file && { file, url: URL.createObjectURL(file) }
  paintAiImage()
}

// 1 回の発言に何枚も選ばせないのは、1 回に添えられるのは 1 枚までで、2 枚目を選んだら替えたいのだと分かるため
async function attachAiImage(file: File) {
  const button = aiImageButton()
  if (!button || button.hidden || button.disabled) return
  if (!file.type.startsWith('image/')) return toast('画像のファイルを選んでください。', 'error')
  const shrunk = await shrinkAiImage(file)
  if (!shrunk) return toast('この画像は読み込めません。PNG・JPEG・WebP・GIF の画像を選んでください。', 'error')
  setAiImage(shrunk)
  aiInput()?.focus()
}

/** 画像を添えた発言を送れたら、このチャットで添えられる残りの枚数を減らす */
function countAiImageSent() {
  const button = aiImageButton()
  if (!button) return
  const left = Math.max(0, Number(button.dataset.left ?? 0) - 1)
  button.dataset.left = String(left)
  button.disabled = left === 0
  button.setAttribute(
    'aria-label',
    left > 0 ? `画像を添える（このチャットであと ${left} 枚）` : `画像は 1 つのチャットで ${button.dataset.max ?? ''} 枚まで送れます`,
  )
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-attach-clear]')) {
    setAiImage(null)
    return aiInput()?.focus()
  }
  if (target.closest('button[data-ai-image]')) aiPanel()?.querySelector<HTMLInputElement>('[data-ai-image-input]')?.click()
})

document.addEventListener('change', (e) => {
  const input = e.target as Element
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-ai-image-input]')) return
  const file = input.files?.[0]
  input.value = ''
  if (file) void attachAiImage(file)
})

// 文字と画像の両方が入っていれば文字を貼るのは、表計算や文書の範囲を写すと、文字と一緒にその範囲の画像も入るため
document.addEventListener('paste', (e) => {
  const input = e.target as Element
  if (!(input instanceof HTMLTextAreaElement) || !input.matches('.ai-textarea') || !e.clipboardData) return
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
  if (!file || e.clipboardData.types.includes('text/plain')) return
  e.preventDefault()
  void attachAiImage(file)
})

// ファイルを選ぶカードの上では受けないのは、カードのファイルの選択（.file-drop-zone）に落としたファイルまで、発言に添えることになるため
const aiImageDropOf = (e: DragEvent) =>
  e.target instanceof Element && carriesFiles(e) && !dropZoneOf(e) ? e.target.closest<HTMLElement>('[data-ai-panel]') : null

document.addEventListener('dragover', (e) => {
  const panel = aiImageDropOf(e)
  if (!panel || aiImageButton()?.hidden !== false || aiImageButton()?.disabled) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
  panel.toggleAttribute('data-dragging', true)
})
document.addEventListener('dragleave', (e) => {
  const panel = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-ai-panel]') : null
  // 子要素に入ったときに外さないのは、強調がちらつくため
  if (panel && !(e.relatedTarget instanceof Node && panel.contains(e.relatedTarget))) panel.removeAttribute('data-dragging')
})
document.addEventListener('drop', (e) => {
  const panel = aiImageDropOf(e)
  if (!panel) return
  e.preventDefault()
  panel.removeAttribute('data-dragging')
  const file = [...e.dataTransfer!.files].find((f) => f.type.startsWith('image/')) ?? e.dataTransfer!.files[0]
  if (file) void attachAiImage(file)
})

/**
 * 入力欄の発言を送る。パネルが古ければ取り直してから送り、開いていたチャットがほかのタブで閉じられていれば、
 * 同じモデル（model）の新しいチャットで送る。retried は、送ったときにパネルが古かったために送り直した 2 回目であること
 */
async function sendAiMessage(retried = false, model = aiPanel()?.dataset.model) {
  await refreshAiIfOutdated(model)
  const panel = aiPanel()
  const form = panel?.querySelector<HTMLFormElement>('[data-ai-form]')
  const log = panel?.querySelector<HTMLElement>('[data-ai-log]')
  const input = aiInput()
  if (!panel || !form || !log || !input) return
  const text = input.value.trim()
  if (!text) return
  const data = new FormData(form)
  const image = aiImage
  if (image) data.set('image', image.file)
  const intro = log.querySelector<HTMLElement>('[data-ai-intro]')
  const started = !panel.dataset.chat
  const dismissing = !!log.querySelector('.ai-card[data-state=pending]')
  const replies = $$<HTMLElement>('[data-ai-replies]', log)
  replies.forEach((el) => (el.hidden = true))
  const introMascot = intro && !intro.hidden ? aiMascotBox(intro) : null
  if (intro) intro.hidden = true
  const buddy = aiBuddy(panel)
  if (started && buddy) {
    showAiBuddy(panel, true)
    if (introMascot) flyAiBuddy(introMascot, buddy)
  }
  const sent = aiTemplate('user', text)
  const sentImage = sent.querySelector<HTMLAnchorElement>('[data-ai-image-link]')
  if (image && sentImage) {
    sentImage.href = image.url
    sentImage.querySelector('img')!.src = image.url
    sentImage.hidden = false
  }
  log.append(sent)
  input.value = ''
  fitAiInput(input)
  if (image) setAiImage(null, true)

  const outcome = await streamAi(form.action, data, {
    onRetract: () => {
      sent.remove()
      replies.forEach((el) => (el.hidden = false))
      if (intro && !log.querySelector('.ai-msg')) {
        const from = aiMascotBox(aiBuddy(panel))
        intro.hidden = false
        showAiBuddy(panel, false)
        const to = intro.querySelector<HTMLElement>('.mascot')
        if (from && to) flyAiBuddy(from, to)
      }
      if (!input.value) input.value = text
      fitAiInput(input)
      if (image && !aiImage) {
        aiImage = image
        paintAiImage()
      }
    },
    onChat: (id) => {
      const chatField = form.elements.namedItem('chat')
      if (chatField instanceof HTMLInputElement) chatField.value = String(id)
    },
  })
  if (image && !outcome.retracted && !outcome.outdated) countAiImageSent()
  if (outcome.outdated) {
    await refreshAiPanel(model)
    if (!retried) return sendAiMessage(true, model)
    return noteAiProblem('ほかのタブで会話が進んだため、送れませんでした。会話を確かめて、もう一度送信してください。')
  }
  // 新しく始めたチャットと確認カードを取り直すのは、ヘッダーのモデル名・「閉じる」ボタン・カードを、サーバーの描いたものにそろえるため
  if (outcome.closed || outcome.confirmed || dismissing || (started && panel.dataset.chat)) {
    await refreshAiPanel()
    // 取り直したパネルだけにしないのは、送り直してもらう発言はサーバーに残らず、断った理由まで消えるため
    if (outcome.retracted) {
      const next = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
      for (const message of outcome.errors) next?.append(aiTemplate('error', message))
      scrollAiLog(true)
    }
  }
}

async function decideAiCard(form: HTMLFormElement, submitter: HTMLElement | null) {
  const call = new FormData(form).get('call')
  const decision = submitter instanceof HTMLButtonElement ? submitter.value : ''
  const fileInput = form.matches('[data-ai-file]') ? form.querySelector<HTMLInputElement>('input[type=file]') : null
  const file = fileInput?.files?.[0]
  if (fileInput && decision === 'approve' && !file) {
    toast('送るファイルを選んでください。', 'error')
    return fileInput.focus()
  }
  if (await refreshAiIfOutdated()) {
    const next = $$<HTMLFormElement>('[data-ai-confirm]', aiPanel() ?? document).find((f) => new FormData(f).get('call') === call)
    // 取り直したパネルでカードが確認を待っていなければ送らないのは、ほかのタブで決めたカードを決め直さないため
    if (!next) return
    form = next
    submitter = $$<HTMLButtonElement>('button[name=decision]', next).find((b) => b.value === decision) ?? null
  }
  const data = new FormData(form, submitter)
  // 選んだファイルを添え直すのは、パネルを取り直すと、新しいカードのファイルの選択は空になっているため
  if (file && decision === 'approve') data.set('file', file)
  $$<HTMLButtonElement>('button', form).forEach((btn) => (btn.disabled = true))
  $$('[data-ai-replies]', aiPanel() ?? document).forEach((el) => el.remove())
  const outcome = await streamAi(form.action, data)
  await refreshAiPanel()
  // 取り直したパネルだけにしないのは、受け取れなかったファイルのカードは選ぶ前に戻り、断った理由まで消えるため
  if (outcome.retracted) for (const message of outcome.errors) noteAiProblem(message)
}

// --- AI の確認カードをまとめて承認する（features/ai/components/ai-panel.tsx の data-ai-approve-all。承認するのは /ai/chat/confirm-all）
// カードの先頭と末尾を別々に見るのは、パネルより高いカードは一度に収まらず、末尾までスクロールして読み終えたことを見るため
type AiCardEdge = 'top' | 'bottom'
const AI_CARD_EDGES: Record<AiCardEdge, string> = { top: '.ai-card-title', bottom: '.ai-card-actions' }
// 取り直しのたびに忘れないのは、応答のあとや、ほかのタブの発言でパネルを取り直しても、一度見たカードは見たままにするため
const aiCardEdgesSeen = new Map<string, Set<AiCardEdge>>()
let aiCardObserver: IntersectionObserver | null = null

const aiCardKey = (callId: string) => `${aiPanel()?.dataset.chat ?? ''}:${callId}`
const aiCardSeen = (callId: string) => aiCardEdgesSeen.get(aiCardKey(callId))?.size === Object.keys(AI_CARD_EDGES).length
const aiApproveAllForm = () => aiPanel()?.querySelector<HTMLFormElement>('[data-ai-approve-all]') ?? null
const aiApproveCalls = (form: HTMLFormElement) => new FormData(form).getAll('call[]').map(String)

function paintAiApproveAll() {
  const form = aiApproveAllForm()
  if (!form) return
  const unseen = aiApproveCalls(form).filter((call) => !aiCardSeen(call)).length
  if (form.dataset.unseen === String(unseen)) return
  const nextFocused = document.activeElement?.matches('[data-ai-approve-next]')
  form.dataset.unseen = String(unseen)
  const count = form.querySelector('[data-ai-unseen]')
  if (count) count.textContent = String(unseen)
  // 承認のボタンに移すのは、押していた「次の提案を見る」が隠れてフォーカスが消え、キーボードで続けられなくなるため
  if (nextFocused && unseen === 0) form.querySelector<HTMLButtonElement>('button[type=submit]')?.focus()
}

// パネルを開いたときにも呼ぶのは、閉じているあいだはカードを見たことにせず、開いた時点で見えているカードを数え直すため
function watchAiCards() {
  aiCardObserver?.disconnect()
  aiCardObserver = null
  const log = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
  const cards = log ? $$<HTMLElement>('.ai-card[data-ai-card]', log) : []
  if (!log || !aiApproveAllForm() || cards.length === 0) return
  aiCardObserver = new IntersectionObserver(
    (entries) => {
      if (document.hidden || !document.documentElement.hasAttribute('data-ai-open')) return
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        const callId = target.closest<HTMLElement>('[data-ai-card]')?.dataset.aiCard
        const edge = target.dataset.aiCardEdge as AiCardEdge | undefined
        if (!entry.isIntersecting || !callId || !edge) continue
        const key = aiCardKey(callId)
        aiCardEdgesSeen.set(key, (aiCardEdgesSeen.get(key) ?? new Set()).add(edge))
      }
      paintAiApproveAll()
    },
    { root: log, threshold: 0.9 },
  )
  for (const card of cards)
    for (const [edge, selector] of Object.entries(AI_CARD_EDGES)) {
      const target = card.querySelector<HTMLElement>(selector)
      if (!target) continue
      target.dataset.aiCardEdge = edge
      aiCardObserver.observe(target)
    }
  paintAiApproveAll()
}

/** まだ見ていない最初のカードへスクロールする。先頭を見たカードなら、残りの末尾までを見せる */
function showNextAiCard() {
  const panel = aiPanel()
  const form = aiApproveAllForm()
  if (!panel || !form) return
  const call = aiApproveCalls(form).find((c) => !aiCardSeen(c))
  const card = call ? $$<HTMLElement>('.ai-card[data-ai-card]', panel).find((el) => el.dataset.aiCard === call) : undefined
  if (!call || !card) return
  const topSeen = aiCardEdgesSeen.get(aiCardKey(call))?.has('top')
  const behavior = reducedMotion() ? 'auto' : 'smooth'
  const target = (topSeen && card.querySelector<HTMLElement>(AI_CARD_EDGES.bottom)) || card
  target.scrollIntoView({ behavior, block: topSeen ? 'end' : 'start' })
  card.classList.remove('is-unseen-target')
  void card.offsetWidth
  card.classList.add('is-unseen-target')
  card.addEventListener('animationend', () => card.classList.remove('is-unseen-target'), { once: true })
}

/** 画面で見た確認カードをまとめて承認する。ほかのタブで決まったカードや、まだ見ていないカードがあれば送らない */
async function approveAllAiCards(form: HTMLFormElement) {
  const calls = aiApproveCalls(form)
  if (await refreshAiIfOutdated()) {
    const next = aiApproveAllForm()
    const pending = new Set(next ? aiApproveCalls(next) : [])
    // 取り直したパネルで残りだけを承認しないのは、ほかのタブで取り消したカードがあると、それを踏まえて決め直したいかもしれないため
    if (!next || !calls.every((call) => pending.has(call))) return
    form = next
  }
  if (calls.some((call) => !aiCardSeen(call))) return paintAiApproveAll()
  const data = new FormData(form)
  data.delete('call[]')
  for (const call of calls) data.append('call[]', call)
  const panel = aiPanel() ?? document
  $$<HTMLButtonElement>('[data-ai-confirm] button, [data-ai-approve-all] button', panel).forEach((btn) => (btn.disabled = true))
  $$('[data-ai-replies]', panel).forEach((el) => el.remove())
  await streamAi(form.action, data)
  await refreshAiPanel()
}

const AI_CLOSE_ARMED_MS = 3000
let aiCloseTimer = 0

function setAiCloseArmed(form: HTMLFormElement, armed: boolean) {
  const arm = form.querySelector<HTMLButtonElement>('[data-ai-close-arm]')
  const armedButton = form.querySelector<HTMLButtonElement>('[data-ai-close-armed]')
  if (!arm || !armedButton) return
  const refocus = document.activeElement === (armed ? arm : armedButton)
  arm.hidden = armed
  armedButton.hidden = !armed
  if (refocus) (armed ? armedButton : arm).focus()
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  // ダブルクリックの 2 回目で閉じないのは、1 回押したつもりの人の会話まで消えるため
  if (e.detail > 1 && target.closest('[data-ai-close-armed]')) return e.preventDefault()
  const form = target.closest<HTMLButtonElement>('[data-ai-close-arm]')?.form
  if (!form) return
  setAiCloseArmed(form, true)
  window.clearTimeout(aiCloseTimer)
  aiCloseTimer = window.setTimeout(() => setAiCloseArmed(form, false), AI_CLOSE_ARMED_MS)
})

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  if (e.defaultPrevented || !form.matches('[data-ai-form], [data-ai-close], [data-ai-confirm], [data-ai-approve-all]')) return
  e.preventDefault()
  if (form.matches('[data-ai-approve-all]')) return void runAiTask(() => approveAllAiCards(form))
  if (aiVoice && form.matches('[data-ai-form]')) return void finishAiVoice()
  if (form.matches('[data-ai-form], [data-ai-confirm]')) {
    const submitter = e.submitter
    void runAiTask(() => (form.matches('[data-ai-form]') ? sendAiMessage() : decideAiCard(form, submitter)))
    return
  }
  window.clearTimeout(aiCloseTimer)
  fetchJson(form.action, { method: 'POST', body: new FormData(form) })
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`)
      aiChannel.postMessage('changed')
      return refreshAiPanel()
    })
    .then(() => aiDocked() && aiInput()?.focus())
    .catch(() => {
      setAiCloseArmed(form, false)
      toast('チャットを閉じられませんでした。', 'error')
    })
})

async function runAiTask(task: () => Promise<void>) {
  if (aiSending) return
  aiSending = true
  try {
    // 問い合わせ中の取り直しを待たずに送らないのは、送っているあいだにパネルが差し替わり、流れてくる応答が画面から消えるため
    await aiSync
    await task()
  } finally {
    aiSending = false
    aiChannel.postMessage('changed')
    scheduleAiSync()
  }
}

export function initAiPanel() {
  const panel = aiPanel()
  // 画面を移るたびに合わせ直さないのは、パネルは移っても残る（data-keep）ので、応答を作っている最中の動きを最初の状態に戻してしまうため
  if (panel && !aiBuddyReady) {
    aiBuddyReady = true
    settleAiBuddy(panel)
  }
  const open = document.documentElement.hasAttribute('data-ai-open')
  $$('.ai-panel-toggle').forEach((el) => el.setAttribute('aria-expanded', String(open)))
  showAiVoice()
  void fillAiSuggestions()
  watchAiCards()
  scheduleAiSync()
}

// --- コーディング問題の編集画面から、そのアイテムを選んだ新しいチャットを始める（features/code/components/code.tsx の CodeAiHelp）
type AiFocusStart = { focus: string; title: string; href: string; message: string }

/** 新しいチャットで選ぶアイテムの欄。チャットがあるときは描かれない */
const aiFocusField = (panel: HTMLElement) => panel.querySelector<HTMLInputElement>('[data-ai-form] input[name="focus"]')

function setAiFocus(start: AiFocusStart | null) {
  const panel = aiPanel()
  const field = panel && aiFocusField(panel)
  const chip = panel?.querySelector<HTMLElement>('[data-ai-focus]')
  const title = chip?.querySelector<HTMLAnchorElement>('[data-ai-focus-title]')
  if (!field || !chip || !title) return false
  field.value = start?.focus ?? ''
  title.textContent = start?.title ?? ''
  title.href = start?.href ?? '#'
  chip.hidden = !start
  return true
}

const clearAiFocus = () => void setAiFocus(null)

const AI_UNSAVED_CONFIRM = '保存していない変更があります。AI は保存した内容を読むので、先に保存しておくと確実です。'
const AI_RESTART_CONFIRM = '今のチャットを閉じて、このコーディング問題の新しいチャットを始めます。閉じた会話は開き直せません。'

/** パネルを開き、今のチャットを閉じてから、ボタンのアイテムを選んだ新しいチャットで最初の発言を送る */
async function startAiFocus(button: HTMLElement) {
  const start = JSON.parse(button.dataset.aiFocusStart ?? 'null') as AiFocusStart | null
  if (!start || !aiPanel() || aiSending) return
  const form = button.closest('form')
  const unsaved = !!form && aiHooks.isUnsaved(form)
  await refreshAiIfOutdated()
  const chatId = aiPanel()?.dataset.chat
  const notes = [...(unsaved ? [AI_UNSAVED_CONFIRM] : []), ...(chatId ? [AI_RESTART_CONFIRM] : [])]
  if (notes.length > 0 && !(await confirmNear(button, notes, { ok: '始める', tone: 'primary' }))) return
  await runAiTask(async () => {
    if (chatId) {
      const body = new FormData()
      body.set('chat', chatId)
      const res = await fetchJson('/ai/chat/close', { method: 'POST', body }).catch(() => null)
      if (!res?.ok) return toast('チャットを閉じられませんでした。', 'error')
      await refreshAiPanel()
    }
    if (!document.documentElement.hasAttribute('data-ai-open')) setAiOpen(true)
    const input = aiInput()
    if (!input || input.disabled) return toast('今は AI を使えません。', 'error')
    if (!setAiFocus(start)) return
    // 「難しい依頼」を外すのは、Sonnet では続きの依頼のボタンが出ず、質問に答える候補を出せないため
    const composer = input.form
    composer?.querySelector('[data-ai-hard]')?.setAttribute('aria-pressed', 'false')
    if (composer) syncAiModel(composer)
    input.value = start.message
    fitAiInput(input)
    await sendAiMessage()
  })
}

// --- AI のパネルの最初の候補（features/ai/components/ai-panel.tsx の data-ai-suggestions。作るのは /ai/suggestions）
const AI_SUGGESTION_SLOTS = 3
// 画面ごとに覚えておくのは、同じ画面に戻るたびにサーバーへ問い合わせて、読み込み中の表示を挟まないため
const aiSuggestionCache = new Map<string, string[]>()
const aiSuggesting = new Set<string>()

const aiSuggestionBox = () => aiPanel()?.querySelector<HTMLElement>('[data-ai-suggestions]') ?? null

function paintAiSuggestions(box: HTMLElement, page: string, suggestions: string[]) {
  box.replaceChildren(
    ...suggestions.map((text) => {
      const button = aiTemplate('suggestion', text)
      button.dataset.aiSuggest = text
      return button
    }),
  )
  box.dataset.page = page
  box.removeAttribute('aria-busy')
}

// パネルを閉じているあいだに取りに行かないのは、開かない画面のために AI に候補を作らせることになるため
async function fillAiSuggestions() {
  const box = aiSuggestionBox()
  const page = location.pathname
  if (!box || box.dataset.page === page || !document.documentElement.hasAttribute('data-ai-open')) return
  const known = aiSuggestionCache.get(page)
  if (known) return paintAiSuggestions(box, page, known)
  if (!box.hasAttribute('aria-busy')) {
    box.replaceChildren(...Array.from({ length: AI_SUGGESTION_SLOTS }, () => aiTemplate('suggestion-loading')))
    box.setAttribute('aria-busy', 'true')
  }
  if (aiSuggesting.has(page)) return
  aiSuggesting.add(page)
  let suggestions: string[] | null = null
  try {
    const res = await fetchJson(`/ai/suggestions?${new URLSearchParams({ page })}`)
    // 開けない画面（404）を失敗として取り直さないのは、パネルを開き直すたびに、候補を見せない画面へ問い合わせ直すことになるため
    if (res.status === 404) suggestions = []
    else if (res.ok) suggestions = ((await res.json()) as { suggestions: string[] }).suggestions
  } catch {
    // 失敗を知らせないのは、候補が出ないだけで、入力欄からは頼めるため
  } finally {
    aiSuggesting.delete(page)
  }
  if (suggestions) aiSuggestionCache.set(page, suggestions)
  const current = aiSuggestionBox()
  if (!current || location.pathname !== page) return
  if (suggestions) return paintAiSuggestions(current, page, suggestions)
  // 失敗したときに data-page を付けないのは、次にパネルを開いたときに取り直すため
  current.replaceChildren()
  current.removeAttribute('aria-busy')
}

// --- AI のパネルの音声入力（features/ai/components/ai-panel.tsx の data-ai-voice。文字起こしは /ai/voice）
// 録った音声を区切って送らないのは、MediaRecorder の 2 つ目以降の断片はヘッダーがなく単独では読めず、
// 区切りで言葉が切れて起こし間違えるため。録り始めからの音声を毎回まとめて送り、返った文字で置き換える
type AiVoice = {
  state: 'recording' | 'finishing'
  recorder: MediaRecorder
  stream: MediaStream
  audio: AudioContext
  chunks: Blob[]
  /** 録り始めたときに入力欄にあった文。送るときは、この後ろに文字にした音声を続ける */
  base: string
  /** 最後に返った途中の文字起こし */
  text: string
  /** 途中の文字起こしに最後に送った時点の chunks の数 */
  sent: number
  /** 声らしい大きさの音を一度でも拾ったか */
  heard: boolean
  startedAt: number
  /** 1 回に録れる長さ（ミリ秒）と、文字にできる長さ（features/ai/components/ai-panel.tsx の data-max-seconds / data-max-chars） */
  maxMs: number
  maxChars: number
  timer: number
  limitTimer: number
  frame: number
  inflight: AbortController | null
}

let aiVoice: AiVoice | null = null
const AI_VOICE_SLICE = 250
const AI_VOICE_INTERVAL = 1200
// 短すぎる音声を送らないのは、Whisper が 1 秒に満たない音声から、話していない言葉を作ることがあるため
const AI_VOICE_MIN_MS = 1000
const AI_VOICE_HEARD_LEVEL = 0.02
// 残りがこれを切ったら時間と文字数の色を変えるのは、急に止まって送られる前に、話をまとめられるようにするため
const AI_VOICE_NEAR_MS = 10_000
const AI_VOICE_NEAR_CHARS = 0.9
// Safari は webm を録れないので mp4 を、Firefox は ogg も録れるので最後の候補に入れる
const AI_VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

const aiVoiceSupported = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
const aiVoiceButton = () => aiPanel()?.querySelector<HTMLButtonElement>('[data-ai-voice]') ?? null

function showAiVoice() {
  const button = aiVoiceButton()
  if (button) button.hidden = !aiVoiceSupported()
}

/** 入力欄の下の、録音した時間と文字数 */
function paintAiVoiceStatus(voice: AiVoice | null) {
  const panel = aiPanel()
  const time = panel?.querySelector<HTMLElement>('[data-ai-voice-time]')
  const chars = panel?.querySelector<HTMLElement>('[data-ai-voice-chars]')
  const elapsed = voice ? Date.now() - voice.startedAt : 0
  if (time) {
    time.textContent = formatClock(elapsed / 1000)
    time.toggleAttribute('data-near', !!voice && voice.maxMs - elapsed <= AI_VOICE_NEAR_MS)
  }
  if (chars) {
    chars.textContent = String(voice?.text.length ?? 0)
    chars.toggleAttribute('data-near', !!voice && voice.text.length >= voice.maxChars * AI_VOICE_NEAR_CHARS)
  }
}

function paintAiVoice(voice: AiVoice | null) {
  const box = aiPanel()?.querySelector<HTMLElement>('.ai-input')
  const button = aiVoiceButton()
  if (!box || !button) return
  paintAiVoiceStatus(voice)
  if (!voice) {
    box.removeAttribute('data-voice')
    button.setAttribute('aria-pressed', 'false')
    button.setAttribute('aria-label', '音声で入力')
    button.title = '音声で入力'
    button.disabled = false
    button.style.removeProperty('--ai-level')
    return
  }
  box.dataset.voice = voice.state
  const label = voice.state === 'finishing' ? '文字にしています' : '話し終えて送信'
  button.setAttribute('aria-pressed', 'true')
  button.setAttribute('aria-label', label)
  button.title = label
  button.disabled = voice.state === 'finishing'
  const base = box.querySelector('[data-ai-ghost-base]')
  const text = box.querySelector('[data-ai-ghost-text]')
  if (base) base.textContent = voice.base
  if (text) text.textContent = voice.text
  const ghost = box.querySelector<HTMLElement>('[data-ai-ghost]')
  if (ghost) ghost.scrollTop = ghost.scrollHeight
}

/** 音の大きさを録音ボタンの輪に出し、声らしい音を拾ったかを覚える */
function meterAiVoice(voice: AiVoice) {
  const analyser = voice.audio.createAnalyser()
  analyser.fftSize = 1024
  voice.audio.createMediaStreamSource(voice.stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const tick = () => {
    if (aiVoice !== voice || voice.state !== 'recording') return
    analyser.getFloatTimeDomainData(samples)
    const level = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)
    if (level >= AI_VOICE_HEARD_LEVEL) voice.heard = true
    aiVoiceButton()?.style.setProperty('--ai-level', String(Math.min(1, level * 8)))
    paintAiVoiceStatus(voice)
    voice.frame = requestAnimationFrame(tick)
  }
  voice.frame = requestAnimationFrame(tick)
}

async function transcribeAiVoice(voice: AiVoice, signal?: AbortSignal) {
  const data = new FormData()
  data.set('audio', new Blob(voice.chunks, { type: voice.recorder.mimeType || voice.chunks[0]?.type }), 'voice')
  const res = await fetchJson('/ai/voice', { method: 'POST', body: data, signal })
  const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null
  if (!res.ok || typeof body?.text !== 'string')
    throw new Error(typeof body?.error === 'string' ? body.error : '音声を文字にできませんでした。')
  return body.text
}

// 前の問い合わせが返る前に次を送らないのは、遅れて返った古い結果で、新しい結果を上書きしてしまうため
function scheduleAiVoice(voice: AiVoice) {
  voice.timer = window.setTimeout(async () => {
    const ready = voice.heard && voice.chunks.length > voice.sent && Date.now() - voice.startedAt >= AI_VOICE_MIN_MS
    if (ready) {
      voice.sent = voice.chunks.length
      const controller = new AbortController()
      voice.inflight = controller
      try {
        const text = await transcribeAiVoice(voice, controller.signal)
        if (aiVoice === voice && voice.state === 'recording') {
          voice.text = text
          paintAiVoice(voice)
          if (text.length >= voice.maxChars) void finishAiVoice(`音声入力は 1 回 ${voice.maxChars} 文字までのため、ここまでを送信します。`)
        }
      } catch {
        // 途中の失敗を知らせないのは、話し終えたときにまとめて送り直し、そこで失敗したときだけ伝えれば足りるため
      } finally {
        if (voice.inflight === controller) voice.inflight = null
      }
    }
    if (aiVoice === voice && voice.state === 'recording') scheduleAiVoice(voice)
  }, AI_VOICE_INTERVAL)
}

async function startAiVoice(button: HTMLButtonElement) {
  if (aiVoice || !aiVoiceSupported()) return
  const input = aiInput()
  if (!input) return
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    return toast(denied ? 'マイクの使用が許可されていません。ブラウザの設定で許可してください。' : 'マイクを使えませんでした。', 'error')
  }
  if (aiVoice) return stream.getTracks().forEach((t) => t.stop())
  const type = AI_VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  const voice: AiVoice = {
    state: 'recording',
    recorder,
    stream,
    audio: new AudioContext(),
    chunks: [],
    base: input.value.trim(),
    text: '',
    sent: 0,
    heard: false,
    startedAt: Date.now(),
    maxMs: Number(button.dataset.maxSeconds) * 1000,
    maxChars: Number(button.dataset.maxChars),
    timer: 0,
    limitTimer: 0,
    frame: 0,
    inflight: null,
  }
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) voice.chunks.push(e.data)
  })
  recorder.start(AI_VOICE_SLICE)
  aiVoice = voice
  meterAiVoice(voice)
  scheduleAiVoice(voice)
  voice.limitTimer = window.setTimeout(
    () => void finishAiVoice(`音声入力は 1 回 ${voice.maxMs / 1000} 秒までのため、ここまでを送信します。`),
    voice.maxMs,
  )
  paintAiVoice(voice)
}

/** 録音を止めてマイクを手放す。最後の断片（dataavailable）は stop の前に届く */
async function releaseAiVoice(voice: AiVoice) {
  clearTimeout(voice.timer)
  clearTimeout(voice.limitTimer)
  cancelAnimationFrame(voice.frame)
  voice.inflight?.abort()
  if (voice.recorder.state !== 'inactive') {
    const stopped = new Promise((resolve) => voice.recorder.addEventListener('stop', resolve, { once: true }))
    voice.recorder.stop()
    await stopped
  }
  voice.stream.getTracks().forEach((t) => t.stop())
  void voice.audio.close()
}

function endAiVoice(voice: AiVoice) {
  if (aiVoice !== voice) return
  aiVoice = null
  paintAiVoice(null)
  if (aiDocked()) aiInput()?.focus()
  scheduleAiSync()
}

function cancelAiVoice() {
  const voice = aiVoice
  if (!voice) return
  endAiVoice(voice)
  void releaseAiVoice(voice)
}

const joinAiVoice = (base: string, text: string) => (base && text ? `${base} ${text}` : base || text)

/**
 * 話し終えた音声をまとめて文字にし、入力欄にあった文に続けてそのまま送る。失敗したら、途中までの文字を入力欄に残す。
 * limit は、1 回の上限に届いて止めたときに知らせる文言
 */
async function finishAiVoice(limit?: string) {
  const voice = aiVoice
  if (!voice || voice.state !== 'recording') return
  if (limit) toast(limit, 'info')
  voice.state = 'finishing'
  paintAiVoice(voice)
  await releaseAiVoice(voice)
  if (aiVoice !== voice) return
  let text = ''
  let problem = ''
  try {
    text = voice.heard && voice.chunks.length > 0 ? (await transcribeAiVoice(voice)).trim() : ''
    if (!text) problem = '声を聞き取れませんでした。もう一度お試しください。'
  } catch (e) {
    problem = e instanceof Error ? e.message : '音声を文字にできませんでした。'
  }
  if (aiVoice !== voice) return
  endAiVoice(voice)
  const input = aiInput()
  if (!input) return
  input.value = joinAiVoice(voice.base, problem ? voice.text : text)
  fitAiInput(input)
  if (problem) return toast(problem, 'error')
  input.form?.requestSubmit()
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-voice-cancel]')) return cancelAiVoice()
  const button = target.closest<HTMLButtonElement>('[data-ai-voice]')
  if (!button || button.disabled) return
  if (aiVoice) return void finishAiVoice()
  void startAiVoice(button)
})
