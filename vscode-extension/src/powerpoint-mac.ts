// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import {
  NO_PRESENTATION,
  PowerPointError,
  eachLine,
  fileNotOpen,
  parseState,
  type Deck,
  type DeckSlide,
  type PowerPoint,
  type ShowState,
} from './powerpoint'

// PowerPoint が動いていないときに tell しないのは、tell するだけで PowerPoint が起動するため。
// 書き出し先を POSIX file にするのは、文字列のパスで渡すと、成功と返るのにファイルができないため。
// 書き出しを JXA（下の WATCH_SCRIPT と同じ JavaScript）で書かないのは、JXA の save では、開いているファイルが書き出した PDF の名前に付け替わるため
const EXPORT_SCRIPT = `on run argv
	if application "Microsoft PowerPoint" is not running then return "closed"
	set dest to POSIX file (item 1 of argv)
	set wanted to item 2 of argv
	tell application "Microsoft PowerPoint"
		if (count of presentations) is 0 then return "none"
		set p to missing value
		if wanted is not "" then
			repeat with i from 1 to count of presentations
				if full name of presentation i is wanted then
					set p to presentation i
					exit repeat
				end if
			end repeat
			if p is missing value then return "missing"
		else if (count of slide show windows) > 0 then
			set p to presentation of slide show window 1
		else
			set p to active presentation
		end if
		set resultLines to {"ok", full name of p, name of p}
		set n to count of slides of p
		repeat with i from 1 to n
			set s to slide i of p
			set fx to count of effects of main sequence of timeline of s
			set total to 0
			repeat with j from 1 to fx
				set total to total + (duration of timing of effect j of main sequence of timeline of s)
			end repeat
			set end of resultLines to ((slide ID of s) as text) & tab & ((hidden of slide show transition of s) as text) & tab & ((print steps of s) as text) & tab & (total as text) & tab & ((count of sequences of timeline of s) as text)
		end repeat
		save p in dest as save as PDF
	end tell
	set AppleScript's text item delimiters to linefeed
	return resultLines as text
end run`

// osascript を読むたびに起動しないのは、起動だけで 0.1 秒ほどかかり、0.5 秒おきに読むには重いため。起動したまま 1 行ずつ JSON を書き出す。
// 親のプロセスを確かめるのは、VS Code が終了したあとも読み続けないため（親がいなくなると、親の番号が 1 になる）
const WATCH_SCRIPT = `ObjC.import('Foundation')
ObjC.import('unistd')
ObjC.import('stdlib')
function write(o) {
  const data = $.NSString.alloc.initWithUTF8String(JSON.stringify(o) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data)
}
function read(app, file) {
  if (!app.running()) return { state: 'closed' }
  let otherShow = false
  for (let i = 0; i < app.slideShowWindows.length; i++) {
    const win = app.slideShowWindows[i]
    if (win.presentation.fullName() !== file) {
      otherShow = true
      continue
    }
    let slideId = null
    try {
      slideId = win.slideshowView.slide.slideID()
    } catch (e) {}
    return { state: 'show', slideId: slideId, click: null, clicks: null, saved: win.presentation.saved() }
  }
  for (let i = 0; i < app.presentations.length; i++) {
    const p = app.presentations[i]
    if (p.fullName() === file) return { state: 'idle', saved: p.saved(), otherShow: otherShow }
  }
  return { state: 'absent', otherShow: otherShow }
}
function run(argv) {
  const app = Application('Microsoft PowerPoint')
  for (;;) {
    if ($.getppid() === 1) $.exit(0)
    try {
      write(read(app, argv[0]))
    } catch (e) {
      write({ state: 'error', message: String(e) })
    }
    delay(0.5)
  }
}`

/** macOS が、VS Code から PowerPoint を操作することを止めたときの失敗 */
const NOT_AUTHORIZED = /-1743|not authorized|許可されていません/i

const AUTOMATION_HELP =
  'PowerPoint を操作する許可がありません。システム設定の「プライバシーとセキュリティ」→「オートメーション」で、Visual Studio Code に Microsoft PowerPoint の操作を許可してください。'

/** 許可の画面を待っていると判断するまでの時間 */
const WAITING_AFTER = 4000
/** PowerPoint の許可の画面は、答えるまで書き出しを止める。先生が画面に気づいて答えるまで待つ */
const EXPORT_TIMEOUT = 120_000
/** PowerPoint が書き出しを終えたと返してから、ファイルができるまで待つ時間 */
const FILE_WAIT = 5000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 小数点がカンマの言語の Mac では 1,5 のように返るので、ピリオドにそろえてから読む
const number = (s: string) => Number(s.replace(',', '.')) || 0

function parseSlide(line: string): DeckSlide {
  const [id, hidden, steps, tail, sequences] = line.split('\t')
  // print steps は、クリックで進む回数より 1 多い（クリックの前の状態も 1 枚に数える）
  return {
    id: number(id),
    hidden: hidden === 'true',
    clicks: Math.max(0, number(steps) - 1),
    tail: number(tail),
    triggers: number(sequences) > 0,
  }
}

export class MacPowerPoint implements PowerPoint {
  async exportPdf(target: string, onWaiting: () => void, source: Deck | null): Promise<Deck> {
    // 前の PDF を消しておくのは、書き出せなかったときに、前のファイルを新しく書き出したものと取り違えないため
    await fs.rm(target, { force: true })
    const waiting = setTimeout(onWaiting, WAITING_AFTER)
    const output = await new Promise<string>((resolve, reject) => {
      execFile('osascript', ['-e', EXPORT_SCRIPT, target, source?.file ?? ''], { timeout: EXPORT_TIMEOUT }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if (NOT_AUTHORIZED.test(stderr)) return reject(new PowerPointError(AUTOMATION_HELP))
        if (error.killed)
          return reject(
            new PowerPointError('PowerPoint から応答がありません。PowerPoint に確認の画面が出ていたら、答えてからもう一度お試しください。'),
          )
        reject(new PowerPointError(`PowerPoint から PDF を書き出せませんでした（${stderr.trim() || error.message}）。`))
      })
    }).finally(() => clearTimeout(waiting))
    const [result, file, name, ...lines] = output.trim().split('\n')
    if (source && (result === 'closed' || result === 'none' || result === 'missing')) throw new PowerPointError(fileNotOpen(source))
    if (result === 'closed' || result === 'none') throw new PowerPointError(NO_PRESENTATION)
    if (result !== 'ok' || !file) throw new PowerPointError('PowerPoint から受け取った内容が正しくありません。')
    // ファイルができたかを確かめるのは、PowerPoint にフォルダーへの書き込みを断られても、書き出しは成功と返るため
    for (let waited = 0; waited < FILE_WAIT; waited += 250) {
      const stat = await fs.stat(target).catch(() => null)
      if (stat?.size) return { file, name, slides: lines.map(parseSlide) }
      await sleep(250)
    }
    throw new PowerPointError(
      'PDF を書き出せませんでした。PowerPoint に「Grant File Access」の画面が出たら、「Select…」を押してフォルダーを許可してください（最初の 1 回だけです）。',
    )
  }

  watch(file: string, onState: (state: ShowState) => void, onExit: () => void) {
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', WATCH_SCRIPT, file], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on(
      'data',
      eachLine((line) => {
        const state = parseState(line)
        if (!state) return
        onState(state.state === 'error' && NOT_AUTHORIZED.test(state.message) ? { state: 'error', message: AUTOMATION_HELP } : state)
      }),
    )
    let disposed = false
    child.on('exit', () => disposed || onExit())
    child.on('error', () => disposed || onExit())
    return {
      dispose() {
        disposed = true
        child.kill()
      },
    }
  }
}
