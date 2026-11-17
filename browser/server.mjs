// STEP Learn の Web の実行環境。受け取った HTML を headless Chromium で開き、採点に使う「実行の記録」を返す。
//
//   server.mjs serve   要求を待ち受ける（POST /render、GET /health）
//   server.mjs health  待ち受けているかを確かめる（コンテナのヘルスチェック）
//
// 依存を入れないのは、学生のコードを動かすコンテナに、更新を追いかける部品を増やさないため。Chromium とは DevTools Protocol をパイプで話す

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const LISTEN = process.env.BROWSER_LISTEN ?? 'unix:/run/browser/browser.sock'
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium'
const SLOTS = Number(process.env.BROWSER_SLOTS ?? 2)

const MAX_BODY_BYTES = 256 * 1024
const MAX_DOCUMENT_BYTES = 200 * 1024
const RENDER_MS = 20_000
const LOAD_MS = 5_000
const QUEUE_MS = 20_000
const MAX_PENDING = 16

const WIDE = { width: 1280, height: 800 }
const NARROW = { width: 375, height: 667 }
const SETTLE_MS = 300
const TIMELINE_MS = 1_000
const CLICK_SETTLE_MS = 500
const MAX_CLICKS = 12
const MAX_HOVERS = 6
const MAX_CONSOLE = 40
const MAX_TEXT = 300

const FLAGS = [
  '--headless',
  // Chromium 自身の sandbox を使わないのは、使うにはユーザー名前空間か SYS_ADMIN が要り、コンテナの権限を広げることになるため。
  // 代わりにコンテナを、ネットワークなし・読み取り専用・権限なしの利用者で動かす（compose.yaml）
  '--no-sandbox',
  '--no-zygote',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
  '--no-first-run',
  '--no-default-browser-check',
  '--mute-audio',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--lang=ja-JP',
  // ネットワークのないコンテナでも付けるのは、開発用の compose.dev.yaml ではネットワークにつながっているため
  '--proxy-server=127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
  '--remote-debugging-pipe',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const clip = (text, max = MAX_TEXT) => {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// ---------------------------------------------------------------- DevTools Protocol（--remote-debugging-pipe の 3 番と 4 番のファイル記述子）

class Cdp {
  constructor(input, output) {
    this.input = input
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    this.closed = false
    let buffer = ''
    output.setEncoding('utf8')
    output.on('data', (chunk) => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\0')) >= 0) {
        const raw = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        let message
        try {
          message = JSON.parse(raw)
        } catch {
          continue
        }
        if (message.id && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id)
          this.pending.delete(message.id)
          if (message.error) reject(new Error(`${message.error.message}`))
          else resolve(message.result ?? {})
        } else {
          for (const listener of this.listeners) listener(message)
        }
      }
    })
    const fail = () => {
      this.closed = true
      for (const { reject } of this.pending.values()) reject(new Error('Chromium との接続が切れました'))
      this.pending.clear()
    }
    output.on('close', fail)
    output.on('error', fail)
    input.on('error', fail)
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('Chromium との接続が切れました'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
    })
  }

  on(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  waitFor(predicate, ms) {
    return new Promise((resolve) => {
      const off = this.on((message) => {
        if (!predicate(message)) return
        clearTimeout(timer)
        off()
        resolve(true)
      })
      const timer = setTimeout(() => {
        off()
        resolve(false)
      }, ms)
    })
  }
}

// ---------------------------------------------------------------- ページの中で動かす関数（学生のコードとは別の isolated world で動かす）

// isolated world で動かすのは、学生のコードが getComputedStyle などを書き換えて、記録を偽れないようにするため
const PAGE_HELPERS = `(() => {
  if (window.__step) return
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'BR'])
  const INHERITED = ['color', 'font-size', 'font-weight', 'text-align', 'list-style-type']
  const ids = new WeakMap()
  let nextId = 1
  const idOf = (el) => {
    if (!ids.has(el)) ids.set(el, nextId++)
    return ids.get(el)
  }
  const clip = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s)
  const ownText = (el) =>
    clip(
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(' ')
        .replace(/\\s+/g, ' ')
        .trim(),
      40,
    )
  const describe = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    for (const c of el.classList) s += '.' + c
    for (const a of ['type', 'name', 'href', 'src', 'colspan', 'rowspan', 'for', 'placeholder']) {
      const v = el.getAttribute(a)
      if (v != null && v !== '') s += '[' + a + '=' + clip(v, 40) + ']'
    }
    if ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && el.value) s += '[value=' + clip(String(el.value), 40) + ']'
    if (el.disabled) s += '[disabled]'
    if (el.checked) s += '[checked]'
    return s
  }
  const isZero = (v) => v === '0px' || v === 'none' || v === 'normal' || v === 'auto'
  const styleOf = (el, cs, parent) => {
    const out = []
    const add = (k, v) => out.push(k + ':' + v)
    add('display', cs.display)
    if (cs.position !== 'static') add('position', cs.position + (cs.top !== 'auto' ? ' top=' + cs.top : ''))
    if (cs.float !== 'none') add('float', cs.float)
    if (cs.display.includes('flex')) {
      add('flex-direction', cs.flexDirection)
      if (cs.flexWrap !== 'nowrap') add('flex-wrap', cs.flexWrap)
      if (cs.justifyContent !== 'normal') add('justify-content', cs.justifyContent)
    }
    if (cs.display.includes('grid')) add('grid-template-columns', cs.gridTemplateColumns)
    if ((cs.display.includes('flex') || cs.display.includes('grid')) && !isZero(cs.columnGap)) add('gap', cs.columnGap)
    if (cs.maxWidth !== 'none') add('max-width', cs.maxWidth)
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (!isZero(cs['margin' + side])) add('margin-' + side.toLowerCase(), cs['margin' + side])
    }
    if (!isZero(cs.paddingTop) || !isZero(cs.paddingLeft)) add('padding', cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft)
    if (!isZero(cs.borderTopWidth) && cs.borderTopStyle !== 'none') add('border-top', cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor)
    if (el.tagName === 'TABLE') add('border-collapse', cs.borderCollapse)
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') add('background-color', cs.backgroundColor)
    if (cs.backgroundImage !== 'none') add('background-image', clip(cs.backgroundImage, 60))
    const pcs = parent && getComputedStyle(parent)
    for (const k of INHERITED) {
      const v = cs.getPropertyValue(k)
      if (!pcs || pcs.getPropertyValue(k) !== v) add(k, v)
    }
    if (cs.visibility !== 'visible') add('visibility', cs.visibility)
    if (cs.opacity !== '1') add('opacity', cs.opacity)
    if (cs.overflow !== 'visible') add('overflow', cs.overflow)
    return out.join('; ')
  }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return Math.round(r.x) + ',' + Math.round(r.y + scrollY) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
  }
  const elements = () => {
    const out = []
    const walk = (el) => {
      for (const child of el.children) {
        if (SKIP.has(child.tagName)) continue
        out.push(child)
        walk(child)
      }
    }
    if (document.body) walk(document.body)
    return out
  }
  const tagOf = (el) => el.tagName.toLowerCase() + Array.from(el.classList, (c) => '.' + c).join('')
  const shapeOf = (el) => tagOf(el) + '(' + Array.from(el.children, shapeOf).join(',') + ')'
  // 画面の様子。要素ごとに 1 行で、場所と大きさ・計算後のスタイルを書く。
  // 同じ形の兄弟が 3 つ以上続くときは 2 つだけ書いて数を添えるのは、商品のカードのような繰り返しで記録が長くなり、AI に渡す量が増えるため
  const layout = (limit) => {
    const lines = []
    let total = 0
    const walk = (el, depth) => {
      const children = Array.from(el.children).filter((c) => !SKIP.has(c.tagName))
      let run = 0
      let folded = 0
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        total++
        run = i > 0 && shapeOf(child) === shapeOf(children[i - 1]) ? run + 1 : 0
        if (run >= 2) {
          folded++
          if (i === children.length - 1 || shapeOf(children[i + 1]) !== shapeOf(child)) {
            lines.push('  '.repeat(depth) + '（上と同じ形の ' + tagOf(child) + ' がほか ' + folded + ' 個）')
            folded = 0
          }
          continue
        }
        if (lines.length >= limit) continue
        const cs = getComputedStyle(child)
        const text = ownText(child)
        const head = '  '.repeat(depth) + describe(child) + (text ? ' 「' + text + '」' : '')
        if (cs.display === 'none') {
          lines.push(head + ' {display:none}')
          continue
        }
        lines.push(head + ' [' + rectOf(child) + '] {' + styleOf(child, cs, child.parentElement) + '}')
        walk(child, depth + 1)
      }
    }
    if (document.body) walk(document.body, 0)
    return {
      title: document.title,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      lines,
      total,
    }
  }
  const LOOK = ['display', 'visibility', 'color', 'background-color', 'text-decoration-line']
  // 操作の前後で比べるための、要素ごとの見た目の状態
  const state = () => {
    const out = {}
    for (const el of elements().slice(0, 300)) {
      const cs = getComputedStyle(el)
      out[idOf(el)] = { d: describe(el), t: clip(ownText(el), 80), s: LOOK.map((k) => cs.getPropertyValue(k)) }
    }
    return out
  }
  const lineOf = (v) => v.d + (v.t ? ' 「' + v.t + '」' : '') + (v.s[0] === 'none' ? ' {display:none}' : '')
  const diff = (before, after, limit) => {
    const changes = []
    const added = []
    const removed = []
    for (const [id, v] of Object.entries(after)) {
      const b = before[id]
      if (!b) {
        added.push(lineOf(v))
        continue
      }
      const parts = []
      if (b.t !== v.t) parts.push('「' + b.t + '」→「' + v.t + '」')
      if (b.d !== v.d) parts.push('→ ' + v.d)
      LOOK.forEach((k, i) => {
        if (b.s[i] !== v.s[i]) parts.push(k + ': ' + b.s[i] + ' → ' + v.s[i])
      })
      if (parts.length) changes.push('変化: ' + b.d + ' ' + parts.join('、'))
    }
    for (const [id, v] of Object.entries(before)) if (!after[id]) removed.push(lineOf(v))
    // 描き直しただけで中身の変わらない要素を数えないのは、innerHTML で一覧を作り直すコードでは、毎回すべての行が消えて足されたように見えるため
    for (const line of [...removed]) {
      const i = added.indexOf(line)
      if (i < 0) continue
      added.splice(i, 1)
      removed.splice(removed.indexOf(line), 1)
    }
    changes.push(...added.map((l) => '追加: ' + l), ...removed.map((l) => '削除: ' + l))
    const counted = []
    for (const line of changes) {
      const last = counted[counted.length - 1]
      if (last && last.line === line) last.n++
      else counted.push({ line, n: 1 })
    }
    const out = counted.map(({ line, n }) => (n > 1 ? line + '（同じ変化が ' + n + ' 個）' : line))
    return out.length > limit ? out.slice(0, limit).concat(['ほか ' + (out.length - limit) + ' 件']) : out
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const CLICKABLE = 'button, input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio], a[href], summary, [onclick], [role=button]'
  // 同じ見た目のボタンを 3 つまでにするのは、商品ごとの「かごに入れる」のような繰り返しで、押す回数の上限をほかのボタンに残すため
  const clickables = () => {
    const seen = new Map()
    return elements().filter((el) => {
      if (!el.matches(CLICKABLE) || !visible(el)) return false
      const key = describe(el) + ownText(el)
      seen.set(key, (seen.get(key) ?? 0) + 1)
      return seen.get(key) <= 3
    })
  }
  const others = () => elements().filter((el) => !el.matches(CLICKABLE) && visible(el)).slice(0, 200)
  const extra = new Set()
  const candidates = () => {
    const list = clickables()
    for (const el of extra) if (el.isConnected && visible(el) && !list.includes(el)) list.push(el)
    return list.filter((el) => !el.disabled)
  }
  // まだ押していない要素を先に押し、なくなったら、押して画面が変わった要素をもう一度押す。
  // 2 回目まで押すのは、「次の問題」を押すたびにリスナーが増えるような、2 回目から出る誤りがあるため
  const nextTarget = (counts) => {
    const list = candidates()
    const fresh = list.find((el) => !counts[idOf(el)])
    if (fresh) return [fresh]
    const again = list.find((el) => {
      const c = counts[idOf(el)]
      return c && c.n < 2 && c.changed
    })
    return again ? [again] : []
  }
  const hoverTargets = (limit) => {
    const selectors = []
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText && rule.selectorText.includes(':hover')) {
          for (const s of rule.selectorText.split(',')) if (s.includes(':hover')) selectors.push(s.replace(/:hover/g, '').trim() || '*')
        }
        if (rule.cssRules) visit(rule.cssRules)
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules)
      } catch {}
    }
    const found = []
    for (const s of selectors) {
      let el = null
      try {
        el = document.querySelector(s)
      } catch {}
      if (el && !found.includes(el) && visible(el)) found.push(el)
      if (found.length >= limit) break
    }
    return found
  }
  const look = (el) => {
    const cs = getComputedStyle(el)
    return ['color', 'background-color', 'border-top-color', 'box-shadow', 'transform', 'opacity', 'text-decoration-line', 'cursor'].map((k) => k + ':' + cs.getPropertyValue(k))
  }
  const notes = []
  // 学生のハンドラが止めなかったフォームの送信とリンクの移動だけを止めるのは、止めないとページが読み込み直され、続きの操作を試せないため
  addEventListener('submit', (e) => {
    if (e.defaultPrevented) return
    e.preventDefault()
    notes.push('フォームが送信された（既定の送信。読み込み直しは止めた）')
  })
  addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null
    if (!a || e.defaultPrevented || a.getAttribute('href').startsWith('#')) return
    e.preventDefault()
    notes.push('リンク先へ移動しようとした: ' + clip(a.getAttribute('href'), 80))
  })
  const label = (el) => {
    const text = clip((el.innerText || el.value || '').replace(/\\s+/g, ' ').trim(), 40)
    return describe(el) + (text ? ' 「' + text + '」' : '')
  }
  window.__step = { layout, state, diff, others, extra, nextTarget, idOf, hoverTargets, look, label, notes }
})()`

// ---------------------------------------------------------------- 1 回分の実行

function newRecord() {
  return { status: 'ok', views: [], timeline: [], hovers: [], clicks: [], console: [], notes: [], durationMs: 0 }
}

// data: の URL で開かないのは、提出の中の画像（images/mug.jpg など）の読み込み先がなく、壊れた画像として文字の幅で描かれて、
// width:100% などのスタイルが効いているかを測れないため。届かない名前のオリジンで開き、要求をすべてここで返す
const PAGE_ORIGIN = 'https://submission.step-learn.invalid/'
const PAGE_URL = `${PAGE_ORIGIN}index.html`
const PLACEHOLDER_IMAGE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d0d4da"/></svg>',
).toString('base64')
const PLACEHOLDER_NOTE = '提出の中の画像は読み込めないので、幅 640px・高さ 480px の灰色の画像に置き換えて開いた'

async function session(cdp, record, document) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => cdp.send(method, params, sessionId)
  let clickNotes = null
  const note = (text) => (clickNotes ?? record.notes).push(text)
  cdp.on((message) => {
    if (message.sessionId !== sessionId) return
    const { method, params } = message
    if (method === 'Runtime.consoleAPICalled') {
      if (record.console.length >= MAX_CONSOLE) return
      const level = params.type === 'error' || params.type === 'assert' ? 'error' : params.type === 'warning' ? 'warn' : 'log'
      const text = params.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ')
      record.console.push({ level, text: clip(text) })
    } else if (method === 'Runtime.exceptionThrown') {
      if (record.console.length >= MAX_CONSOLE) return
      const d = params.exceptionDetails
      record.console.push({ level: 'error', text: clip(d.exception?.description ?? d.text) })
    } else if (method === 'Page.javascriptDialogOpening') {
      note(`${params.type}: ${clip(params.message, 120)}`)
      page('Page.handleJavaScriptDialog', { accept: true, promptText: '' }).catch(() => {})
    } else if (method === 'Fetch.requestPaused') {
      const { url } = params.request
      const { requestId } = params
      if (url === PAGE_URL) {
        page('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from(document).toString('base64'),
        }).catch(() => {})
      } else if (url === `${PAGE_ORIGIN}favicon.ico`) {
        // 記録に書かないのは、提出のコードではなくブラウザが自分から取りに行くもので、AI の判定には関係がないため
        page('Fetch.fulfillRequest', { requestId, responseCode: 404 }).catch(() => {})
      } else if (params.resourceType === 'Image' && url.startsWith(PAGE_ORIGIN)) {
        if (!record.notes.includes(PLACEHOLDER_NOTE)) record.notes.push(PLACEHOLDER_NOTE)
        page('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }],
          body: PLACEHOLDER_IMAGE,
        }).catch(() => {})
      } else {
        note(`外部の読み込みを止めた: ${clip(url, 120)}`)
        page('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {})
      }
    }
  })
  await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await Promise.all([page('Page.enable'), page('Runtime.enable'), page('DOM.enable')])
  await page('CSS.enable')
  await page('Emulation.setEmulatedMedia', {
    features: [
      { name: 'hover', value: 'hover' },
      { name: 'pointer', value: 'fine' },
      { name: 'prefers-color-scheme', value: 'light' },
    ],
  })
  const { frameTree } = await page('Page.getFrameTree')
  const frameId = frameTree.frame.id

  const evaluate = async (contextId, expression) => {
    const r = await page('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const handles = async (contextId, expression) => {
    const r = await page('Runtime.evaluate', { expression, contextId })
    if (r.exceptionDetails || !r.result.objectId) return []
    const { result } = await page('Runtime.getProperties', { objectId: r.result.objectId, ownProperties: true })
    return result.filter((p) => /^\d+$/.test(p.name) && p.value?.objectId).map((p) => p.value.objectId)
  }
  const call = async (objectId, fn) => {
    const r = await page('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: fn,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  const open = async (url, viewport) => {
    await page('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    const loaded = cdp.waitFor((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired', LOAD_MS)
    await page('Page.navigate', { url })
    if (!(await loaded)) note('読み込みが 5 秒で終わらなかった')
    await sleep(SETTLE_MS)
    const { executionContextId } = await page('Page.createIsolatedWorld', { frameId, worldName: 'step-learn-record' })
    await evaluate(executionContextId, PAGE_HELPERS)
    return executionContextId
  }

  return { page, evaluate, handles, call, open, setClickNotes: (list) => (clickNotes = list) }
}

async function run(cdp, html, record) {
  const s = await session(cdp, record, html)
  const url = PAGE_URL

  let ctx = await s.open(url, WIDE)
  record.views.push({ ...WIDE, ...(await s.evaluate(ctx, '__step.layout(120)')) })

  const start = await s.evaluate(ctx, '__step.state()')
  await sleep(TIMELINE_MS)
  record.timeline = await s.evaluate(ctx, `__step.diff(${JSON.stringify(start)}, __step.state(), 10)`)

  await s.page('DOM.getDocument', { depth: 0 })
  for (const objectId of (await s.handles(ctx, `__step.hoverTargets(${MAX_HOVERS})`)).slice(0, MAX_HOVERS)) {
    const target = await s.call(objectId, 'function () { return __step.label(this) }')
    const before = await s.call(objectId, 'function () { return __step.look(this) }')
    const { nodeId } = await s.page('DOM.requestNode', { objectId })
    await s.page('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })
    const after = await s.call(objectId, 'function () { return __step.look(this) }')
    await s.page('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
    const changes = after.flatMap((v, i) => (v === before[i] ? [] : [`${before[i]} → ${v}`]))
    record.hovers.push({ target, changes })
  }

  // click のリスナーを足しただけの div なども押すのは、ボタン以外を押させる課題（カードを押すと開くなど）があるため
  let extra = 0
  for (const objectId of await s.handles(ctx, '__step.others()')) {
    if (extra >= MAX_CLICKS) break
    const { listeners } = await s.page('DOMDebugger.getEventListeners', { objectId })
    if (!listeners.some((l) => ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].includes(l.type))) continue
    await s.call(objectId, 'function () { __step.extra.add(this) }')
    extra++
  }
  const counts = {}
  for (let i = 0; i < MAX_CLICKS; i++) {
    const [objectId] = await s.handles(ctx, `__step.nextTarget(${JSON.stringify(counts)})`)
    if (!objectId) break
    const id = await s.call(objectId, 'function () { return __step.idOf(this) }')
    const target = await s.call(objectId, 'function () { return __step.label(this) }')
    const notes = []
    s.setClickNotes(notes)
    const before = await s.evaluate(ctx, '__step.state()')
    const consoleBefore = record.console.length
    await s.call(objectId, 'function () { this.click() }').catch(() => notes.push('押せなかった'))
    await sleep(CLICK_SETTLE_MS)
    const changes = await s.evaluate(ctx, `__step.diff(${JSON.stringify(before)}, __step.state(), 12)`)
    const pageNotes = await s.evaluate(ctx, '__step.notes.splice(0)')
    s.setClickNotes(null)
    record.clicks.push({
      target,
      changes,
      notes: [...notes, ...pageNotes],
      console: record.console.slice(consoleBefore).map((c) => `${c.level}: ${c.text}`),
    })
    counts[id] = { n: (counts[id]?.n ?? 0) + 1, changed: !!counts[id]?.changed || changes.length > 0 }
  }
  record.notes.push(...(await s.evaluate(ctx, '__step.notes.splice(0)')))

  ctx = await s.open(url, NARROW)
  record.views.push({ ...NARROW, ...(await s.evaluate(ctx, '__step.layout(120)')) })
}

async function render(html) {
  const started = Date.now()
  const record = newRecord()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-'))
  const child = spawn(CHROMIUM, [...FLAGS, `--user-data-dir=${profile}`], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    detached: true,
    env: { HOME: profile, TMPDIR: os.tmpdir(), LANG: 'ja_JP.UTF-8', PATH: process.env.PATH },
  })
  const cdp = new Cdp(child.stdio[3], child.stdio[4])
  let timer
  try {
    const timeout = new Promise((resolve) => (timer = setTimeout(() => resolve('timeout'), RENDER_MS)))
    const result = await Promise.race([run(cdp, html, record).then(() => 'ok'), timeout])
    if (result === 'timeout') record.status = 'timeout'
  } catch (e) {
    record.status = 'error'
    record.notes.push(clip(e instanceof Error ? e.message : String(e), 200))
  } finally {
    clearTimeout(timer)
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
    fs.rmSync(profile, { recursive: true, force: true })
  }
  record.durationMs = Date.now() - started
  return record
}

// ---------------------------------------------------------------- 待ち受け

let running = 0
let pending = 0
const waiters = []

async function acquire() {
  if (running < SLOTS) {
    running++
    return true
  }
  if (pending >= MAX_PENDING) return false
  pending++
  return new Promise((resolve) => {
    const waiter = () => {
      clearTimeout(timer)
      pending--
      resolve(true)
    }
    const timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(waiter), 1)
      pending--
      resolve(false)
    }, QUEUE_MS)
    waiters.push(waiter)
  })
}

function release() {
  const next = waiters.shift()
  if (next) next()
  else running--
}

const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true })
  if (req.method !== 'POST' || req.url !== '/render') return reply(res, 404, { error: 'not_found' })
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return reply(res, 413, { error: 'too_large' })
    chunks.push(chunk)
  }
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return reply(res, 400, { error: 'invalid' })
  }
  if (typeof body?.html !== 'string') return reply(res, 400, { error: 'invalid' })
  if (Buffer.byteLength(body.html) > MAX_DOCUMENT_BYTES) return reply(res, 413, { error: 'too_large' })
  if (!(await acquire())) return reply(res, 503, { error: 'busy' })
  try {
    reply(res, 200, await render(body.html))
  } catch (e) {
    console.error('browser:', e)
    reply(res, 500, { error: 'failed' })
  } finally {
    release()
  }
}

function serve() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('browser:', e)
      if (!res.headersSent) reply(res, 500, { error: 'failed' })
    })
  })
  server.requestTimeout = 60_000
  if (LISTEN.startsWith('tcp:')) {
    server.listen(Number(LISTEN.slice('tcp:'.length)), '0.0.0.0')
  } else {
    const socket = LISTEN.slice('unix:'.length)
    fs.rmSync(socket, { force: true })
    // アプリの利用者（グループ 1000）だけがつなげるようにするのは、ほかの利用者から実行を頼まれないようにするため
    const previous = process.umask(0o117)
    server.listen(socket, () => process.umask(previous))
  }
  console.log(`browser: listening on ${LISTEN}`)
}

function health() {
  const target = LISTEN.startsWith('tcp:')
    ? { host: '127.0.0.1', port: Number(LISTEN.slice('tcp:'.length)) }
    : { socketPath: LISTEN.slice('unix:'.length) }
  const req = http.request({ ...target, path: '/health', method: 'GET', timeout: 4000 }, (res) => {
    res.resume()
    process.exit(res.statusCode === 200 ? 0 : 1)
  })
  req.on('error', () => process.exit(1))
  req.on('timeout', () => process.exit(1))
  req.end()
}

if (process.argv[2] === 'serve') serve()
else if (process.argv[2] === 'health') health()
else {
  console.error('usage: server.mjs serve | health')
  process.exit(2)
}
