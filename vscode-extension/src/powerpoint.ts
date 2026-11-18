// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため（VS Code とつなぐのは presentation-session.ts）

/** PowerPoint のスライド 1 枚。PDF を書き出すときに読む */
export type DeckSlide = {
  /** スライドごとの番号（SlideID）。並べ替えても変わらない */
  id: number
  /** 非表示のスライド。PDF には入らない */
  hidden: boolean
  /** クリックで進むアニメーションの回数 */
  clicks: number
  /** 最後のクリックのあと（クリックがなければ映したあと）、アニメーションが終わるまでの秒数 */
  tail: number
  /** 図形を押すと動くアニメーションがあるか */
  triggers: boolean
}

export type Deck = { name: string; slides: DeckSlide[] }

/** PowerPoint の今の状態。click と clicks は、クリックの段階を読めない OS では null */
export type ShowState =
  | { state: 'closed' }
  | { state: 'idle'; saved: boolean }
  | { state: 'show'; slideId: number | null; click: number | null; clicks: number | null; saved: boolean }
  /** 読めなかった（PowerPoint がダイアログを開いている、操作の許可がないなど） */
  | { state: 'error'; message: string }

/** 利用者に見せる理由付きの失敗 */
export class PowerPointError extends Error {}

export const NO_PRESENTATION = 'PowerPoint でスライドのファイルを開いてから、もう一度お試しください。'

/** OS ごとの、PowerPoint を読む部分 */
export interface PowerPoint {
  /** 開いているファイルのスライドを読み、target に PDF を書き出す。時間がかかっているときに onWaiting を 1 回呼ぶ */
  exportPdf(target: string, onWaiting: () => void): Promise<Deck>
  /** 状態を読み続ける。読む役のプロセスが止まったら onExit を呼ぶ */
  watch(onState: (state: ShowState) => void, onExit: () => void): { dispose: () => void }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null)

/** 読む役のプロセスが 1 行ずつ書き出す JSON を、状態にする。読めない行は null */
export function parseState(line: string): ShowState | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  if (raw.state === 'closed') return { state: 'closed' }
  if (raw.state === 'idle') return { state: 'idle', saved: raw.saved !== false }
  if (raw.state === 'show')
    return {
      state: 'show',
      slideId: intOrNull(raw.slideId),
      click: intOrNull(raw.click),
      clicks: intOrNull(raw.clicks),
      saved: raw.saved !== false,
    }
  if (raw.state === 'error') return { state: 'error', message: typeof raw.message === 'string' ? raw.message : '' }
  return null
}

/** プロセスの標準出力を 1 行ずつ渡す */
export function eachLine(onLine: (line: string) => void) {
  let rest = ''
  return (chunk: Buffer | string) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/)
    rest = lines.pop() ?? ''
    lines.filter((line) => line.trim()).forEach(onLine)
  }
}
