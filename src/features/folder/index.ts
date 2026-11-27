import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { download, open, remove, upload } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.post('/:id/items/:iid/folder/files', upload)
app.post('/:id/items/:iid/folder/files/delete', remove)
app.get('/:id/items/:iid/folder/files/:fid', open)
app.get('/:id/items/:iid/folder/zip', download)

export default app
