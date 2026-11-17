/// <reference lib="dom" />
// 共同編集のエディター（components/collab.tsx の CollabWorkspace）。client.ts が data-collab のある画面でだけ読み込む
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { exportFileName, isCollabKind, presenceColor, type CollabKind } from '../lib/collab'
import { CollabProvider, type ConnectionState } from './provider'

export type Toast = (message: string, type?: 'success' | 'error' | 'info') => void

export type ConfirmNear = (
  anchor: HTMLElement,
  messages: readonly string[],
  options: { ok: string; tone: 'danger' | 'primary' },
) => Promise<boolean>

export type Presence = { id: number; name: string; color: string }

export type ImageSize = { width: number; height: number }

export type EditorContext = {
  root: HTMLElement
  stage: HTMLElement
  doc: Y.Doc
  awareness: Awareness
  user: Presence
  toast: Toast
  confirmNear: ConfirmNear
  /** 画像をサーバーに置き、開ける URL を返す。置けなければトーストを出して null */
  uploadImage: (file: Blob) => Promise<string | null>
  /** ツールバーの押した状態（aria-pressed）を合わせる。value があれば data-cmd-value も一致するものだけ */
  setPressed: (cmd: string, on: boolean, value?: string) => void
  /** ツールバーの選択欄・色の欄の値を合わせる */
  setValue: (cmd: string, value: string) => void
}

export type CollabEditor = {
  command: (cmd: string, value: string | undefined, el: HTMLElement) => void
  undo: () => void
  redo: () => void
  insertImage?: (url: string, size: ImageSize) => void
  exportFile?: () => Promise<Blob>
  importFile?: (file: File) => Promise<void>
  destroy: () => void
}

type Mounted = { provider: CollabProvider; editor: CollabEditor | null; destroyed: boolean; cleanup: (() => void)[] }

const mounted = new Map<HTMLElement, Mounted>()

const STATE_LABELS: Record<ConnectionState, string> = {
  connecting: '接続しています…',
  synced: '同期しています',
  offline: '接続が切れました。つなぎ直しています…',
  revoked: 'このファイルを開けなくなりました',
  too_large: 'ファイルが大きすぎて保存できません',
}

const loaders: Record<CollabKind, () => Promise<{ mount: (ctx: EditorContext) => Promise<CollabEditor> | CollabEditor }>> = {
  doc: () => import('./doc'),
  sheet: () => import('./sheet'),
  slides: () => import('./slides'),
  board: () => import('./board'),
}

/** 画像の縦横の大きさ。読めなければ 4:3 とみなす */
export function imageSize(url: string): Promise<ImageSize> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 })
    img.onerror = () => resolve({ width: 400, height: 300 })
    img.src = url
  })
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const initials = (name: string) => [...name.trim()].slice(0, 1).join('') || '?'

const MAX_PEOPLE = 6

function renderPeople(host: HTMLElement, awareness: Awareness, selfId: number) {
  const seen = new Map<number, Presence>()
  for (const state of awareness.getStates().values()) {
    const user = (state as { user?: Presence }).user
    if (user && typeof user.id === 'number' && !seen.has(user.id)) seen.set(user.id, user)
  }
  const people = [...seen.values()].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name, 'ja')))
  const label = (p: Presence) => (p.id === selfId ? `${p.name} さん（あなた）` : `${p.name} さん`)
  const person = (key: string, text: string, tip: string) => {
    const el = document.createElement('span')
    el.className = key === 'more' ? 'collab-person is-more' : 'collab-person'
    el.dataset.personKey = key
    el.dataset.personTip = tip
    el.textContent = text
    return el
  }
  host.replaceChildren(
    ...people.slice(0, MAX_PEOPLE).map((p) => {
      const el = person(String(p.id), initials(p.name), label(p))
      el.style.setProperty('--person', p.color)
      return el
    }),
    ...(people.length > MAX_PEOPLE
      ? [person('more', `+${people.length - MAX_PEOPLE}`, people.slice(MAX_PEOPLE).map(label).join('、'))]
      : []),
  )
  host.setAttribute('aria-label', `開いている人 ${people.length} 人: ${people.map((p) => p.name).join('、')}`)
}

// title にしないのは、ブラウザのツールチップは出るまでが遅く、場所も選べないため
function bindPersonTip(host: HTMLElement, tip: HTMLElement) {
  let activeKey: string | null = null
  const place = () => {
    const el = activeKey ? host.querySelector<HTMLElement>(`[data-person-key="${activeKey}"]`) : null
    if (!el) {
      activeKey = null
      tip.hidden = true
      return
    }
    tip.textContent = el.dataset.personTip ?? ''
    tip.hidden = false
    const rect = el.getBoundingClientRect()
    const width = tip.offsetWidth
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), window.innerWidth - width - 8)
    tip.style.left = `${left}px`
    tip.style.top = `${rect.bottom + 6}px`
  }
  host.addEventListener('pointermove', (e) => {
    const key = (e.target as Element).closest<HTMLElement>('.collab-person')?.dataset.personKey ?? null
    if (key === activeKey) return
    activeKey = key
    place()
  })
  host.addEventListener('pointerleave', () => {
    activeKey = null
    place()
  })
  return place
}

export async function mountCollab(root: HTMLElement, toast: Toast, confirmNear: ConfirmNear) {
  if (mounted.has(root)) return
  const kind = root.dataset.collab
  if (!isCollabKind(kind)) return
  root.dataset.collabReady = ''
  const userId = Number(root.dataset.userId)
  const user: Presence = { id: userId, name: root.dataset.userName ?? '', color: presenceColor(userId) }
  const doc = new Y.Doc()
  const provider = new CollabProvider(doc, {
    courseId: Number(root.dataset.course),
    itemId: Number(root.dataset.item),
    owner: root.dataset.owner ?? '',
  })
  const entry: Mounted = { provider, editor: null, destroyed: false, cleanup: [] }
  mounted.set(root, entry)
  provider.awareness.setLocalStateField('user', user)

  const status = root.querySelector<HTMLElement>('[data-collab-status]')
  provider.onState((state) => {
    root.dataset.state = state
    if (status) status.textContent = STATE_LABELS[state]
    if (state === 'revoked') toast('このファイルを開けなくなりました。画面を読み込み直してください。', 'error')
    if (state === 'too_large') toast('ファイルが大きすぎて、変更を保存できませんでした。画像や内容を減らしてください。', 'error')
  })
  const people = root.querySelector<HTMLElement>('[data-collab-people]')
  const personTip = root.querySelector<HTMLElement>('[data-collab-person-tip]')
  if (people) {
    const placeTip = personTip ? bindPersonTip(people, personTip) : () => {}
    const render = () => {
      renderPeople(people, provider.awareness, userId)
      placeTip()
    }
    provider.awareness.on('change', render)
    render()
  }

  const imageBase = root.dataset.imageBase ?? ''
  async function uploadImage(file: Blob) {
    const body = new FormData()
    body.append('file', file, file instanceof File ? file.name : 'image')
    try {
      const res = await fetch(imageBase, { method: 'POST', body, headers: { Accept: 'application/json' } })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (res.ok && data.url) return data.url
      toast(data.error ?? '画像を置けませんでした。', 'error')
    } catch {
      toast('画像を置けませんでした。', 'error')
    }
    return null
  }

  const tools = (cmd: string, value?: string) =>
    [...root.querySelectorAll<HTMLElement>(`[data-cmd="${cmd}"]`)].filter((el) => value === undefined || el.dataset.cmdValue === value)
  const ctx: EditorContext = {
    root,
    stage: root.querySelector<HTMLElement>('[data-collab-stage]')!,
    doc,
    awareness: provider.awareness,
    user,
    toast,
    confirmNear,
    uploadImage,
    setPressed(cmd, on, value) {
      for (const el of tools(cmd, value)) el.setAttribute('aria-pressed', on ? 'true' : 'false')
    },
    setValue(cmd, value) {
      for (const el of tools(cmd)) {
        if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement) || el === document.activeElement) continue
        el.value = value
        el.closest<HTMLElement>('.collab-color')?.style.setProperty('--picked', value)
      }
    },
  }

  await provider.synced
  if (entry.destroyed) return
  let editor: CollabEditor
  try {
    editor = await (await loaders[kind]()).mount(ctx)
  } catch (err) {
    console.error(err)
    toast('エディターを読み込めませんでした。', 'error')
    return
  }
  if (entry.destroyed) return editor.destroy()
  entry.editor = editor
  root.querySelector('.collab-loading')?.remove()

  const importInput = root.querySelector<HTMLInputElement>('[data-collab-import-file]')
  const imageInput = root.querySelector<HTMLInputElement>('[data-collab-image-file]')
  let importAnchor: HTMLElement = root

  const run = async (cmd: string, value: string | undefined, el: HTMLElement) => {
    if (cmd === 'undo') return editor.undo()
    if (cmd === 'redo') return editor.redo()
    if (cmd === 'image') return imageInput?.click()
    if (cmd === 'import') {
      importAnchor = el.closest('details')?.querySelector('summary') ?? el
      return importInput?.click()
    }
    if (cmd === 'export' && editor.exportFile) {
      try {
        download(await editor.exportFile(), exportFileName(root.dataset.title ?? '', kind))
      } catch (err) {
        console.error(err)
        toast('ファイルを作れませんでした。', 'error')
      }
      return
    }
    editor.command(cmd, value, el)
  }

  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-cmd]')
    if (!el || !root.contains(el) || el instanceof HTMLSelectElement || el instanceof HTMLInputElement) return
    e.preventDefault()
    el.closest('details')?.removeAttribute('open')
    void run(el.dataset.cmd!, el.dataset.cmdValue, el)
  }
  const onChange = (e: Event) => {
    const el = e.target
    if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement) || !el.dataset.cmd || el.type === 'file') return
    el.closest<HTMLElement>('.collab-color')?.style.setProperty('--picked', el.value)
    void run(el.dataset.cmd, el.value, el)
  }
  // ボタンにフォーカスを移させないのは、移ると文書やセルの選択がはずれ、押した操作がどこにも効かなくなるため
  const keepFocus = (e: MouseEvent) => {
    const el = (e.target as Element).closest('button, summary')
    if (el && el.closest('.collab-bar, .board-palette, .board-colors, .board-zoom')) e.preventDefault()
  }
  root.addEventListener('mousedown', keepFocus)
  root.addEventListener('click', onClick)
  root.addEventListener('change', onChange)
  entry.cleanup.push(() => {
    root.removeEventListener('mousedown', keepFocus)
    root.removeEventListener('click', onClick)
    root.removeEventListener('change', onChange)
  })

  imageInput?.addEventListener('change', async () => {
    const file = imageInput.files?.[0]
    imageInput.value = ''
    if (!file || !editor.insertImage) return
    const url = await uploadImage(file)
    if (url) editor.insertImage(url, await imageSize(url))
  })
  importInput?.addEventListener('change', async () => {
    const file = importInput.files?.[0]
    importInput.value = ''
    if (!file || !editor.importFile) return
    const ok = await confirmNear(
      importAnchor,
      [`「${file.name}」の中身で、いまの中身を置き換えます。`, '開いているほかの人の画面も置き換わります。'],
      {
        ok: '置き換える',
        tone: 'danger',
      },
    )
    if (!ok) return
    root.dataset.busy = ''
    try {
      await editor.importFile(file)
      toast(`「${file.name}」を読み込みました。`)
    } catch (err) {
      console.error(err)
      toast('ファイルを読み込めませんでした。形式が正しいか確かめてください。', 'error')
    } finally {
      delete root.dataset.busy
    }
  })
}

/** body を差し替えて画面から外れたエディターの接続を閉じる */
export function releaseDetachedCollabs() {
  for (const [root, entry] of mounted) {
    if (root.isConnected) continue
    entry.destroyed = true
    entry.editor?.destroy()
    for (const fn of entry.cleanup) fn()
    entry.provider.destroy()
    entry.provider.doc.destroy()
    mounted.delete(root)
  }
}
