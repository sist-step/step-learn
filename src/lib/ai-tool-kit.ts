// DB を読み込まないのは、通常モード（lib/ai-tools.ts）と Moodle モード（moodle-mode/ai-tools.ts）の両方のツールをこの形で作るため
import * as z from 'zod/mini'
import type { AiTool } from './ai'
import type { Context } from 'hono'
import type { AppEnv } from './types'

/** ツールを呼んだ要求。利用者は c.var.user、Moodle モードではトークンも c.var から読む */
export type AiToolContext = Context<AppEnv>

/**
 * AI が変えたもの。client.ts が開いている画面に反映して強調し、会話の行から href を開けるようにする。
 * section と item は、変えたもの（並べ替えはそのセクション）があればその ID
 */
export type AiTouched = { course: number; section?: number; item?: number; href: string }

/** label は画面の会話に出す、ツールで何をしたかの説明。touched は内容を変えたときだけ渡す */
export type AiToolResult = { content: string; label: string; isError?: boolean; touched?: AiTouched }

/** 確認カードの 1 行。long は差分で見せる複数行の文章 */
export type AiChange = { label: string; before: string; after: string; long?: boolean }

/** snapshot は提案したときの値。実行するときに今の値と比べ、そのあいだに変わっていたら実行しない */
export type AiProposal = { title: string; changes: AiChange[]; snapshot: unknown }

export type AiAgentTool =
  | { kind: 'run'; tool: AiTool; run: (c: AiToolContext, args: unknown) => Promise<AiToolResult> }
  | {
      kind: 'confirm'
      tool: AiTool
      propose: (c: AiToolContext, args: unknown) => Promise<AiProposal | AiToolResult>
      apply: (c: AiToolContext, args: unknown, snapshot: unknown) => Promise<AiToolResult>
    }

export const isToolResult = (v: AiProposal | AiToolResult): v is AiToolResult => 'content' in v

// 開く先をコースページとアイテムの画面に決めてよいのは、通常モードと Moodle モードで URL の形が同じため
/** コースページで見るもの（セクションと、その中の並び・表示） */
export const inCourse = (course: number, section?: number): AiTouched => ({
  course,
  section,
  href: `/courses/${course}${section ? `#section-${section}` : ''}`,
})

/** アイテムの画面で見るもの（アイテムの中身） */
export const inItem = (course: number, item: number, section?: number): AiTouched => ({
  course,
  item,
  section,
  href: `/courses/${course}/items/${item}`,
})

export const success = (data: unknown, label: string, touched?: AiTouched): AiToolResult => ({
  content: JSON.stringify(data),
  label,
  touched,
})

export const failure = (message: string, label: string): AiToolResult => ({
  content: JSON.stringify({ error: message }),
  label,
  isError: true,
})

export const NOT_FOUND = '見つからないか、管理する権限がありません。'

export const STALE = '確認を求めたあとに内容が変わったため、実行しませんでした。もう一度内容を確かめてから提案し直してください。'

export const id = (description: string) => z.int().check(z.positive(), z.describe(description))

export const describedString = (description: string, max: number, min = 0) =>
  z.string().check(z.minLength(min), z.maxLength(max), z.describe(description))

function toolOf<S extends z.ZodMiniObject>(name: string, description: string, schema: S): AiTool {
  const { $schema: _, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>
  return { name, description, parameters }
}

const parse = <S extends z.ZodMiniObject>(schema: S, raw: unknown) => schema.safeParse(raw)

const badArgs = (name: string) => failure('引数が正しくありません。説明に合わせて呼び直してください。', `${name} の引数が正しくありません`)

/** 呼ばれたらすぐ実行するツール（読む・追加・並べ替え） */
export function defineTool<S extends z.ZodMiniObject>(
  name: string,
  description: string,
  schema: S,
  run: (c: AiToolContext, args: z.output<S>) => AiToolResult | Promise<AiToolResult>,
): AiAgentTool {
  return {
    kind: 'run',
    tool: toolOf(name, description, schema),
    run: async (c, raw) => {
      const parsed = parse(schema, raw)
      return parsed.success ? run(c, parsed.data) : badArgs(name)
    },
  }
}

/** 利用者が確認カードで承認してから実行するツール（既存の内容の変更・表示の切り替え） */
export function defineConfirmTool<S extends z.ZodMiniObject>(
  name: string,
  description: string,
  schema: S,
  propose: (c: AiToolContext, args: z.output<S>) => AiProposal | AiToolResult | Promise<AiProposal | AiToolResult>,
  apply: (c: AiToolContext, args: z.output<S>, snapshot: unknown) => AiToolResult | Promise<AiToolResult>,
): AiAgentTool {
  return {
    kind: 'confirm',
    tool: toolOf(name, description, schema),
    propose: async (c, raw) => {
      const parsed = parse(schema, raw)
      return parsed.success ? propose(c, parsed.data) : badArgs(name)
    },
    apply: async (c, raw, snapshot) => {
      const parsed = parse(schema, raw)
      return parsed.success ? apply(c, parsed.data, snapshot) : badArgs(name)
    },
  }
}

/** before と after が違う欄だけを、確認カードの行にする */
export const changed = (label: string, before: string, after: string | undefined, long = false): AiChange[] =>
  after === undefined || after === before ? [] : [{ label, before, after, long }]

// JSON の文字列で比べるのは、snapshot は DB に保存した会話から読み戻した値で、元の型を持っていないため
export const sameSnapshot = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
