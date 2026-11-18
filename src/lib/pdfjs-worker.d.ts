// pdf.js は worker のモジュールに型を付けていないので、使う分だけを書く
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
