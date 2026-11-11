/** 差分の 1 行。before と after は、それぞれ前と後のファイルでの行番号 */
export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string; before?: number; after?: number }

type Op = DiffLine['kind']

// 上限を付けるのは、Myers 法が編集の数の 2 乗のメモリを使い、まるごと書き換えたファイルで膨らむため
const MAX_EDITS = 1000

export function splitLines(text: string) {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1
    const prevX = v[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('same')
      x--
      y--
    }
    if (d > 0) ops.push(x === prevX ? 'add' : 'remove')
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/** a を b にするいちばん短い手順（Myers 法）。編集が多すぎるときは null */
function editScript(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m, offset)
    }
  }
  return null
}

/** 行ごとの差分。編集が多すぎるときは、変わった範囲をまるごと消して足した形にする */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const ops: Op[] = [
    ...Array.from({ length: head }, (): Op => 'same'),
    ...(editScript(midA, midB) ?? [...midA.map((): Op => 'remove'), ...midB.map((): Op => 'add')]),
    ...Array.from({ length: tail }, (): Op => 'same'),
  ]
  let x = 0
  let y = 0
  return ops.map((kind) => {
    if (kind === 'add') return { kind, text: b[y], after: ++y }
    if (kind === 'remove') return { kind, text: a[x], before: ++x }
    return { kind, text: a[x], before: ++x, after: ++y }
  })
}

export function diffStats(lines: DiffLine[]) {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added++
    else if (line.kind === 'remove') removed++
  }
  return { added, removed }
}

/** 変わった行と、その前後 context 行ずつのまとまりに分ける。変わっていない離れた行は省く */
export function diffHunks(lines: DiffLine[], context = 3): DiffLine[][] {
  const keep = new Uint8Array(lines.length)
  lines.forEach((line, i) => {
    if (line.kind === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = 1
  })
  const hunks: DiffLine[][] = []
  lines.forEach((line, i) => {
    if (!keep[i]) return
    if (i === 0 || !keep[i - 1]) hunks.push([])
    hunks.at(-1)!.push(line)
  })
  return hunks
}
