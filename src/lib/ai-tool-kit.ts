// DB を読み込まないのは、通常モード（lib/ai-tools.ts）と Moodle モード（moodle-mode/ai-tools.ts）の両方のツールをこの形で作るため
import * as z from 'zod/mini'
import type { AiFilePart, AiTool } from './ai'
import type { Context } from 'hono'
import { MAX_CONSTRAINT_LABEL_LENGTH, MAX_CONSTRAINT_LENGTH, MAX_CONSTRAINTS, describeConstraint, type CodeConstraint } from './code'
import { formatBytes } from './bytes'
import type { AppEnv } from './types'

/** ツールを呼んだ要求。利用者は c.var.user、Moodle モードではトークンも c.var から読む */
export type AiToolContext = Context<AppEnv>

/**
 * AI が変えたもの。client.ts が開いている画面に反映して強調し、会話の行から href を開けるようにする。
 * section と item は、変えたもの（並べ替えはそのセクション）があればその ID
 */
export type AiTouched = { course: number; section?: number; item?: number; href: string }

/** label は画面の会話に出す、ツールで何をしたかの説明。touched は内容を変えたときだけ渡す。files は結果に添えて AI に見せるファイル */
export type AiToolResult = { content: string; label: string; isError?: boolean; touched?: AiTouched; files?: AiFilePart[] }

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

/** request_file で受け取ったファイルの置き場所（通常モードは lib/ai-uploads.ts、Moodle モードは moodle-mode/ai-uploads.ts）。receive は AI に渡す file_id を返す */
export type AiFileStore = { receive: (c: AiToolContext, file: File) => Promise<number> }

/** read_file で読むファイルのアイテム。title はアイテムの名前、read はファイルの中身で、取り出せなければ null */
export type AiReadableFile = { title: string; name: string; size: number; read: () => Promise<Uint8Array | null> }

/**
 * read_file で、利用者が管理しているファイルのアイテムを探す（通常モードは lib/ai-tools.ts、Moodle モードは moodle-mode/ai-tools.ts）。
 * 見つからないか、ファイルのアイテムでなければ failure の結果を返す
 */
export type AiFileReader = (c: AiToolContext, itemId: number, courseId?: number) => Promise<AiReadableFile | AiToolResult>

/** request_file で受け取ったファイルを使うツールの引数 */
export const fileId = (description: string) => id(`${description}。request_file で受け取った file_id`)

export const UPLOAD_NOT_FOUND =
  'その file_id のファイルは見つかりません。使えるのは、このチャットで受け取ってから 1 回だけです。request_file で受け取り直してください。'

// 名前だけにしないのは、同じ名前のファイルに差し替えると、確認カードの変更前と変更後が同じに見えるため
/** ファイルを差し替える確認カードの行 */
export const fileChange = (before: { name: string; size: number }, upload: { fileName: string; fileSize: number }): AiChange => ({
  label: 'ファイル',
  before: before.name && `${before.name}（${formatBytes(before.size)}）`,
  after: `${upload.fileName}（受け取ったファイル・${formatBytes(upload.fileSize)}）`,
})

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

export const constraintsSchema = (description: string) =>
  z
    .array(
      z.object({
        label: describedString('学生にも見せる短い名前（15 字程度。例:「名前を見出しにする」）', MAX_CONSTRAINT_LABEL_LENGTH, 1),
        text: z.optional(
          describedString(
            '学生には見せず、AI が判定に使う詳しい内容。コードを読めば満たしているか判定できる文（例:「h1 要素に自分の名前が書かれている」）',
            MAX_CONSTRAINT_LENGTH,
          ),
        ),
        optional: z.optional(
          z.boolean().check(z.describe('true なら発展の制約で、判定はするがクリアには数えない。省略すると必須。必須の制約が 1 つ以上要る')),
        ),
      }),
    )
    .check(z.minLength(1), z.maxLength(MAX_CONSTRAINTS), z.describe(description))

export function toConstraints(args: { label: string; text?: string; optional?: boolean }[]): CodeConstraint[] {
  // すべて発展のまま保存しないのは、必須の制約がないと、どの提出もクリアにならないため。断らずに必須として扱う
  const keepOptional = args.some((c) => !c.optional)
  return args.map((c) => ({ label: c.label.trim(), text: c.text?.trim() ?? '', ...(keepOptional && c.optional && { optional: true }) }))
}

export const constraintLines = (constraints: CodeConstraint[]) =>
  constraints.map((c) => `${describeConstraint(c)}${c.optional ? '［発展］' : ''}`).join('\n')

export function toolOf<S extends z.ZodMiniObject>(name: string, description: string, schema: S): AiTool {
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

/** ids が current と同じ顔ぶれを 1 回ずつ並べたものか */
export const sameMembers = (ids: number[], current: number[]) =>
  ids.length === current.length && new Set(ids).size === ids.length && ids.every((i) => current.includes(i))

/**
 * 並べ替えの確認カード。rows は今の並びで、snapshot にはその ID の並びを入れる。
 * ids が今と同じ顔ぶれでなければ mismatch を、同じ並びなら並べ替えるところがないことを、label の失敗の結果で返す
 */
export function reorderProposal(
  title: string,
  rows: { id: number; title: string }[],
  ids: number[],
  mismatch: string,
  label: string,
): AiProposal | AiToolResult {
  const current = rows.map((r) => r.id)
  if (!sameMembers(ids, current)) return failure(mismatch, label)
  if (ids.every((rowId, i) => rowId === current[i])) return failure('今と同じ並び順なので、並べ替えるところがありません。', label)
  const lines = (order: number[]) => order.map((rowId) => rows.find((r) => r.id === rowId)?.title ?? '').join('\n')
  return { title, changes: [{ label: '並び順', before: lines(current), after: lines(ids), long: true }], snapshot: current }
}
