// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュールを import しない

/** ファイル自動配布のアイテムの種類の名前。通常モードの items.type と、Moodle モードの extra_items.type に使う */
export const BUNDLE_KIND = 'bundle'

/** Moodle モードで、ファイル自動配布のアイテムの位置に置く Moodle の活動（moodle/mod_stepbundle）の名前 */
export const BUNDLE_MODULE = 'stepbundle'

/** VS Code の拡張機能（vscode-extension/）の ID。publisher を変えたら vscode-extension/package.json と合わせる */
export const VSCODE_EXTENSION_ID = 'mint1535.step-learn-for-vscode'

export const VSCODE_EXTENSION_NAME = 'STEP Learn for VSCode'

export const VSCODE_MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${VSCODE_EXTENSION_ID}`

/** アイテムの URL の下の、ファイル自動配布の操作の URL（/courses/:id/items/:iid/bundle） */
export const bundleBase = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/bundle`

/** アイテム 1 つに置けるファイルの数と合計の大きさ */
export const MAX_BUNDLE_FILES = 500
export const MAX_BUNDLE_SIZE = 50 * 1024 * 1024

/** 配布するファイル 1 つ。fileKey はストレージのキー */
export type BundleFile = { path: string; fileKey: string; size: number; sha256: string }

/** モードごとの、アイテム 1 つの配布するファイルの置き場所 */
export type BundleStore = {
  list: () => BundleFile[]
  /** 同じ場所のファイルは置き換える。置き換えて要らなくなったストレージのキーを返す */
  put: (files: BundleFile[]) => string[]
  /** 消したファイルのストレージのキーを返す */
  remove: (match: (path: string) => boolean) => string[]
}
