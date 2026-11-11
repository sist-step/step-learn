import { build } from 'esbuild'

// 1 ファイルにまとめるのは、拡張機能のパッケージに node_modules を含めずに済ませるため（実行時の依存はない）
await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  minify: true,
  sourcemap: false,
})
