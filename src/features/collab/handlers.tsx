// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は CollabBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/collab.ts）
import { Hono, type Context } from 'hono'
import { ownerFor, ownerUserId, userOwner, type CollabSettings, type CollabStore } from './collab'
import type { CourseAccess } from '../../lib/courses'
import { fileField, readForm } from '../../lib/http'
import { imageName, putImage, serveImage } from '../../lib/images'
import type { AppEnv } from '../../lib/types'
import { CollabPage } from './views'

type C = Context<AppEnv>

export type CollabContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  item: { id: number; title: string }
  settings: CollabSettings
  store: CollabStore
}

export type CollabBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら、設定と置き場所を返す。開けなければ null */
  resolve: (c: C) => Promise<CollabContext | null>
}

// 名前を決め打ちで確かめるのは、URL の名前からストレージのキーを組み立てるので、../ などでほかのファイルを指させないため
const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/

export function createCollabHandlers({ resolve }: CollabBackend) {
  async function open(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const { access, item, settings, store } = ctx
    const user = c.var.user!
    const owner = ownerFor(store, settings, { id: user.id, canManage: access.canManage }, c.req.query('owner') ?? '')
    if (!owner) return c.notFound()
    const itemUrl = `/courses/${access.course.id}/items/${item.id}`
    const students = access.canManage && settings.scope === 'student' ? store.students() : null
    const ownerId = ownerUserId(owner)
    const ownerName = ownerId !== null && ownerId !== user.id ? students?.find((s) => s.id === ownerId)?.name : undefined
    return c.render(
      <CollabPage
        access={access}
        item={item}
        itemUrl={itemUrl}
        settings={settings}
        owner={owner}
        ownerLabel={ownerName && `${ownerName} さん`}
        choices={
          students
            ? [{ owner: 'template', label: 'ひな形' }, ...students.map((s) => ({ owner: userOwner(s.id), label: `${s.name} さん` }))]
            : undefined
        }
        user={{ id: user.id, name: user.name }}
      />,
      { title: item.title },
    )
  }

  async function uploadImage(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const file = fileField(await readForm(c), 'file')
    if (!file) return c.json({ error: '画像を選択してください。' }, 422)
    const put = await putImage(ctx.store.imagePrefix, file)
    if ('error' in put) return c.json({ error: put.error }, 422)
    return c.json({ url: `/courses/${ctx.access.course.id}/items/${ctx.item.id}/collab/images/${imageName(put.key)}` })
  }

  async function image(c: C) {
    const name = c.req.param('name') ?? ''
    if (!IMAGE_NAME.test(name)) return c.notFound()
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    return (await serveImage(`${ctx.store.imagePrefix}/${name}`)) ?? c.notFound()
  }

  return { open, uploadImage, image }
}

/** /courses の下に組み込むルート。ログインの確認は、組み込む側で先に済ませておく */
export function collabRoutes(h: ReturnType<typeof createCollabHandlers>) {
  const app = new Hono<AppEnv>()
  app.get('/:id/items/:iid/collab', h.open)
  app.post('/:id/items/:iid/collab/images', h.uploadImage)
  app.get('/:id/items/:iid/collab/images/:name', h.image)
  return app
}
