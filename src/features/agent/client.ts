/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { agentModelFacts, isAgentClaudeModel, type AgentModel } from './agent'
import { $$ } from '../../client/dom'

// --- コーディングエージェントのモデルの選択（features/agent/components/agent.tsx の AgentModelPicker）
function agentModelOfRow(row: HTMLElement): AgentModel | null {
  const id = row.dataset.agentModel ?? ''
  if (isAgentClaudeModel(id)) return { provider: 'anthropic', id }
  const num = (v: string | undefined) => (v ? Number(v) : NaN)
  const [contextLength, prompt, completion] = [num(row.dataset.ctx), num(row.dataset.in), num(row.dataset.out)]
  if (!id || [contextLength, prompt, completion].some(Number.isNaN)) return null
  const maxOutput = row.dataset.max ? Number(row.dataset.max) : null
  return { provider: 'openrouter', id, name: row.dataset.name ?? id, contextLength, maxOutput, prompt, completion, tools: true }
}

function filterAgentModels(search: HTMLInputElement) {
  const picker = search.closest<HTMLElement>('[data-agent-models]')
  if (!picker) return
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  let shown = 0
  let group: HTMLElement | null = null
  let groupShown = 0
  const closeGroup = () => {
    if (!group) return
    group.hidden = groupShown === 0
    const count = group.querySelector('[data-agent-model-count]')
    if (count) count.textContent = `${groupShown} 件`
  }
  for (const el of $$<HTMLElement>('.agent-models-group, [data-agent-model]', picker)) {
    if (el.matches('.agent-models-group')) {
      closeGroup()
      group = el
      groupShown = 0
      continue
    }
    const hit = terms.every((t) => el.dataset.searchText?.includes(t))
    el.hidden = !hit
    if (hit) {
      shown++
      groupShown++
    }
  }
  closeGroup()
  const empty = picker.querySelector<HTMLElement>('[data-agent-model-empty]')
  if (empty) empty.hidden = shown > 0
  hideAgentModelTip(picker)
}

function showAgentModelTip(row: HTMLElement) {
  const picker = row.closest<HTMLElement>('[data-agent-models]')
  const tip = picker?.querySelector<HTMLElement>('[data-agent-model-tip]')
  const model = agentModelOfRow(row)
  if (!picker || !tip || !model) return
  const name = document.createElement('p')
  name.className = 'agent-model-tip-name'
  name.textContent = row.querySelector('.agent-model-name')?.textContent ?? model.id
  const facts = document.createElement('dl')
  for (const [term, value] of agentModelFacts(model)) {
    const dt = document.createElement('dt')
    dt.textContent = term
    const dd = document.createElement('dd')
    dd.textContent = value
    facts.append(dt, dd)
  }
  tip.replaceChildren(name, facts)
  tip.hidden = false
  // 一覧の外に置いて位置を測るのは、一覧の中に置くと、スクロールする一覧の縁で切れるため
  const box = picker.getBoundingClientRect()
  const at = row.getBoundingClientRect()
  const below = at.bottom + 6 + tip.offsetHeight <= window.innerHeight
  tip.style.top = `${(below ? at.bottom + 6 : at.top - 6 - tip.offsetHeight) - box.top}px`
  tip.classList.toggle('is-above', !below)
  row.querySelector('input')?.setAttribute('aria-describedby', tip.id)
}

function hideAgentModelTip(root: ParentNode) {
  const tip = root.querySelector<HTMLElement>('[data-agent-model-tip]')
  if (tip) tip.hidden = true
  $$('[data-agent-model] input[aria-describedby]', root).forEach((el) => el.removeAttribute('aria-describedby'))
}

document.addEventListener('input', (e) => {
  const search = (e.target as Element).closest<HTMLInputElement>('[data-agent-model-search]')
  if (search) filterAgentModels(search)
})
document.addEventListener('keydown', (e) => {
  // Enter で保存のフォームを送らないのは、検索のつもりで押しただけで、ほかの欄の書きかけごと保存されるため
  if (e.key === 'Enter' && (e.target as Element).closest?.('[data-agent-model-search]')) e.preventDefault()
})
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const row = input.closest<HTMLElement>('[data-agent-model]')
  const current = row?.closest('[data-agent-models]')?.querySelector('[data-agent-model-current]')
  if (row && current) current.textContent = row.querySelector('.agent-model-name')?.textContent ?? input.value
})
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return
  const row = (e.target as Element).closest<HTMLElement>('[data-agent-model]')
  if (row) showAgentModelTip(row)
})
document.addEventListener('pointerout', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('[data-agent-model]')
  const picker = row?.closest<HTMLElement>('[data-agent-models]')
  if (picker && !row!.contains(e.relatedTarget as Node | null)) hideAgentModelTip(picker)
})
document.addEventListener('focusin', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('[data-agent-model]')
  if (row) showAgentModelTip(row)
})
document.addEventListener('focusout', (e) => {
  const picker = (e.target as Element).closest<HTMLElement>('[data-agent-model]')?.closest<HTMLElement>('[data-agent-models]')
  if (picker) hideAgentModelTip(picker)
})
document.addEventListener(
  'scroll',
  (e) => {
    const list = e.target instanceof Element && e.target.closest<HTMLElement>('[data-agent-models]')
    if (list) hideAgentModelTip(list)
  },
  true,
)

// 行の scrollIntoView を使わないのは、一覧だけでなくページまでスクロールして、編集画面を開いた位置がずれるため
/** 選んでいるモデルが見えるように、一覧をスクロールしておく */
export function initAgentModelPickers() {
  for (const list of $$<HTMLElement>('.agent-models-list')) {
    const checked = list.querySelector<HTMLElement>('[data-agent-model]:has(input:checked)')
    if (checked && checked.offsetTop + checked.offsetHeight > list.clientHeight) list.scrollTop = checked.offsetTop - list.clientHeight / 3
  }
}
