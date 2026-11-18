import * as vscode from 'vscode'

const NOTICE_DURATION = 8000

// showInformationMessage を使わないのは、VS Code が前面にないあいだは表示時間が進まず、PowerPoint で発表している間ずっと消えないため。
// increment を 100 にするのは、指定しないと処理中の帯が動き続け、待たされているように見えるため
export function showNoticeUntil(message: string, done: Promise<unknown>) {
  void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: message }, async (progress) => {
    progress.report({ increment: 100 })
    await done
  })
}

export const showNotice = (message: string) => showNoticeUntil(message, new Promise((resolve) => setTimeout(resolve, NOTICE_DURATION)))
