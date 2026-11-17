/// <reference lib="dom" />
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import type { CollabEditor, EditorContext } from './app'

/** 文書の中身を入れる Yjs の欄の名前 */
export const DOC_FIELD = 'doc'

function caret(user: Record<string, unknown>) {
  const el = document.createElement('span')
  el.className = 'doc-caret'
  el.style.setProperty('--person', String(user.color))
  const label = document.createElement('span')
  label.className = 'doc-caret-label'
  label.textContent = String(user.name)
  el.append(label)
  return el
}

export function mount(ctx: EditorContext): CollabEditor {
  const page = document.createElement('div')
  page.className = 'doc-page'
  const scroller = document.createElement('div')
  scroller.className = 'doc-scroller'
  scroller.append(page)
  ctx.stage.replaceChildren(scroller)

  const editor = new Editor({
    element: page,
    extensions: [
      // 元に戻す操作を StarterKit のものにしないのは、ほかの人の変更まで戻してしまうため。Collaboration の自分の変更だけを戻すものを使う
      StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false }),
      Collaboration.configure({ document: ctx.doc, field: DOC_FIELD }),
      CollaborationCaret.configure({
        provider: { awareness: ctx.awareness },
        user: ctx.user,
        render: caret,
        // 既定の選択の描き方を使わないのは、色の後ろに透明度の 2 桁を足す作りで、hsl() の色では効かないため
        selectionRender: (user) => ({ nodeName: 'span', class: 'doc-remote-sel', style: `--person:${String(user.color)}` }),
      }),
    ],
    editorProps: { attributes: { class: 'doc-content', spellcheck: 'false', 'aria-label': '文書の本文' } },
  })

  const sync = () => {
    ctx.setPressed('bold', editor.isActive('bold'))
    ctx.setPressed('italic', editor.isActive('italic'))
    ctx.setPressed('underline', editor.isActive('underline'))
    ctx.setPressed('strike', editor.isActive('strike'))
    ctx.setPressed('bulletList', editor.isActive('bulletList'))
    ctx.setPressed('orderedList', editor.isActive('orderedList'))
    for (const align of ['left', 'center', 'right']) ctx.setPressed('align', editor.isActive({ textAlign: align }), align)
    const level = [1, 2, 3].find((l) => editor.isActive('heading', { level: l }))
    ctx.setValue('block', level ? `h${level}` : 'p')
  }
  editor.on('selectionUpdate', sync)
  editor.on('transaction', sync)

  const chain = () => editor.chain().focus()

  function command(cmd: string, value: string | undefined) {
    switch (cmd) {
      case 'bold':
        return chain().toggleBold().run()
      case 'italic':
        return chain().toggleItalic().run()
      case 'underline':
        return chain().toggleUnderline().run()
      case 'strike':
        return chain().toggleStrike().run()
      case 'color':
        return value && chain().setColor(value).run()
      case 'highlight':
        return value && chain().setHighlight({ color: value }).run()
      case 'align':
        return value && chain().setTextAlign(value).run()
      case 'bulletList':
        return chain().toggleBulletList().run()
      case 'orderedList':
        return chain().toggleOrderedList().run()
      case 'block': {
        const level = Number(value?.slice(1))
        return value === 'p' || !level
          ? chain().setParagraph().run()
          : chain()
              .setHeading({ level: level as 1 | 2 | 3 })
              .run()
      }
      case 'tableInsert':
        return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      case 'tableRowAfter':
        return chain().addRowAfter().run()
      case 'tableColAfter':
        return chain().addColumnAfter().run()
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
    async (e) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      const url = await ctx.uploadImage(file)
      if (url) chain().setImage({ src: url }).run()
    },
    true,
  )

  return {
    command,
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    insertImage: (url) => chain().setImage({ src: url }).run(),
    async exportFile() {
      const { docToDocx } = await import('./docx')
      return docToDocx(editor.getJSON())
    },
    async importFile(file) {
      const { docxToHtml } = await import('./docx')
      const html = await docxToHtml(file, ctx.uploadImage)
      editor.commands.setContent(html)
    },
    destroy: () => editor.destroy(),
  }
}
