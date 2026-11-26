import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { approveAll, download, remove, setStatus, upload } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.post('/:id/items/:iid/publication/files', upload)
app.get('/:id/items/:iid/publication/files/:fid', download)
app.post('/:id/items/:iid/publication/files/:fid/delete', remove)
app.post('/:id/items/:iid/publication/files/:fid/status', setStatus)
app.post('/:id/items/:iid/publication/approve-all', approveAll)

export default app
