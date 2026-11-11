import { Hono } from 'hono'
import { assistant } from '../../lib/ai-assistant'
import { canUseAi } from '../../lib/ai-usage'
import { requireAuth } from '../../lib/auth'
import type { AppEnv, User } from '../../lib/types'
import { aiRoutes, createAiHandlers } from './handlers'

/** 通常モード: 会話と使用量を step-learn.db に置き、使える人をメールのドメインとコースの教師から決める */
const handlers = createAiHandlers({ agent: assistant, canUse: (c) => canUseAi(c.var.user!) })

const app = new Hono<AppEnv>()
app.use(requireAuth)
app.route('/', aiRoutes(handlers))

export default app

/** AppShell の右に出すパネル。AI を使えない利用者には何も描かない */
export const renderAiPanel = (user: User | null) => (user && canUseAi(user) ? handlers.renderPanel(user) : null)
