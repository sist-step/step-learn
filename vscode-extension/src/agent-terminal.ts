import * as vscode from 'vscode'
import { stripAnsi, type TerminalRun } from './agent-core'

const MAX_RUNS = 3

/** 1 回の実行で覚えておく出力の長さ（色などの制御文字を除く前） */
const MAX_RAW_OUTPUT = 64 * 1024

type Run = { execution: vscode.TerminalShellExecution; command: string; raw: string; exitCode: number | undefined; running: boolean }

/** 学生が VS Code のターミナルで実行したコマンドと出力を覚えておき、AI が「エラーが出た」の中身を確かめられるようにする */
export class TerminalRecorder {
  private runs: Run[] = []
  private active = false

  // いつも覚えておかないのは、コーディングエージェントを使わない人のターミナルの内容まで、拡張機能が持たないようにするため
  /** 使えるコーディングエージェントがあるあいだだけ覚える。なくなったら、覚えた分を捨てる */
  setActive(active: boolean) {
    this.active = active
    if (!active) this.runs = []
  }

  start(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((e) => void this.record(e.execution)),
      vscode.window.onDidEndTerminalShellExecution((e) => {
        const run = this.runs.find((r) => r.execution === e.execution)
        if (!run) return
        run.exitCode = e.exitCode
        run.running = false
      }),
    )
  }

  private async record(execution: vscode.TerminalShellExecution) {
    const command = execution.commandLine.value.trim()
    if (!this.active || !command) return
    const run: Run = { execution, command, raw: '', exitCode: undefined, running: true }
    this.runs.push(run)
    if (this.runs.length > MAX_RUNS) this.runs.shift()
    try {
      // 頭ではなく末尾を残すのは、エラーの内容（トレースバックなど）が出力の最後に出るため
      for await (const data of execution.read()) run.raw = (run.raw + data).slice(-MAX_RAW_OUTPUT)
    } catch {
      run.running = false
    }
  }

  /** 最近実行したコマンド。新しいものが最後 */
  recent(): TerminalRun[] {
    return this.runs.map((r) => ({ command: r.command, output: stripAnsi(r.raw).trim(), exitCode: r.exitCode, running: r.running }))
  }
}
