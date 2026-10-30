import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { renderMarkdown } from '../lib/markdown'
import { IconButton } from './button'
import { cx } from './cx'
import { Textarea } from './form'
import { Icon, type IconName } from './icons'
import { useStyle } from './style'

export const Markdown = ({ source, class: cls }: { source: string; class?: string }) => {
  useStyle('/src/components/markdown.css')
  return <div class={cx('prose', cls)}>{raw(renderMarkdown(source))}</div>
}

export type MarkdownFormat = 'heading' | 'bold' | 'italic' | 'listBullet' | 'listNumbered' | 'code' | 'link'

const FORMAT_BUTTONS: { format: MarkdownFormat; icon: IconName; label: string }[] = [
  { format: 'heading', icon: 'heading', label: '見出し' },
  { format: 'bold', icon: 'bold', label: '太字（⌘B / Ctrl+B）' },
  { format: 'italic', icon: 'italic', label: '斜体（⌘I / Ctrl+I）' },
  { format: 'listBullet', icon: 'listBullet', label: '箇条書き' },
  { format: 'listNumbered', icon: 'listNumbered', label: '番号付きの箇条書き' },
  { format: 'code', icon: 'code', label: 'コード' },
  { format: 'link', icon: 'link', label: 'リンク（⌘K / Ctrl+K）' },
]

const MARKDOWN_HELP: [string, string][] = [
  ['# 見出し', '見出し（## で小見出し）'],
  ['**太字**', '太字'],
  ['*斜体*', '斜体'],
  ['- 項目', '箇条書き'],
  ['1. 項目', '番号付きの箇条書き'],
  ['> 引用', '引用'],
  ['`コード`', 'コード（``` で囲むと複数行）'],
  ['[文字](https://…)', 'リンク'],
]

export const MarkdownEditor = ({
  label,
  name,
  id = `f-${name}`,
  value,
  rows = 6,
  placeholder,
  error,
  hint,
  fieldClass,
}: {
  label: Child
  name: string
  id?: string
  value?: string
  rows?: number
  placeholder?: string
  error?: string
  hint?: Child
  fieldClass?: string
}) => {
  useStyle('/src/components/form.css', '/src/components/markdown.css')
  return (
    <div class={cx('field md-editor', fieldClass)} style={`--md-rows: ${rows}`} data-md-editor>
      <div class="md-editor-head">
        <label for={id} id={`${id}-label`}>
          {label}
        </label>
        <div class="md-modes" role="group" aria-label="表示の切り替え">
          <button type="button" aria-pressed="true" data-md-mode="write">
            <Icon name="pencil" size={14} /> 書く
          </button>
          <button type="button" aria-pressed="false" data-md-mode="preview">
            <Icon name="eye" size={14} /> プレビュー
          </button>
        </div>
      </div>
      <div class={cx('md-editor-box', error && 'has-error')}>
        <div class="md-toolbar" role="toolbar" aria-label="書式">
          {FORMAT_BUTTONS.map((b) => (
            <IconButton icon={b.icon} label={b.label} iconSize={16} data-md-format={b.format} />
          ))}
        </div>
        <Textarea
          id={id}
          name={name}
          value={value}
          rows={rows}
          placeholder={placeholder}
          invalid={!!error}
          aria-describedby={error || hint ? `${id}-desc` : undefined}
          class="md-editor-source"
        />
        <div class="md-editor-host" data-md-host />
        <div class="md-preview prose" data-md-preview hidden />
      </div>
      {(error || hint) && (
        <p id={`${id}-desc`} class={error ? 'field-error' : 'field-hint'}>
          {error ? (
            <>
              <Icon name="alert" size={14} /> {error}
            </>
          ) : (
            hint
          )}
        </p>
      )}
      <details class="md-help">
        <summary>
          <Icon name="info" size={14} /> Markdown で書式を付けられます
        </summary>
        <dl>
          {MARKDOWN_HELP.map(([syntax, meaning]) => (
            <>
              <dt>
                <code>{syntax}</code>
              </dt>
              <dd>{meaning}</dd>
            </>
          ))}
        </dl>
      </details>
    </div>
  )
}
