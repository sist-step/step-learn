import { decodeEntities } from './xml'

export type Converted = { markdown: string; images: number; tables: number }

const SKIPPED = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'svg', 'math', 'object', 'iframe', 'video', 'audio'])
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'nav',
  'main',
  'figure',
  'figcaption',
  'address',
  'dl',
  'dt',
  'dd',
  'center',
  'details',
  'summary',
  'form',
  'fieldset',
])

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/g

const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]).trim() : ''
}

// URL をそのまま埋め込まないのは、空白や閉じ括弧のところで Markdown のリンクの書式が途切れるため
const linkUrl = (href: string) => (/^https?:\/\//i.test(href) ? href.replace(/\s/g, '%20').replace(/\)/g, '%29') : null)

const fileNameOf = (src: string) => decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() ?? '').trim()

function htmlToMarkdown(html: string): Converted {
  const lines: string[] = []
  let buf = ''
  let prefix = ''
  let skipDepth = 0
  let pre: string | null = null
  const lists: { tag: 'ul' | 'ol'; n: number }[] = []
  const links: { href: string | null; start: number }[] = []
  let cells = 0
  let images = 0
  let tables = 0

  const blank = () => {
    if (lines.length && lines.at(-1) !== '') lines.push('')
  }
  const flush = () => {
    const parts = buf
      .split('\n')
      .map((l) => l.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
    parts.forEach((l, i) => lines.push(i === 0 ? prefix + l : l))
    buf = ''
    prefix = ''
    return parts.length > 0
  }
  const block = () => {
    if (flush()) blank()
  }

  for (const m of html.matchAll(TAG)) {
    const [, closing, rawName, attrs, text] = m
    if (text !== undefined) {
      if (skipDepth) continue
      const decoded = decodeEntities(text)
      if (pre !== null) pre += decoded
      else buf += decoded.replace(/\s+/g, ' ')
      continue
    }
    if (!rawName) continue
    const name = rawName.toLowerCase()
    const close = closing === '/'

    if (SKIPPED.has(name)) {
      if (!attrs.trimEnd().endsWith('/')) skipDepth = Math.max(0, skipDepth + (close ? -1 : 1))
      continue
    }
    if (skipDepth) continue

    if (name === 'pre') {
      if (!close) {
        block()
        pre = ''
      } else if (pre !== null) {
        lines.push('```', ...pre.replace(/^\n/, '').replace(/\s+$/, '').split('\n'), '```', '')
        pre = null
      }
      continue
    }
    if (pre !== null) {
      if (name === 'br') pre += '\n'
      continue
    }

    switch (name) {
      case 'br':
        buf += '\n'
        break
      case 'hr':
        block()
        lines.push('---', '')
        break
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        // 番号どおりに対応させないのは、このアプリの見出しが 3 段階しかなく、Moodle のエディターがよく使う h3〜h5 が同じ見出しに潰れるため
        block()
        if (!close) prefix = name <= 'h3' ? '# ' : name === 'h4' ? '## ' : '### '
        break
      case 'ul':
      case 'ol':
        flush()
        if (close) {
          lists.pop()
          if (!lists.length) blank()
        } else lists.push({ tag: name === 'ol' ? 'ol' : 'ul', n: 0 })
        break
      case 'li':
        flush()
        if (!close) {
          const list = lists.at(-1)
          if (list) list.n++
          prefix = '  '.repeat(Math.max(0, lists.length - 1)) + (list?.tag === 'ol' ? `${list.n}. ` : '- ')
        }
        break
      case 'blockquote':
        block()
        if (!close) prefix = '> '
        break
      case 'table':
        flush()
        blank()
        if (!close) tables++
        break
      case 'tr':
        flush()
        cells = 0
        break
      case 'td':
      case 'th':
        if (!close && cells++ > 0) buf += ' | '
        break
      case 'strong':
      case 'b':
        buf += '**'
        break
      case 'em':
      case 'i':
        buf += '*'
        break
      case 'code':
        buf += '`'
        break
      case 'a':
        if (!close) links.push({ href: linkUrl(attr(attrs, 'href')), start: buf.length })
        else {
          const link = links.pop()
          const label = link ? buf.slice(link.start).trim() : ''
          if (link?.href && label && !/[[\]\n]/.test(label)) buf = `${buf.slice(0, link.start)}[${label}](${link.href})`
        }
        break
      case 'img': {
        images++
        const label = attr(attrs, 'alt') || fileNameOf(attr(attrs, 'src')) || '画像'
        buf += `（画像: ${label}）`
        break
      }
      default:
        if (BLOCKS.has(name)) block()
    }
  }
  if (pre !== null) lines.push('```', ...pre.split('\n'), '```')
  flush()

  const markdown = lines
    .join('\n')
    .replace(/\*\*(\s*)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { markdown, images, tables }
}

export function toMarkdown(text: string, format: number): Converted {
  if (format === 4 || format === 2) return { markdown: text.replace(/\r\n?/g, '\n').trim(), images: 0, tables: 0 }
  // FORMAT_MOODLE をそのまま HTML として読まないのは、改行が表示上の改行になる形式で、読むと改行が消えるため
  return htmlToMarkdown(format === 0 ? text.replace(/\r?\n/g, '<br>') : text)
}

/** 説明欄のように Markdown を描画しない欄に入れるための、書式の記号を外した文字列 */
export function toPlainText(text: string, format: number) {
  const { markdown } = toMarkdown(text, format)
  return markdown
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1（$2）')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^```$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
