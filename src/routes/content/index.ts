import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import {
  createItem,
  createSection,
  downloadFile,
  editItem,
  moveItem,
  moveSection,
  removeItem,
  removeSection,
  setItemHidden,
  setSectionHidden,
  showItem,
  toggleComplete,
  updateItem,
  updateSection,
} from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.post('/:id/sections', createSection)
app.post('/:id/sections/:sid', updateSection)
app.post('/:id/sections/:sid/move', moveSection)
app.post('/:id/sections/:sid/delete', removeSection)
app.post('/:id/sections/:sid/visibility', setSectionHidden)
app.post('/:id/items', createItem)
app.get('/:id/items/:iid/edit', editItem)
app.post('/:id/items/:iid', updateItem)
app.post('/:id/items/:iid/move', moveItem)
app.post('/:id/items/:iid/delete', removeItem)
app.post('/:id/items/:iid/visibility', setItemHidden)
app.get('/:id/items/:iid', showItem)
app.post('/:id/items/:iid/complete', toggleComplete)
app.get('/:id/items/:iid/file', downloadFile)

export default app
