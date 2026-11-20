/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 読み込むだけでは何もしない（イベントを登録しない）ので、動的に読み込むエディターなどからも import してよい

export const $$ = <T extends Element>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)]

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** JSON で答えるように頼んで送る。サーバーは Accept を見て、リダイレクトの代わりに JSON を返す（lib/http.ts の wantsJson） */
export const fetchJson = (input: RequestInfo | URL, init: RequestInit = {}) =>
  fetch(input, { ...init, headers: { Accept: 'application/json', ...init.headers } })
