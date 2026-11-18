/// <reference lib="dom" />
import { Editor, Extension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { NodeRange } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { liftTarget } from '@tiptap/pm/transform'
import StarterKit from '@tiptap/starter-kit'
import { DOC_FONTS, presenceColor } from '../lib/collab'
import type { CollabEditor, EditorContext } from './app'

/** 文書の中身を入れる Yjs の欄の名前 */
export const DOC_FIELD = 'doc'

const MAX_INDENT = 8
const INDENT_TYPES = ['paragraph', 'heading']
const ALIGNMENTS = ['left', 'center', 'right', 'justify']
const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:']

// user.color を使わないのは、CollaborationCaret が #RRGGBB 以外の色を transparent に置き換えて渡してくるため
const personColor = (user: Record<string, unknown>) => presenceColor(Number(user.id))

function caret(user: Record<string, unknown>) {
  const el = document.createElement('span')
  el.className = 'doc-caret'
  el.style.setProperty('--person', personColor(user))
  const label = document.createElement('span')
  label.className = 'doc-caret-label'
  label.textContent = String(user.name)
  el.append(label)
  return el
}

const Indent = Extension.create({
  name: 'docIndent',
  // Backspace の既定の処理（前の段落とつなげる）より先に字下げを戻すため
  priority: 200,
  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(Number(el.getAttribute('data-indent')) || 0, MAX_INDENT),
            renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `margin-left: ${attrs.indent * 2}em` } : {}),
          },
        },
      },
    ]
  },
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { empty, $from } = this.editor.state.selection
        const indent = Number($from.parent.attrs.indent) || 0
        if (!empty || $from.parentOffset > 0 || !indent) return false
        return this.editor.commands.updateAttributes($from.parent.type.name, { indent: indent - 1 })
      },
    }
  },
})

function normalizeUrl(text: string) {
  const value = text.trim()
  if (!value) return null
  const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  try {
    return LINK_PROTOCOLS.includes(new URL(href).protocol) ? href : null
  } catch {
    return null
  }
}

export function mount(ctx: EditorContext): CollabEditor {
  const { root } = ctx
  const page = document.createElement('div')
  page.className = 'doc-page'
  const scroller = document.createElement('div')
  scroller.className = 'doc-scroller'
  scroller.append(page)
  ctx.stage.replaceChildren(scroller)

  const listeners = new AbortController()
  const { signal } = listeners
  const linkMenu = root.querySelector<HTMLDetailsElement>('[data-doc-link-menu]')
  const linkToggle = root.querySelector<HTMLElement>('[data-doc-link-toggle]')
  const linkInput = root.querySelector<HTMLInputElement>('[data-doc-link-url]')
  const linkOpen = root.querySelector<HTMLAnchorElement>('[data-doc-link-open]')

  // 既定より後に動かすのは、リストと表とコードブロックの Tab を先に処理させるため
  const Shortcuts = Extension.create({
    name: 'docShortcuts',
    priority: 50,
    addKeyboardShortcuts: () => ({
      Tab: () => indentByKey(1),
      'Shift-Tab': () => indentByKey(-1),
      'Mod-k': () => {
        if (!linkMenu?.open) linkToggle?.click()
        return true
      },
      'Mod-s': () => {
        ctx.toast('変更は自動で保存されています。', 'info')
        return true
      },
      // Tab を字下げに使うので、キーボードだけで操作する人がツールバーへ出られるようにする
      Escape: () => {
        root.querySelector<HTMLElement>('.collab-bar summary, .collab-bar button')?.focus()
        return true
      },
    }),
  })

  const editor = new Editor({
    element: page,
    extensions: [
      // 元に戻す操作を StarterKit のものにしないのは、ほかの人の変更まで戻してしまうため。Collaboration の自分の変更だけを戻すものを使う
      StarterKit.configure({
        undoRedo: false,
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { enableTabIndentation: true, tabSize: 2 },
        link: { openOnClick: false, autolink: true },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: INDENT_TYPES }),
      TableKit.configure({ table: { resizable: true, cellMinWidth: 40 } }),
      Image.configure({
        inline: false,
        resize: {
          enabled: true,
          directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
          minWidth: 40,
          minHeight: 40,
          alwaysPreserveAspectRatio: true,
        },
      }),
      Indent,
      Shortcuts,
      Collaboration.configure({ document: ctx.doc, field: DOC_FIELD }),
      CollaborationCaret.configure({
        provider: { awareness: ctx.awareness },
        user: ctx.user,
        render: caret,
        // 既定の選択の描き方を使わないのは、色の後ろに透明度の 2 桁を足す作りで、hsl() の色では効かないため
        selectionRender: (user) => ({ nodeName: 'span', class: 'doc-remote-sel', style: `--person:${personColor(user)}` }),
      }),
    ],
    editorProps: {
      attributes: { class: 'doc-content', spellcheck: 'false', 'aria-label': '文書の本文' },
      // クリックだけで開かないのは、リンクの文字を直そうとしてカーソルを置くたびに別のタブが開くため
      handleClick(_view, _pos, e) {
        const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
        if (!link || !(e.metaKey || e.ctrlKey)) return false
        window.open(link.href, '_blank', 'noopener,noreferrer')
        return true
      },
    },
  })

  const chain = () => editor.chain().focus()

  // editor.isActive を使わないのは、全選択すると末尾の空の段落まで範囲に入り、どの種類でもないと判定されるため
  function currentBlock() {
    const { $from } = editor.state.selection
    const $block = Selection.findFrom($from, 1, true)?.$from ?? $from
    for (let depth = $block.depth; depth > 0; depth--) {
      const node = $block.node(depth)
      if (node.type.name === 'codeBlock') return 'codeBlock'
      if (node.type.name === 'heading') return `h${String(node.attrs.level)}`
      if (node.type.name === 'blockquote') return 'blockquote'
    }
    return 'p'
  }

  const setColorBar = (cmd: string, color: unknown) => {
    const bar = root.querySelector<HTMLElement>(`[data-doc-color="${cmd}"] .collab-color-bar`)
    if (typeof color === 'string') bar?.style.setProperty('--picked', color)
    else bar?.style.removeProperty('--picked')
  }

  const sync = () => {
    for (const name of ['bold', 'italic', 'underline', 'strike', 'code', 'bulletList', 'orderedList'])
      ctx.setPressed(name, editor.isActive(name))
    const aligned = ALIGNMENTS.find((a) => a !== 'left' && editor.isActive({ textAlign: a })) ?? 'left'
    for (const align of ALIGNMENTS) ctx.setPressed('align', align === aligned, align)
    ctx.setValue('block', currentBlock())
    const style = editor.getAttributes('textStyle')
    ctx.setValue('fontFamily', DOC_FONTS.find((f) => f.css === style.fontFamily)?.value ?? '')
    ctx.setValue('fontSize', /^[\d.]+pt$/.test(String(style.fontSize)) ? String(parseFloat(style.fontSize as string)) : '')
    setColorBar('color', style.color)
    setColorBar('highlight', editor.getAttributes('highlight').color)
    linkToggle?.setAttribute('aria-pressed', String(editor.isActive('link')))
  }
  editor.on('selectionUpdate', sync)
  editor.on('transaction', sync)

  function changeIndent(delta: 1 | -1) {
    if (editor.isActive('listItem')) return delta > 0 ? chain().sinkListItem('listItem').run() : chain().liftListItem('listItem').run()
    return chain()
      .command(({ tr, state }) => {
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!INDENT_TYPES.includes(node.type.name)) return
          const current = Number(node.attrs.indent) || 0
          const indent = Math.min(Math.max(current + delta, 0), MAX_INDENT)
          if (indent !== current) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent })
            changed = true
          }
          return false
        })
        return changed
      })
      .run()
  }

  function indentByKey(delta: 1 | -1) {
    if (!editor.isActive('listItem') && !editor.isActive('table')) changeIndent(delta)
    return true
  }

  function setBlock(value: string | undefined) {
    // unsetBlockquote を使わないのは、全選択だと引用の中と判定されず、外せないため
    const next = chain()
      .command(({ tr }) => {
        const quotes: { pos: number; size: number }[] = []
        tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
          if (node.type.name === 'blockquote') quotes.push({ pos, size: node.nodeSize })
        })
        for (const { pos, size } of quotes.reverse()) {
          const $start = tr.doc.resolve(pos + 1)
          const range = new NodeRange($start, tr.doc.resolve(pos + size - 1), $start.depth)
          const target = liftTarget(range)
          if (target !== null) tr.lift(range, target)
        }
        return true
      })
      .setParagraph()
    if (value === 'blockquote') return next.setBlockquote().run()
    if (value === 'codeBlock') return next.setCodeBlock().run()
    const level = Number(value?.slice(1))
    return level ? next.setHeading({ level: level as 1 | 2 | 3 | 4 }).run() : next.run()
  }

  // 挿入した画像を選択したままにしないのは、続けて文字を打つと画像が消えてしまうため
  const placeImage = (url: string) =>
    chain()
      .setImage({ src: url })
      .command(({ tr, state }) => {
        if (!(tr.selection instanceof NodeSelection)) return true
        const $end = tr.doc.resolve(tr.selection.to)
        if (!$end.nodeAfter?.isTextblock) tr.insert($end.pos, state.schema.nodes.paragraph.create())
        tr.setSelection(TextSelection.create(tr.doc, $end.pos + 1))
        return true
      })
      .run()

  async function insertImages(files: File[]) {
    for (const file of files) {
      const url = await ctx.uploadImage(file)
      if (url) placeImage(url)
    }
  }

  const isImage = (file: File) => file.type.startsWith('image/')

  function applyLink() {
    const href = normalizeUrl(linkInput?.value ?? '')
    if (!href) {
      ctx.toast('URL が正しくありません。', 'error')
      linkInput?.focus()
      return
    }
    if (linkMenu) linkMenu.open = false
    if (editor.state.selection.empty && !editor.isActive('link'))
      return chain()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    return chain().extendMarkRange('link').setLink({ href }).run()
  }

  function refreshTableMenu() {
    const inTable = editor.isActive('table')
    for (const el of root.querySelectorAll<HTMLButtonElement>('[data-doc-needs-table]')) el.disabled = !inTable
    const insert = root.querySelector<HTMLButtonElement>('[data-cmd="tableInsert"]')
    if (insert) insert.disabled = !editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    const merge = root.querySelector<HTMLButtonElement>('[data-cmd="tableMerge"]')
    if (merge) merge.disabled = !editor.can().mergeOrSplit()
  }

  function refreshLinkMenu() {
    const href = editor.isActive('link') ? String(editor.getAttributes('link').href ?? '') : ''
    if (linkInput) linkInput.value = href
    if (linkOpen) linkOpen.href = href || '#'
    for (const el of root.querySelectorAll<HTMLElement>('[data-doc-link-existing]')) el.hidden = !href
    linkInput?.focus()
    linkInput?.select()
  }

  // toggle は泡立たないので、捕捉の段階で受け取る
  root.addEventListener(
    'toggle',
    (e) => {
      const menu = e.target
      if (!(menu instanceof HTMLDetailsElement) || !menu.open) return
      refreshTableMenu()
      if (menu === linkMenu) refreshLinkMenu()
    },
    { capture: true, signal },
  )
  root.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element).closest('[data-doc-link-apply]')) applyLink()
    },
    { signal },
  )
  linkInput?.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || e.isComposing) return
      e.preventDefault()
      applyLink()
    },
    { signal },
  )

  const bar = root.querySelector<HTMLElement>('.collab-bar')
  const barObserver = new ResizeObserver(() => {
    if (bar) root.style.setProperty('--collab-bar-bottom', `${bar.getBoundingClientRect().bottom}px`)
  })
  if (bar) barObserver.observe(bar)

  function command(cmd: string, value: string | undefined, el: HTMLElement) {
    // 選択欄にフォーカスが残ると、ctx.setValue が入力中とみなして表示を合わせない
    if (el instanceof HTMLSelectElement) el.blur()
    if (el instanceof HTMLInputElement) el.closest('details')?.removeAttribute('open')
    switch (cmd) {
      case 'bold':
        return chain().toggleBold().run()
      case 'italic':
        return chain().toggleItalic().run()
      case 'underline':
        return chain().toggleUnderline().run()
      case 'strike':
        return chain().toggleStrike().run()
      case 'code':
        return chain().toggleCode().run()
      case 'color':
        return value ? chain().setColor(value).run() : chain().unsetColor().run()
      case 'highlight':
        return value ? chain().setHighlight({ color: value }).run() : chain().unsetHighlight().run()
      case 'fontFamily': {
        const font = DOC_FONTS.find((f) => f.value === value)
        return font ? chain().setFontFamily(font.css).run() : chain().unsetFontFamily().run()
      }
      case 'fontSize':
        return value ? chain().setFontSize(`${value}pt`).run() : chain().unsetFontSize().run()
      case 'clearFormat':
        return chain()
          .unsetAllMarks()
          .unsetTextAlign()
          .command(({ tr, state }) => {
            state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
              if (node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0 })
            })
            return true
          })
          .run()
      case 'align':
        return value && chain().setTextAlign(value).run()
      case 'bulletList':
        return chain().toggleBulletList().run()
      case 'orderedList':
        return chain().toggleOrderedList().run()
      case 'indent':
        return changeIndent(1)
      case 'outdent':
        return changeIndent(-1)
      case 'block':
        return setBlock(value)
      case 'unlink':
        return chain().extendMarkRange('link').unsetLink().run()
      case 'tableInsert':
        return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      case 'tableRowBefore':
        return chain().addRowBefore().run()
      case 'tableRowAfter':
        return chain().addRowAfter().run()
      case 'tableColBefore':
        return chain().addColumnBefore().run()
      case 'tableColAfter':
        return chain().addColumnAfter().run()
      case 'tableMerge':
        return chain().mergeOrSplit().run()
      case 'tableHeaderRow':
        return chain().toggleHeaderRow().run()
      case 'tableRowDelete':
        return chain().deleteRow().run()
      case 'tableColDelete':
        return chain().deleteColumn().run()
      case 'tableDelete':
        return chain().deleteTable().run()
      case 'rule':
        return chain().setHorizontalRule().run()
    }
  }

  // 貼り付けた画像を TipTap に任せないのは、data: の URL のまま文書に入り、全員に配る状態が大きくなりすぎるため。先にサーバーに置く
  page.addEventListener(
    'paste',
    (e) => {
      // 文字があれば文字を優先するのは、Word や Excel からのコピーには、その範囲を写した画像も一緒に入っているため
      if (e.clipboardData?.getData('text/plain')) return
      const images = [...(e.clipboardData?.files ?? [])].filter(isImage)
      if (!images.length) return
      e.preventDefault()
      void insertImages(images)
    },
    { capture: true, signal },
  )

  // 紙の外も受けるのは、外れた場所に落とすとブラウザがファイルを開いてこの画面から離れてしまうため
  scroller.addEventListener(
    'dragover',
    (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    },
    { signal },
  )
  scroller.addEventListener(
    'drop',
    (e) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      const images = files.filter(isImage)
      if (!images.length) return ctx.toast('文書に入れられるファイルは画像だけです。', 'error')
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (at) editor.commands.setTextSelection(at.pos)
      void insertImages(images)
    },
    { capture: true, signal },
  )

  return {
    command,
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    insertImage: (url) => placeImage(url),
    async exportFile() {
      const { docToDocx } = await import('./docx')
      return docToDocx(editor.getJSON())
    },
    async importFile(file) {
      const { docxToHtml } = await import('./docx')
      const html = await docxToHtml(file, ctx.uploadImage)
      editor.chain().setContent(html).focus('start').run()
    },
    destroy() {
      listeners.abort()
      barObserver.disconnect()
      editor.destroy()
    },
  }
}
