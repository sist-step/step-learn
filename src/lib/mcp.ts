// DB を読み込まないのは、通常モードと Moodle モードの両方の /mcp をこの形で作るため
import { createMcpHandler, Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server'
import { docsTools } from './ai-docs'
import type { AiAgentTool, AiToolContext } from './ai-tool-kit'

/** MCP で出すツール。確認カードのツール（defineConfirmTool）は MCP では出さず、確認はクライアントの許可に任せる */
export type McpTool = { tool: Extract<AiAgentTool, { kind: 'run' }>; title: string; readOnly: boolean }

const DOCS_TITLES: Record<string, string> = { search_docs: 'STEP Docs を検索', read_doc: 'STEP Docs のページを読む' }

/** STEP Docs を検索して読むツール。ledger は検索語の埋め込みの使用量を記録する先（モードごとの AI の使用量） */
export const docsMcpTools = (ledger: Parameters<typeof docsTools>[0]): McpTool[] =>
  docsTools(ledger).flatMap((tool) =>
    tool.kind === 'run' ? [{ tool, title: DOCS_TITLES[tool.tool.name] ?? tool.tool.name, readOnly: true }] : [],
  )

const SERVER_INFO = { name: 'step-learn', title: 'STEP Learn', version: '1.0.0' }

const toMcpTool = ({ tool, title, readOnly }: McpTool): Tool => ({
  name: tool.tool.name,
  title,
  description: tool.tool.description,
  inputSchema: tool.tool.parameters as Tool['inputSchema'],
  annotations: { title, readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
})

const textResult = (text: string, isError?: boolean): CallToolResult => ({ content: [{ type: 'text', text }], isError })

/**
 * MCP の要求に答える。ツールは c の利用者として動く（c.var.user、Moodle モードでは c.var.token）。
 * 要求ごとにサーバーを作るのは、セッションを持たない（stateless）形にして、どの要求もトークンだけで利用者を決めるため
 */
export function serveMcp(c: AiToolContext, tools: McpTool[], instructions: string) {
  const handler = createMcpHandler(
    () => {
      const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions })
      server.setRequestHandler('tools/list', () => ({ tools: tools.map(toMcpTool) }))
      server.setRequestHandler('tools/call', async ({ params }) => {
        const found = tools.find((t) => t.tool.tool.name === params.name)
        if (!found) return textResult(JSON.stringify({ error: `${params.name} というツールはありません。` }), true)
        const result = await found.tool.run(c, params.arguments ?? {})
        return textResult(result.content, result.isError)
      })
      return server
    },
    { responseMode: 'json', onerror: (e) => console.error('[mcp]', e) },
  )
  return handler.fetch(c.req.raw)
}
