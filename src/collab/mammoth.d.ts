// mammoth はブラウザ向けのビルド（mammoth.browser.js）に型を付けていないので、使う分だけを書く
declare module 'mammoth/mammoth.browser' {
  type Image = { contentType: string; readAsArrayBuffer: () => Promise<ArrayBuffer> }
  type ImageConverter = { readonly __converter: unique symbol }
  type Options = { styleMap?: string[]; convertImage?: ImageConverter; includeDefaultStyleMap?: boolean }
  const mammoth: {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options?: Options) => Promise<{ value: string; messages: unknown[] }>
    images: { imgElement: (f: (image: Image) => Promise<Record<string, string>>) => ImageConverter }
  }
  export default mammoth
}
