// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { jpegsToPdf } from './jpeg-pdf'
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

const IMAGE_WIDTH = 1920

// 出力を UTF-8 にそろえるのは、Windows PowerShell の既定がその PC の文字コード（日本語なら Shift_JIS）で、ファイル名が文字化けするため
const PRELUDE = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
function HResultOf($err) { $e = $err.Exception; if ($e.InnerException) { $e = $e.InnerException }; return $e.HResult }
`

// PowerPoint が動いていないときの失敗（MK_E_UNAVAILABLE）
const NOT_RUNNING = '-2147221021'

// ExportAsFixedFormat の引数は、順に、PDF（2）・印刷用（2）・枠なし・配布資料の並び・スライド（1）・非表示のスライドを含めない（0）・
// 範囲の指定なし・すべて（1）・スライドショーの名前なし・文書のプロパティなし・IRM を保つ・タグを付ける・埋め込めないフォントは画像にする・PDF/A にしない。
// 範囲の指定（PrintRange）を省かず Nothing を渡すのは、省くと型の不一致で失敗するため。InvokeMember を使うのは、PowerShell の型の変換を通さずに Nothing を渡すため。
// 失敗したときに開いているファイルを直接 PDF にしないのは、SaveCopyAs の PDF 指定は Windows の実機で失敗し、SaveAs は開いているファイルに影響しかねないため。
// 複製の印刷の設定を変えるのは、SaveAs には非表示のスライドを除く引数がなく、ページとスライドの対応がずれないようにするため。
// 読み取り専用のファイルで複製を試さないのは、この PC にないフォントのために読み取り専用になったファイルは保存できないため。
// 画像で書き出すのを最初から選ばないのは、PDF の文字を選べなくなり、ファイルも大きくなるため
const EXPORT_SCRIPT = `${PRELUDE}
function MessageOf($err) { return $err.Exception.GetBaseException().Message }
function ExportViaCopy($p, $target) {
  $ext = [IO.Path]::GetExtension($p.Name)
  if (-not $ext) { $ext = '.pptx' }
  $copyPath = Join-Path ([IO.Path]::GetTempPath()) ('step-learn-' + [Guid]::NewGuid().ToString('N') + $ext)
  $copy = $null
  try {
    $p.SaveCopyAs($copyPath)
    $copy = $p.Application.Presentations.Open($copyPath, -1, 0, 0)
    $copy.PrintOptions.PrintHiddenSlides = 0
    $copy.SaveAs($target, 32)
  } finally {
    if ($null -ne $copy) { $copy.Close() }
    Remove-Item -LiteralPath $copyPath -Force -ErrorAction SilentlyContinue
  }
}
function ExportImages($p, $imageDir) {
  $width = ${IMAGE_WIDTH}
  $height = [int][Math]::Round($width * $p.PageSetup.SlideHeight / $p.PageSetup.SlideWidth)
  $page = 0
  foreach ($s in $p.Slides) {
    if ($s.SlideShowTransition.Hidden) { continue }
    $page++
    $s.Export((Join-Path $imageDir "$page.jpg"), 'JPG', $width, $height)
  }
}
$target = '__TARGET__'
$imageDir = '__IMAGES__'
$file = '__FILE__'
try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { Emit @{ result = 'closed' }; exit }
try {
  $p = $null
  if ($app.Presentations.Count -eq 0) { Emit @{ result = 'none' }; exit }
  if ($file) {
    foreach ($c in $app.Presentations) { if ($c.FullName -ceq $file) { $p = $c; break } }
    if ($null -eq $p) { Emit @{ result = 'missing' }; exit }
  }
  elseif ($app.SlideShowWindows.Count -gt 0) { $p = $app.SlideShowWindows.Item(1).Presentation }
  else { $p = $app.ActivePresentation }
  $slides = @()
  foreach ($s in $p.Slides) {
    $seq = $s.TimeLine.MainSequence
    $clicks = 0
    $tail = 0.0
    for ($i = 1; $i -le $seq.Count; $i++) {
      $t = $seq.Item($i).Timing
      if ($t.TriggerType -eq 1) { $clicks++; $tail = 0.0 }
      $tail += [double]$t.TriggerDelayTime + [double]$t.Duration
    }
    $slides += @{ id = [int]$s.SlideID; hidden = [bool]$s.SlideShowTransition.Hidden; clicks = $clicks; tail = $tail; triggers = ($s.TimeLine.InteractiveSequences.Count -gt 0) }
  }
  $method = $null
  $failures = @()
  try {
    $nothing = [Runtime.InteropServices.DispatchWrapper]::new($null)
    $exportArgs = [object[]]@($target, 2, 2, 0, 1, 1, 0, $nothing, 1, '', $false, $true, $true, $true, $false)
    [void][System.__ComObject].InvokeMember('ExportAsFixedFormat', [Reflection.BindingFlags]::InvokeMethod, $null, $p, $exportArgs)
    $method = 'export'
  } catch { $failures += "ExportAsFixedFormat: $(MessageOf $_)" }
  if (-not $method -and -not $p.ReadOnly) {
    try { ExportViaCopy $p $target; $method = 'copy' } catch { $failures += "SaveAs: $(MessageOf $_)" }
  }
  if (-not $method) {
    try { ExportImages $p $imageDir; $method = 'images' } catch {
      $failures += "Export: $(MessageOf $_)"
      throw ($failures -join ' / ')
    }
  }
  Emit @{ result = 'ok'; file = [string]$p.FullName; name = [string]$p.Name; method = $method; pageWidth = [double]$p.PageSetup.SlideWidth; pageHeight = [double]$p.PageSetup.SlideHeight; slides = $slides }
} catch { Emit @{ result = 'error'; message = (MessageOf $_) } }
`

// PowerShell を読むたびに起動しないのは、起動に 1 秒近くかかり、0.25 秒おきに読めないため。起動したまま 1 行ずつ JSON を書き出す。
// 親のプロセスを確かめるのは、VS Code が終了したあとも読み続けないため
const WATCH_SCRIPT = `${PRELUDE}
$parent = __PARENT__
$file = '__FILE__'
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  try {
    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
    $w = $null
    $otherShow = $false
    foreach ($s in $app.SlideShowWindows) {
      if ($s.Presentation.FullName -ceq $file) { $w = $s; break }
      $otherShow = $true
    }
    if ($null -eq $w) {
      $p = $null
      foreach ($c in $app.Presentations) { if ($c.FullName -ceq $file) { $p = $c; break } }
      if ($null -eq $p) { Emit @{ state = 'absent'; otherShow = $otherShow } }
      else { Emit @{ state = 'idle'; saved = [bool]$p.Saved; otherShow = $otherShow } }
    } else {
      $v = $w.View
      $id = $null
      $click = $null
      $clicks = $null
      try { $id = [int]$v.Slide.SlideID; $click = [int]$v.GetClickIndex(); $clicks = [int]$v.GetClickCount() } catch {}
      Emit @{ state = 'show'; slideId = $id; click = $click; clicks = $clicks; saved = [bool]$w.Presentation.Saved }
    }
  } catch {
    if ((HResultOf $_) -eq ${NOT_RUNNING}) { Emit @{ state = 'closed' } }
    else { Emit @{ state = 'error'; message = $_.Exception.Message } }
  }
  Start-Sleep -Milliseconds 250
}
`

const EXPORT_TIMEOUT = 120_000
const WAITING_AFTER = 8000

// -EncodedCommand で渡すのは、複数行のスクリプトを引用符の扱いに悩まずに渡せ、スクリプトのファイルの実行を止める設定（ExecutionPolicy）にもかからないため。
// powershell.exe（Windows PowerShell 5.1）を使うのは、PowerShell 7 には、起動中の PowerPoint につなぐ GetActiveObject がないため
const powershellArgs = (script: string) => [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(script, 'utf16le').toString('base64'),
]

// ' のほかの文字も重ねるのは、PowerShell が曲がった引用符も ' と同じに扱い、ファイル名に入っていると文字列がそこで切れるため
const quoted = (s: string) => s.replace(/['‘’‚‛]/g, '$&$&')

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parseSlide(raw: unknown): DeckSlide | null {
  if (!isObject(raw) || typeof raw.id !== 'number') return null
  return {
    id: raw.id,
    hidden: raw.hidden === true,
    clicks: typeof raw.clicks === 'number' ? raw.clicks : 0,
    tail: typeof raw.tail === 'number' ? raw.tail : 0,
    triggers: raw.triggers === true,
  }
}

export class WindowsPowerPoint implements PowerPoint {
  async exportPdf(target: string, onWaiting: () => void, source: Deck | null): Promise<Deck> {
    const imageDir = `${target}.images`
    await fs.rm(target, { force: true })
    await fs.rm(imageDir, { recursive: true, force: true })
    await fs.mkdir(imageDir, { recursive: true })
    try {
      return await this.runExport(target, imageDir, onWaiting, source)
    } finally {
      await fs.rm(imageDir, { recursive: true, force: true })
    }
  }

  private async runExport(target: string, imageDir: string, onWaiting: () => void, source: Deck | null): Promise<Deck> {
    const waiting = setTimeout(onWaiting, WAITING_AFTER)
    // 置き換える文字列を関数で返すのは、文字列で渡すと、パスの中の $& などが特別な意味になるため
    const script = EXPORT_SCRIPT.replace('__TARGET__', () => quoted(target))
      .replace('__IMAGES__', () => quoted(imageDir))
      .replace('__FILE__', () => quoted(source?.file ?? ''))
    const output = await new Promise<string>((resolve, reject) => {
      execFile('powershell.exe', powershellArgs(script), { timeout: EXPORT_TIMEOUT, windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if (error.killed)
          return reject(
            new PowerPointError('PowerPoint から応答がありません。PowerPoint に確認の画面が出ていたら、答えてからもう一度お試しください。'),
          )
        reject(new PowerPointError(`PowerPoint から PDF を書き出せませんでした（${stderr.trim() || error.message}）。`))
      })
    }).finally(() => clearTimeout(waiting))
    let raw: unknown = null
    try {
      raw = JSON.parse(output.trim().split(/\r?\n/).pop() ?? '')
    } catch {}
    if (!isObject(raw)) throw new PowerPointError('PowerPoint から受け取った内容が正しくありません。')
    if (source && (raw.result === 'closed' || raw.result === 'none' || raw.result === 'missing'))
      throw new PowerPointError(fileNotOpen(source))
    if (raw.result === 'closed' || raw.result === 'none') throw new PowerPointError(NO_PRESENTATION)
    if (raw.result !== 'ok' || !Array.isArray(raw.slides) || typeof raw.file !== 'string' || !raw.file)
      throw new PowerPointError(
        `PowerPoint から PDF を書き出せませんでした（${typeof raw.message === 'string' ? raw.message : '理由は分かりません'}）。`,
      )
    const slides = raw.slides.map(parseSlide).filter((s): s is DeckSlide => s !== null)
    if (raw.method === 'images') {
      if (typeof raw.pageWidth !== 'number' || typeof raw.pageHeight !== 'number')
        throw new PowerPointError('PowerPoint から受け取った内容が正しくありません。')
      const pages = slides.filter((s) => !s.hidden).map((_, i) => path.join(imageDir, `${i + 1}.jpg`))
      const jpegs = await Promise.all(pages.map((page) => fs.readFile(page))).catch(() => {
        throw new PowerPointError('スライドの画像を読めませんでした。')
      })
      await fs.writeFile(target, jpegsToPdf(jpegs, { width: raw.pageWidth, height: raw.pageHeight }))
    }
    const stat = await fs.stat(target).catch(() => null)
    if (!stat?.size) throw new PowerPointError('PDF を書き出せませんでした。')
    return { file: raw.file, name: typeof raw.name === 'string' ? raw.name : '', slides }
  }

  watch(file: string, onState: (state: ShowState) => void, onExit: () => void) {
    const script = WATCH_SCRIPT.replace('__PARENT__', String(process.pid)).replace('__FILE__', () => quoted(file))
    const child = spawn('powershell.exe', powershellArgs(script), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.on(
      'data',
      eachLine((line) => {
        const state = parseState(line)
        if (state) onState(state)
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
