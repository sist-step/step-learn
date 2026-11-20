import { backend } from './backend'
import { createMcpHandlers, mcpRoutes } from './handlers'

export default mcpRoutes(createMcpHandlers(backend))
