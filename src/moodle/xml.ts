// XML パーサーのライブラリを使わないのは、ランタイム依存を増やさないため。
// DTD や名前空間を扱わないのは、Moodle のバックアップには出てこないため

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  times: '×',
  yen: '¥',
}

function codePoint(n: number) {
  return Number.isInteger(n) && n > 0 && n <= 0x10_ffff ? String.fromCodePoint(n) : ''
}

export const decodeEntities = (s: string) =>
  s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] !== '#') return NAMED_ENTITIES[e] ?? m
    return codePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  })

const parseAttrs = (s: string) =>
  Object.fromEntries([...s.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], decodeEntities(m[2] ?? m[3])]))

const TOKEN =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [root]
  for (const m of src.matchAll(TOKEN)) {
    const top = stack.at(-1)!
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2]) {
      if (stack.length > 1) stack.pop()
    } else if (m[3]) {
      const node: XmlNode = { name: m[3], attrs: parseAttrs(m[4]), children: [], text: '' }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6])
  }
  return root
}

const MOODLE_NULL = '$@NULL@$'

export const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name)

export const childrenOf = (node: XmlNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? []

/** `a/b/c` の順にたどった子要素 */
export const at = (node: XmlNode | undefined, path: string) => path.split('/').reduce((n, name) => child(n, name), node)

export function textAt(node: XmlNode | undefined, path: string) {
  const text = at(node, path)?.text ?? ''
  return text === MOODLE_NULL ? '' : text
}

export const numberAt = (node: XmlNode | undefined, path: string) => Number(textAt(node, path)) || 0
