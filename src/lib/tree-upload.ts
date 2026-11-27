// 通常モードと Moodle モードの両方（ファイル自動配布）が読み込むので、DB を開くモジュールを import しない
import type { Context } from 'hono'
import { formatBytes } from './bytes'
import { conflictingPath, isExcludedPath, isInFolder, safeSegment, samePath, treePath, treeSize, type TreeFile } from './file-tree'
import { firstError, validate } from './forms'
import { readFields, readForm } from './http'
import { isExecutable } from './storage'
import { ZipError, listZip, zipStream, type ZipItem } from './zip'

/** フォルダーの中の場所を付けて受け取ったファイル */
type TreeUpload = { path: string; file: File }

/** アイテム 1 つに置けるファイルの数と合計の大きさ */
type TreeLimits = { maxFiles: number; maxSize: number }

type Picked = { name: string; file: File }
type Read<T> = ({ ok: true } & T) | { ok: false; error: string }

/** zip の中身がすべて 1 つのフォルダーに入っていれば、そのフォルダーを外した場所 */
function withoutWrapper(paths: string[]) {
  const top = paths[0]?.split('/')[0]
  // そのまま置かないのは、フォルダーを圧縮した zip だとフォルダーが 1 段深くなるため（フォルダーを選んだときも、そのフォルダーの名前は外す）
  const wrapped = !!top && paths.every((p) => p.startsWith(`${top}/`))
  return wrapped ? paths.map((p) => p.slice(top.length + 1)) : paths
}

// 書かれた大きさで先に確かめるのは、上限を超える zip を展開してメモリを使わないため
async function unpack(archive: File, earlier: File[], limits: TreeLimits): Promise<Read<{ picked: Picked[]; skipped: number }>> {
  let items: ZipItem[]
  try {
    items = await listZip(new Uint8Array(await archive.arrayBuffer()))
  } catch (e) {
    if (e instanceof ZipError) return { ok: false, error: `「${archive.name}」を展開できませんでした。${e.message}` }
    throw e
  }
  const usable = items.filter((i) => !isExcludedPath(i.path.replace(/\\/g, '/')))
  if (earlier.length + usable.length > limits.maxFiles) return { ok: false, error: `ファイルは ${limits.maxFiles} 個までです。` }
  if (treeSize([...earlier, ...usable]) > limits.maxSize)
    return { ok: false, error: `ファイルの合計は ${formatBytes(limits.maxSize)} までです。` }
  const names = withoutWrapper(usable.map((i) => i.path.replace(/\\/g, '/')))
  const picked: Picked[] = []
  for (const [i, item] of usable.entries()) {
    try {
      picked.push({ name: names[i], file: new File([await item.read()], names[i].split('/').pop()!) })
    } catch (e) {
      if (e instanceof ZipError) return { ok: false, error: `「${archive.name}」の「${item.path}」を展開できませんでした。${e.message}` }
      throw e
    }
  }
  return { ok: true, picked, skipped: items.length - usable.length }
}

/**
 * フォルダーごとのアップロード（components/file-tree.tsx の TreeUploadForm）を読む。zip は展開し、.git などは外して数える。
 * 1 つずつ確かめるのは、どのファイルで止めたかを教師に伝えるため
 */
export async function readTreeUploads(c: Context, limits: TreeLimits): Promise<Read<{ uploads: TreeUpload[]; skipped: number }>> {
  // readFields を使わないのは、同じ名前の欄が並ぶとき、最後の 1 つしか受け取れないため
  const result = validate('treeUpload', await readForm(c, { all: true }))
  if (!result.ok) return { ok: false, error: firstError(result.errors) }
  const { files, paths, archives } = result.values
  if (!files.length && !archives.length) return { ok: false, error: 'アップロードするファイルを選択してください。' }
  const picked: Picked[] = files.map((file, i) => ({ name: paths[i] || file.name, file }))
  // すでに置いてあるファイルを足さないのは、このあとのファイルで置き換えられるかがまだわからないため（置いたあとの合計は treeUploadProblem で確かめる）
  const earlier = picked
    .filter(({ name }) => {
      const path = treePath(name)
      return !!path && !isExcludedPath(path)
    })
    .map((p) => p.file)
  // ブラウザが外した数も足すのは、node_modules などを送らずに済ませつつ、外した数をまとめて伝えるため
  let skipped = result.values.skipped
  for (const archive of archives) {
    const read = await unpack(archive, earlier, limits)
    if (!read.ok) return read
    picked.push(...read.picked)
    earlier.push(...read.picked.map((p) => p.file))
    skipped += read.skipped
  }
  const uploads: TreeUpload[] = []
  for (const { name, file } of picked) {
    const path = treePath(name)
    if (!path) return { ok: false, error: `「${name}」は、ファイルの名前か場所に使えない文字が含まれています。` }
    if (isExcludedPath(path)) {
      skipped++
      continue
    }
    if (await isExecutable(file)) return { ok: false, error: `「${path}」は実行ファイルのため、アップロードできません。` }
    if (uploads.some((u) => samePath(u.path, path))) return { ok: false, error: `「${path}」が 2 つあります。` }
    uploads.push({ path, file })
  }
  if (!uploads.length)
    return { ok: false, error: 'アップロードできるファイルがありませんでした（.git や node_modules などは外しています）。' }
  return { ok: true, uploads, skipped }
}

/** 置いてあるファイルに uploads を足して（同じ場所は置き換えて）上限を超えるか、ファイルとフォルダーがぶつかるときの文言 */
export function treeUploadProblem(existing: TreeFile[], uploads: TreeUpload[], limits: TreeLimits) {
  const kept = existing.filter((f) => !uploads.some((u) => samePath(u.path, f.path)))
  const paths = [...kept.map((f) => f.path), ...uploads.map((u) => u.path)]
  if (paths.length > limits.maxFiles) return `ファイルは ${limits.maxFiles} 個までです。`
  if (treeSize(kept) + uploads.reduce((sum, u) => sum + u.file.size, 0) > limits.maxSize)
    return `ファイルの合計は ${formatBytes(limits.maxSize)} までです。`
  const conflict = conflictingPath(paths)
  return conflict ? `「${conflict}」は、同じ名前のファイルとフォルダーがぶつかっています。` : null
}

/** 削除のフォーム（ファイル 1 つ・フォルダー 1 つ・すべて）を読み、消す場所を選ぶ関数と、知らせる文言を返す。読めなければ null */
export async function readTreeRemove(c: Context) {
  const fields = await readFields(c, 'treeRemove')
  if (!fields) return null
  const { path, folder } = fields
  const all = fields.all === 1
  if (!path && !folder && !all) return null
  return {
    match: (p: string) => all || (!!path && samePath(p, path)) || (!!folder && isInFolder(p, folder)),
    message: all ? 'すべてのファイルを削除しました。' : `「${path || folder}」を削除しました。`,
  }
}

/** ファイルをまとめた zip を、title の名前のフォルダーに入れて返す */
export function treeZip(c: Context, title: string, files: { path: string; read: () => Promise<Uint8Array> }[]) {
  const folder = safeSegment(title, 80)
  c.header('Content-Type', 'application/zip')
  c.header('Content-Disposition', `attachment;filename*=UTF-8''${encodeURIComponent(`${folder}.zip`)}`)
  c.header('Cache-Control', 'private, no-store')
  return c.body(zipStream(files.map((f) => ({ path: `${folder}/${f.path}`, read: f.read }))))
}
