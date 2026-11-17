/// <reference lib="dom" />
import * as Y from 'yjs'
import type { CollabEditor, EditorContext } from './app'
import { isShapeKind, type ElMap } from './shapes'
import { Stage, styleCommand, syncStyleTools, type Tool } from './stage'

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', n: 'note', t: 'text', l: 'line', a: 'arrow', p: 'pen' }

export function mount(ctx: EditorContext): CollabEditor {
  const ORIGIN = 'board-local'
  const elements = ctx.doc.getMap<ElMap>('board')
  const undo = new Y.UndoManager(elements, { trackedOrigins: new Set([ORIGIN]), captureTimeout: 400 })
  const host = document.createElement('div')
  ctx.stage.replaceChildren(host)
  const zoomLabel = ctx.root.querySelector<HTMLElement>('[data-board-zoom]')
  let noteColor = '#fef08a'

  const stage = new Stage(
    {
      ctx,
      host,
      mode: 'board',
      origin: ORIGIN,
      fontSize: 20,
      scope: () => 'board',
      noteColor: () => noteColor,
      onSelect: () => syncStyleTools(stage, ctx),
      onToolDone: () => setTool('select'),
      onView: (z) => {
        if (zoomLabel) zoomLabel.textContent = `${Math.round(z * 100)}%`
      },
      undo,
    },
    elements,
  )

  function setTool(tool: Tool) {
    stage.setTool(tool)
    ctx.root.dataset.tool = tool.startsWith('shape:') ? 'shape' : tool
    for (const el of ctx.root.querySelectorAll<HTMLElement>('[data-cmd="tool"]'))
      el.setAttribute('aria-pressed', el.dataset.cmdValue === tool ? 'true' : 'false')
    for (const el of ctx.root.querySelectorAll<HTMLElement>('.board-palette .collab-menu summary'))
      el.setAttribute('aria-pressed', tool.startsWith('shape:') ? 'true' : 'false')
  }

  const onKey = (e: KeyboardEvent) => {
    if (stage.isEditing || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || stage.selection.length) return
    const tool = TOOL_KEYS[e.key.toLowerCase()]
    if (tool) {
      e.preventDefault()
      setTool(tool)
    }
  }
  host.addEventListener('keydown', onKey)

  const onUndoKey = (e: KeyboardEvent) => {
    if (stage.isEditing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
    e.preventDefault()
    if (e.shiftKey) undo.redo()
    else undo.undo()
  }
  host.addEventListener('keydown', onUndoKey)

  setTool('select')
  stage.fit()

  return {
    command(cmd, value) {
      if (cmd === 'tool' && value) return setTool(value as Tool)
      if (cmd === 'shapeTool' && isShapeKind(value)) return setTool(`shape:${value}`)
      if (cmd === 'noteColor' && value) {
        noteColor = value
        for (const el of ctx.root.querySelectorAll<HTMLElement>('[data-cmd="noteColor"]'))
          el.setAttribute('aria-pressed', el.dataset.cmdValue === value ? 'true' : 'false')
        if (stage.first()?.type === 'note') stage.patch({ fill: value })
        return
      }
      if (cmd === 'zoomIn') return stage.zoomAt(1.25)
      if (cmd === 'zoomOut') return stage.zoomAt(0.8)
      if (cmd === 'fit') return stage.fit()
      if (styleCommand(stage, cmd, value)) syncStyleTools(stage, ctx)
    },
    undo: () => undo.undo(),
    redo: () => undo.redo(),
    insertImage: (url, size) => stage.insertImage(url, size),
    destroy() {
      host.removeEventListener('keydown', onKey)
      host.removeEventListener('keydown', onUndoKey)
      stage.destroy()
      undo.destroy()
    },
  }
}
