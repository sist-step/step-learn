import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import { limitBody } from '../../lib/http'
import { IMAGE_TOO_LARGE, MAX_IMAGE_SIZE } from '../../lib/images'
import type { AppEnv } from '../../lib/types'
import { courseImage, create, leave, list, remove, removeCourseImage, settings, show, updateCourseImage, updateSettings } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/', list)
app.post('/', create)
app.get('/:id', show)
app.post('/:id/leave', leave)
app.get('/:id/settings', settings)
app.post('/:id/settings', updateSettings)
app.get('/:id/:kind{hero|icon}/:name', courseImage)
app.post('/:id/:kind{hero|icon}', limitBody(MAX_IMAGE_SIZE + 64 * 1024, IMAGE_TOO_LARGE), updateCourseImage)
app.post('/:id/:kind{hero|icon}/delete', removeCourseImage)
app.post('/:id/delete', remove)

export default app
