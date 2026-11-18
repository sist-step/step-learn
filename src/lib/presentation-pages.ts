// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュールを import しない
import type { PresentationState } from './presentation'
import { presentationPageKey, storage, type ServeOptions } from './storage'

// 起動時に読み込まないのは、pdf.js が大きく、発表ファイルを使わないあいだもサーバーのメモリを使うため
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')])
  // worker のファイルを pdf.js に探させないのは、サーバーのコードをバンドルしていて、node_modules の場所から読み込めないため
  Object.assign(globalThis, { pdfjsWorker: worker })
  return pdfjs
}

/** PDF を 1 ページずつのファイルに分けて保存し、分けたページ数を返す。読み取れない PDF は例外になる */
export async function splitPresentationPdf(fileKey: string, data: Uint8Array, maxPages: number) {
  const { getDocument } = await loadPdfjs()
  const loading = getDocument({ data, verbosity: 0 })
  try {
    const doc = await loading.promise
    const count = Math.min(doc.numPages, maxPages)
    for (let page = 1; page <= count; page++) {
      const part = await doc.extractPages([{ document: null, includePages: [page - 1] }])
      const key = presentationPageKey(fileKey, page)
      // 直接書かないのは、書いている途中で止まると、壊れたページを配り続けることになるため
      await storage.put(`${key}.tmp`, new File([new Uint8Array(part)], 'page.pdf'), 'application/pdf')
      await storage.move(`${key}.tmp`, key)
      // 続けて処理しないのは、ページの多い PDF を分けているあいだ、ほかの人の要求を待たせないため
      await new Promise((resolve) => setImmediate(resolve))
    }
    return count
  } finally {
    await loading.destroy()
  }
}

const splitting = new Map<string, Promise<void>>()

async function splitStored({ fileKey, fileSize, slideIds }: PresentationState) {
  const data = fileKey && (await storage.read(fileKey, fileSize))
  if (fileKey && data) await splitPresentationPdf(fileKey, new Uint8Array(data), slideIds.length)
}

function splitOnce(state: PresentationState) {
  const key = state.fileKey!
  const running =
    splitting.get(key) ??
    splitStored(state)
      .catch((e) => console.error('[presentation]', e))
      .finally(() => splitting.delete(key))
  splitting.set(key, running)
  return running
}

/** 1 ページ分の PDF のレスポンス。公開の範囲かどうかは呼び出し側で確かめる */
export async function servePresentationPage(state: PresentationState, page: number, opts: ServeOptions) {
  if (!state.fileKey) return null
  const key = presentationPageKey(state.fileKey, page)
  await splitting.get(state.fileKey)
  const res = await storage.serve(key, opts)
  if (res) return res
  // アップロードのときに必ず分けるだけにしないのは、ページごとに配る前に上げた PDF が残っているため
  await splitOnce(state)
  return storage.serve(key, opts)
}
