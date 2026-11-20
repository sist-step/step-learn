/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { MAX_QUIZ_INDENT, MAX_QUIZ_STEPS, QUIZ_KEY_SLOT, lineAt, parseSteps, withIndent, type QuizKind } from '../lib/quiz'
import { toast } from './core'
import { $$ } from './dom'

// --- 小テストの問題の編集（components/quiz.tsx の QuizEditor）
// 入力の検証より前に置くのは、検証が読む questions を、送信と入力のたびに先に組み立て直すため
let qzCount = 0

const qzNamed = (row: HTMLElement, field: string) =>
  $$<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(`${row.dataset.qzKey}.${field}`)}"]`, row)

/** 問題の欄の値。ラジオボタンの組（選び方）は、選ばれているものの値 */
function qzValue(row: HTMLElement, field: string) {
  const controls = qzNamed(row, field)
  const radios = controls.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio')
  if (radios.length) return radios.find((el) => el.checked)?.value ?? ''
  return controls[0]?.value ?? ''
}

const qzItems = (row: HTMLElement, field: string) => $$<HTMLElement>(`[data-qz-items="${field}"] [data-qz-item]`, row)

const qzCells = (item: HTMLElement) => $$<HTMLInputElement | HTMLTextAreaElement>('[data-qz-cell]', item).map((cell) => cell.value)

const QZ_TEXT_FIELDS = [
  'prompt',
  'code',
  'explanation',
  'multiple',
  'space',
  'case',
  'text',
  'layout',
  'fill',
  'lines',
  'ask',
  'extras',
  'steps',
  'mode',
  'keywords',
  'sample',
]

function qzReadQuestion(row: HTMLElement) {
  const choices = qzItems(row, 'choices')
  return {
    k: row.dataset.qzKey,
    kind: row.dataset.qzQuestion,
    ...Object.fromEntries(QZ_TEXT_FIELDS.map((field) => [field, qzValue(row, field)])),
    choices: choices.map((item) => qzCells(item)[0] ?? ''),
    correct: choices.map((item) => !!item.querySelector<HTMLInputElement>('[data-qz-item-check]')?.checked),
    answers: qzItems(row, 'answers').map((item) => qzCells(item)[0] ?? ''),
    pairs: qzItems(row, 'pairs').map((item) => {
      const [left = '', right = ''] = qzCells(item)
      return [left, right]
    }),
  }
}

function qzSync(editor: HTMLElement) {
  const value = editor.querySelector<HTMLInputElement>('[data-qz-value]')
  if (value) value.value = JSON.stringify($$<HTMLElement>('[data-qz-question]', editor).map(qzReadQuestion))
}

/** 選び方に合わせて、その選び方のときだけ出す欄と説明を出し分ける */
function qzWhen(row: HTMLElement) {
  for (const el of $$<HTMLElement>('[data-qz-when]', row)) {
    const [field, value] = (el.dataset.qzWhen ?? '').split('=')
    el.hidden = qzValue(row, field) !== value
  }
  const text = row.querySelector<HTMLTextAreaElement>('[data-qz-blank-text]')
  const placeholder = text?.getAttribute(`data-placeholder-${qzValue(row, 'layout')}`)
  if (text && placeholder) text.placeholder = placeholder
}

const qzLineNote = (line: string | null) => (line === null ? '' : line.trim() || '（空の行）')

/** 行を選ぶ問題で、入力した行の番号の下に、その行の中身を出す */
function qzShowLines(row: HTMLElement) {
  const code = qzValue(row, 'code')
  row.querySelector<HTMLElement>('[data-qz-flow-steps]')?.replaceChildren(
    ...(parseSteps(qzValue(row, 'steps')) ?? []).map((n) => {
      const item = document.createElement('li')
      const no = Object.assign(document.createElement('span'), { className: 'qz-flow-no', textContent: String(n) })
      const line = Object.assign(document.createElement('code'), {
        className: 'truncate',
        textContent: qzLineNote(lineAt(code, n)) || '（行がありません）',
      })
      item.append(no, line)
      return item
    }),
  )
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const editor = target.closest<HTMLElement>('[data-qz]')
  if (!editor) return
  const row = target.closest<HTMLElement>('[data-qz-question]')
  const add = target.closest<HTMLElement>('[data-qz-add]')
  const move = target.closest<HTMLElement>('[data-qz-move]')
  const items = target.closest<HTMLElement>('[data-qz-items]')
  const itemRemove = target.closest<HTMLElement>('[data-qz-item-remove]')
  if (add) {
    const template = editor.querySelector<HTMLTemplateElement>(`template[data-qz-template="${add.dataset.qzAdd}"]`)
    const list = editor.querySelector<HTMLElement>('[data-qz-list]')
    if (!template || !list) return
    list.insertAdjacentHTML('beforeend', template.innerHTML.replaceAll(QUIZ_KEY_SLOT, `q${Date.now().toString(36)}${qzCount++}`))
    const added = list.lastElementChild as HTMLElement
    added.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const first = added.querySelector<HTMLTextAreaElement>('textarea')
    first?.focus({ preventScroll: true })
    first?.select()
  } else if (row && target.closest('[data-qz-remove]')) {
    const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null
    row.remove()
    ;(next?.querySelector<HTMLElement>('textarea') ?? editor.querySelector<HTMLElement>('[data-qz-add]'))?.focus()
  } else if (row && move) {
    const up = move.dataset.qzMove === 'up'
    const other = up ? row.previousElementSibling : row.nextElementSibling
    if (!other) return
    other[up ? 'before' : 'after'](row)
    // 端まで動かすとボタンが隠れるので、反対向きのボタンへ移して、キーボードで続けて動かせるようにする
    const again = row.querySelector<HTMLElement>(`[data-qz-move="${move.dataset.qzMove}"]`)
    const back = row.querySelector<HTMLElement>(`[data-qz-move="${up ? 'down' : 'up'}"]`)
    ;((up ? row.previousElementSibling : row.nextElementSibling) ? again : back)?.focus()
  } else if (items && target.closest('[data-qz-item-add]')) {
    const template = items.querySelector<HTMLTemplateElement>('[data-qz-item-template]')
    const list = items.querySelector<HTMLElement>('[data-qz-item-list]')
    if (!template || !list) return
    list.insertAdjacentHTML('beforeend', template.innerHTML)
    list.lastElementChild?.querySelector<HTMLElement>('[data-qz-cell]')?.focus()
  } else if (items && itemRemove) {
    const item = itemRemove.closest<HTMLElement>('[data-qz-item]')
    const next = (item?.nextElementSibling ?? item?.previousElementSibling) as HTMLElement | null
    item?.remove()
    ;(next?.querySelector<HTMLElement>('[data-qz-cell]') ?? items.querySelector<HTMLElement>('[data-qz-item-add]'))?.focus()
  } else return
  qzSync(editor)
})

const qzOnEdit = (e: Event) => {
  const target = e.target as Element
  const editor = target.closest<HTMLElement>('[data-qz]')
  if (!editor) return
  const row = target.closest<HTMLElement>('[data-qz-question]')
  if (row && target.matches('[data-qz-code], [data-qz-steps]')) qzShowLines(row)
  if (row && target.matches('input[type="radio"]')) qzWhen(row)
  // 1 つ選ぶ選択の問題では、正解の印を 1 つだけにする（ラジオボタンにしないのは、複数選ぶに切り替えたときに印を残すため）
  if (row && target.matches('[data-qz-item-check]:checked') && qzValue(row, 'multiple') === '0')
    for (const other of $$<HTMLInputElement>('[data-qz-items="choices"] [data-qz-item-check]', row))
      if (other !== target) other.checked = false
  qzSync(editor)
}
document.addEventListener('input', qzOnEdit, true)
document.addEventListener('change', qzOnEdit, true)

document.addEventListener('submit', (e) => $$<HTMLElement>('[data-qz]', e.target as HTMLFormElement).forEach(qzSync), true)

// --- 小テストを受ける（components/quiz.tsx の QuizPanel）
function quizMoveLine(line: HTMLElement, before: Element | null) {
  if (before === line || line.nextElementSibling === before) return false
  line.parentElement!.insertBefore(line, before)
  return true
}

document.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('[data-quiz-line-move]')
  const line = button?.closest<HTMLElement>('[data-quiz-line]')
  if (!button || !line) return
  const up = button.dataset.quizLineMove === 'up'
  const other = up ? line.previousElementSibling : line.nextElementSibling
  if (!other) return
  quizMoveLine(line, up ? other : other.nextElementSibling)
  const again = line.querySelector<HTMLElement>(`[data-quiz-line-move="${button.dataset.quizLineMove}"]`)
  const back = line.querySelector<HTMLElement>(`[data-quiz-line-move="${up ? 'down' : 'up'}"]`)
  ;((up ? line.previousElementSibling : line.nextElementSibling) ? again : back)?.focus()
})

// HTML のドラッグ＆ドロップ（draggable）を使わないのは、タッチ端末で動かせないため
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Element
  const line = target.closest<HTMLElement>('[data-quiz-line]')
  if (!line || e.button !== 0 || target.closest('button') || line.closest('.quiz-order.is-fixed')) return
  // タッチでは、つまみ以外をなぞったときにページをスクロールできるように残す
  if (e.pointerType !== 'mouse' && !target.closest('[data-quiz-grip]')) return
  const list = line.parentElement!
  e.preventDefault()
  line.classList.add('is-dragging')
  const onMove = (move: PointerEvent) => {
    const others = $$<HTMLElement>('[data-quiz-line]', list).filter((el) => el !== line)
    const next = others.find((el) => {
      const box = el.getBoundingClientRect()
      return move.clientY < box.top + box.height / 2
    })
    quizMoveLine(line, next ?? null)
  }
  const onEnd = () => {
    line.classList.remove('is-dragging')
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onEnd)
    document.removeEventListener('pointercancel', onEnd)
  }
  // 行に setPointerCapture しないのは、並べ替えで行を DOM の中で動かすと、キャプチャが外れて続きの動きが届かなくなるため
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onEnd)
  document.addEventListener('pointercancel', onEnd)
})

// --- 小テストの「実行の順番」: 行を押すたびに、その行の番号を順番の最後に足す
const quizFlowSteps = (flow: HTMLElement) => parseSteps(flow.querySelector<HTMLInputElement>('[data-quiz-flow-value]')?.value ?? '') ?? []

function quizSetFlow(flow: HTMLElement, steps: number[]) {
  const value = flow.querySelector<HTMLInputElement>('[data-quiz-flow-value]')
  if (!value) return
  value.value = steps.join(',')
  for (const line of $$<HTMLElement>('[data-quiz-flow-line]', flow)) {
    const no = Number(line.dataset.quizFlowLine)
    const badges = steps.flatMap((n, i) => (n === no ? [i + 1] : []))
    line
      .querySelector('[data-quiz-flow-badges]')
      ?.replaceChildren(
        ...badges.map((at) => Object.assign(document.createElement('span'), { className: 'quiz-flow-badge', textContent: String(at) })),
      )
  }
  flow
    .querySelector('[data-quiz-flow-steps]')
    ?.replaceChildren(...steps.map((n) => Object.assign(document.createElement('li'), { className: 'quiz-step', textContent: String(n) })))
  for (const button of $$<HTMLButtonElement>('[data-quiz-flow-undo], [data-quiz-flow-clear]', flow)) button.disabled = steps.length === 0
  flow.closest('[data-quiz-q]')?.classList.remove('is-missing')
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const flow = target.closest<HTMLElement>('[data-quiz-flow]')
  if (!flow) return
  const steps = quizFlowSteps(flow)
  const line = target.closest<HTMLElement>('[data-quiz-flow-line]')
  if (line) {
    if (steps.length >= MAX_QUIZ_STEPS) return toast(`選べるのは ${MAX_QUIZ_STEPS} 行までです。`, 'error')
    quizSetFlow(flow, [...steps, Number(line.dataset.quizFlowLine)])
  } else if (target.closest('[data-quiz-flow-undo]')) quizSetFlow(flow, steps.slice(0, -1))
  else if (target.closest('[data-quiz-flow-clear]')) quizSetFlow(flow, [])
  else return
  // 空に戻すとボタンが押せなくなってフォーカスを失うので、行へ移して、キーボードで続けて選べるようにする
  if (!line && quizFlowSteps(flow).length === 0) flow.querySelector<HTMLElement>('[data-quiz-flow-line]')?.focus()
})

// --- 小テストの並べ替えの字下げと「使わない」: 行ごとのボタンで、字下げを深く・浅くし、使う・使わないを切り替える
document.addEventListener('click', (e) => {
  const target = e.target as Element
  const line = target.closest<HTMLElement>('[data-quiz-line]')
  const value = line?.querySelector<HTMLInputElement>('[data-quiz-line-value]')
  if (!line || !value) return
  const indent = target.closest<HTMLButtonElement>('[data-quiz-indent-move]')
  const use = target.closest<HTMLButtonElement>('[data-quiz-line-use]')
  if (indent) {
    const level = Math.min(MAX_QUIZ_INDENT, Math.max(0, Number(line.dataset.level ?? 0) + Number(indent.dataset.quizIndentMove)))
    line.dataset.level = String(level)
    line.style.setProperty('--level', String(level))
    value.value = withIndent(line.dataset.line ?? '', level)
    const [shallower, deeper] = [-1, 1].map((d) => line.querySelector<HTMLButtonElement>(`[data-quiz-indent-move="${d}"]`)!)
    shallower.disabled = level === 0
    deeper.disabled = level === MAX_QUIZ_INDENT
    // 端まで動かすとボタンが押せなくなってフォーカスを失うので、反対向きのボタンへ移す
    if (indent.disabled) (indent === shallower ? deeper : shallower).focus()
  } else if (use) {
    const unused = !line.hasAttribute('data-unused')
    line.toggleAttribute('data-unused', unused)
    value.disabled = unused
    use.setAttribute('aria-pressed', String(unused))
    use.textContent = unused ? '使う' : '使わない'
  }
})

const quizAnswered = (question: HTMLElement): boolean => {
  const filled = (selector: string) => {
    const fields = $$<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector, question)
    return fields.length > 0 && fields.every((field) => !!field.value.trim())
  }
  switch (question.dataset.quizQ as QuizKind) {
    case 'order':
      return $$<HTMLInputElement>('[data-quiz-line-value]', question).some((input) => !input.disabled)
    case 'short':
    case 'essay':
      return filled('[data-quiz-text]')
    case 'blank':
      return filled('[data-quiz-blank]')
    case 'match':
      return filled('[data-quiz-match]')
    case 'choice':
    case 'lines': {
      const flow = question.querySelector<HTMLInputElement>('[data-quiz-flow-value]')
      return flow ? !!flow.value : !!question.querySelector('input:is([type="radio"], [type="checkbox"]):checked')
    }
  }
}

document.addEventListener(
  'submit',
  (e) => {
    const form = e.target as HTMLFormElement
    if (!form.matches('[data-quiz-form]')) return
    const questions = $$<HTMLElement>('[data-quiz-q]', form)
    const game = form.matches('[data-quiz-game]')
    // ゲームの見た目では、一度も開いていないステージも止める。並べ替えと字下げは最初から答えが入っていて、見ないまま採点へ進めてしまうため
    const missing = questions.filter((q) => !quizAnswered(q) || (game && !q.hasAttribute('data-done')))
    questions.forEach((q) => q.classList.toggle('is-missing', missing.includes(q)))
    if (missing.length === 0) return
    // 送信の処理（再読み込みなしの遷移）より先に止めるため、捕捉の段階で伝わるのを止める
    e.preventDefault()
    e.stopImmediatePropagation()
    toast(`まだ答えていない問題が ${missing.length} 問あります。`, 'error')
    if (game) {
      $$<HTMLElement>('[data-qg-to]', form).forEach((node, i) => node.classList.toggle('is-missing', missing.includes(questions[i])))
      qgShow(form, questions.indexOf(missing[0]))
    }
    missing[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    missing[0].querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button')?.focus({ preventScroll: true })
  },
  true,
)

document.addEventListener('input', (e) => (e.target as Element).closest('[data-quiz-q].is-missing')?.classList.remove('is-missing'))

// --- 小テストのゲームの見た目（components/quiz.tsx の GameTake）: 1 問ずつのステージを、道のりと下のボタンで行き来する
function qgShow(game: HTMLElement, to: number) {
  const stages = $$<HTMLElement>('[data-qg-stage]', game)
  const at = Math.min(stages.length - 1, Math.max(0, to))
  const from = stages.findIndex((stage) => !stage.hidden)
  if (at === from) return
  // 並べ替えと字下げは触らなくても答えが入っているので、見てから離れたときにも「答えた」にする
  if (stages[from]) qgSettle(stages[from])
  game.dataset.qgDir = at < from ? '-1' : '1'
  stages.forEach((stage, i) => (stage.hidden = i !== at))
  const nodes = $$<HTMLElement>('[data-qg-to]', game)
  nodes.forEach((node, i) => (i === at ? node.setAttribute('aria-current', 'step') : node.removeAttribute('aria-current')))
  const track = nodes[at]?.closest<HTMLElement>('.qg-track')
  // scrollIntoView を使わないのは、道のりが画面の外にあるときに、ページまで縦に動いてしまうため
  if (track) track.scrollTo({ left: nodes[at].offsetLeft - (track.clientWidth - nodes[at].offsetWidth) / 2, behavior: 'smooth' })
  const [prev, next] = ['-1', '1'].map((d) => game.querySelector<HTMLButtonElement>(`[data-qg-go="${d}"]`))
  const submit = game.querySelector<HTMLButtonElement>('[data-qg-submit]')
  const goal = stages[at].hasAttribute('data-qg-goal')
  const focused = document.activeElement
  if (prev) prev.disabled = at === 0
  if (next) next.hidden = goal
  const now = game.querySelector('[data-qg-now]')
  if (now) now.textContent = goal ? 'ゴール' : String(at + 1)
  const of = game.querySelector<HTMLElement>('[data-qg-of]')
  if (of) of.hidden = goal
  // 押したボタンが消えたり押せなくなったりするとフォーカスを失うので、同じ向きに進める次のボタンへ移す
  if (focused === next && goal) (submit ?? prev)?.focus()
  else if (focused === prev && at === 0) next?.focus()
  if (game.getBoundingClientRect().top < 0) game.closest('.quiz-game')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const game = target.closest<HTMLElement>('[data-quiz-game]')
  if (!game) return
  const go = target.closest<HTMLElement>('[data-qg-go]')
  const to = target.closest<HTMLElement>('[data-qg-to]')
  const stages = $$<HTMLElement>('[data-qg-stage]', game)
  const at = stages.findIndex((stage) => !stage.hidden)
  if (go) qgShow(game, at + Number(go.dataset.qgGo))
  else if (to) qgShow(game, Number(to.dataset.qgTo))
  else if (target.closest('[data-qg-answer]') && stages[at]) void qgCheck(game, stages[at])
  else if (target.closest('[data-qg-explain-close]')) qgExplain(game, null)
})

/** ステージの答えの欄の、送る値（フォームの外のプレビューでも集められるように、FormData を使わずに読む） */
const qgEntries = (stage: HTMLElement) =>
  $$<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[name], textarea[name], select[name]', stage)
    .filter((el) => !el.disabled && el.name.startsWith('a.') && !(/^(radio|checkbox)$/.test(el.type) && !(el as HTMLInputElement).checked))
    .map((el): [string, string] => [el.name, el.value])

/**
 * 3D のゲームの「こたえる」（扉のレバー）: サーバーで答えを確かめ、正解ならステージに扉を開ける印（data-qg-passed）を付ける（src/quiz-world.ts が見て扉を開く）。
 * 最初に確かめた答えはサーバーが覚え、ゴールの採点に使う（routes/quiz/handlers.tsx の check）。まちがえたあとに正解したら、解説を出す
 */
async function qgCheck(game: HTMLElement, stage: HTMLElement) {
  qgSettle(stage)
  if (!stage.hasAttribute('data-done')) {
    stage.classList.add('is-missing')
    toast('まだ答えが入っていないよ。答えてから「こたえる！」を押してね。', 'error')
    return
  }
  const url = game.dataset.qgCheck
  const id = stage.dataset.quizId
  if (!url || !id || stage.hasAttribute('data-qg-passed') || stage.hasAttribute('data-qg-checking')) return
  const entries = qgEntries(stage)
  const body = new FormData()
  body.set('q', id)
  for (const [name, value] of entries) body.append(name, value)
  stage.setAttribute('data-qg-checking', '')
  let result: { correct: boolean; explanation?: string }
  try {
    const res = await fetch(url, { method: 'POST', body, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(String(res.status))
    result = (await res.json()) as typeof result
  } catch {
    toast('答えを確かめられませんでした。通信を確かめて、もう一度ためしてね。', 'error')
    return
  } finally {
    stage.removeAttribute('data-qg-checking')
  }
  if (result.correct) {
    stage.setAttribute('data-qg-passed', '')
    if (stage.hasAttribute('data-qg-missed') && result.explanation) qgExplain(game, result.explanation)
    return
  }
  stage.setAttribute('data-qg-missed', '')
  // 3D のゲームは、扉の前で動物とレバーの動きで知らせる（preventDefault する）。ノートだけで答えているときはトーストで知らせる
  if (stage.dispatchEvent(new CustomEvent('qg:wrong', { bubbles: true, cancelable: true })))
    toast('ざんねん、ちがうみたい。もう一度考えてみよう。', 'error')
}

/** 解説を開く（text が null なら閉じる）。開いている間は src/quiz-world.ts がマウスを放す */
function qgExplain(game: HTMLElement, text: string | null) {
  const box = game.querySelector<HTMLElement>('[data-qg-explain]')
  if (!box) return
  const label = box.querySelector('[data-qg-explain-text]')
  if (label && text !== null) label.textContent = text
  box.hidden = text === null
  game.toggleAttribute('data-qg-explaining', text !== null)
  if (text !== null) box.querySelector<HTMLElement>('[data-qg-explain-close]')?.focus()
}

/** ステージに答えが入っていれば「答えた」にして、道のりに星を付け、答えたステージの数を出し直す */
function qgSettle(stage: HTMLElement) {
  const game = stage.closest<HTMLElement>('[data-quiz-game]')
  if (!game || !stage.dataset.quizQ) return
  const done = quizAnswered(stage)
  stage.toggleAttribute('data-done', done)
  const node = game.querySelector<HTMLElement>(`[data-qg-to="${$$<HTMLElement>('[data-qg-stage]', game).indexOf(stage)}"]`)
  node?.toggleAttribute('data-done', done)
  if (done) node?.classList.remove('is-missing')
  const count = String($$('[data-qg-stage][data-done]', game).length)
  for (const el of $$('[data-qg-done]', game)) el.textContent = count
}

function qgMark(e: Event) {
  const target = e.target as Element
  const stage = target.closest<HTMLElement>('[data-qg-stage]')
  // 並べ替えと字下げは最初から答えが入っているので、問題文を押しただけでは「答えた」にしない
  if (stage && (e.type !== 'click' || target.closest('button, label, input, [data-quiz-line]'))) qgSettle(stage)
}
document.addEventListener('click', qgMark)
document.addEventListener('input', qgMark)

document.addEventListener('keydown', (e) => {
  const game = (e.target as Element).closest<HTMLElement>('[data-qg-explaining]')
  if (e.key === 'Escape' && game) qgExplain(game, null)
})

// Enter で送信させないのは、途中のステージの表を埋めている最中に、採点へ進んでしまうため
document.addEventListener('keydown', (e) => {
  const cell = e.target as Element
  if (e.key !== 'Enter' || e.isComposing || !cell.matches('[data-quiz-game] input:is([data-quiz-blank], [data-quiz-text])')) return
  e.preventDefault()
  const cells = $$<HTMLInputElement>('input[data-quiz-blank]', cell.closest<HTMLElement>('[data-qg-stage]')!)
  cells[cells.indexOf(cell as HTMLInputElement) + 1]?.focus()
})
