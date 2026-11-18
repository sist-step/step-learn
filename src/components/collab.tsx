import type { Child } from 'hono/jsx'
import { Button, IconButton } from './button'
import { Card, LinkCard, Table } from './card'
import { cx } from './cx'
import { Icon, type IconName } from './icons'
import { MenuItem, Popover } from './overlay'
import { useStyle } from './style'
import { Avatar, Chip, EmptyState, Person, formatDateTime } from './ui'
import {
  COLLAB_FILE_EXTS,
  COLLAB_KINDS,
  COLLAB_KIND_DESCRIPTIONS,
  COLLAB_KIND_LABELS,
  COLLAB_SCOPES,
  COLLAB_SCOPE_DESCRIPTIONS,
  COLLAB_SCOPE_LABELS,
  DOC_FONTS,
  DOC_FONT_SIZES,
  userOwner,
  type CollabKind,
  type CollabOwner,
  type CollabScope,
  type CollabSettings,
  type CollabStudentFile,
  type CollabView,
} from '../lib/collab'

export const COLLAB_KIND_ICONS: Record<CollabKind, IconName> = { doc: 'page', sheet: 'table', slides: 'presentation', board: 'squares2x2' }

const PickOption = ({
  name,
  value,
  checked,
  icon,
  label,
  description,
}: {
  name: string
  value: string
  checked: boolean
  icon: IconName
  label: string
  description: string
}) => (
  <label class="collab-pick-option">
    <input type="radio" name={name} value={value} checked={checked} />
    <span class="collab-pick-icon">
      <Icon name={icon} size={20} />
    </span>
    <span class="collab-pick-text">
      <span class="strong">{label}</span>
      <span class="muted small">{description}</span>
    </span>
  </label>
)

/** アイテムを追加するときの、共同編集の種類と分け方の欄。どちらも追加したあとは変えられない */
export const CollabPickFields = ({
  fieldClass,
  kind = 'doc',
  scope = 'course',
}: {
  fieldClass?: string
  kind?: CollabKind
  scope?: CollabScope
}) => {
  useStyle('/src/components/collab.css')
  return (
    <>
      <fieldset class={cx('field collab-pick', fieldClass)}>
        <legend>ファイルの種類</legend>
        <div class="collab-pick-grid">
          {COLLAB_KINDS.map((k) => (
            <PickOption
              name="collab_kind"
              value={k}
              checked={k === kind}
              icon={COLLAB_KIND_ICONS[k]}
              label={COLLAB_KIND_LABELS[k]}
              description={COLLAB_KIND_DESCRIPTIONS[k]}
            />
          ))}
        </div>
      </fieldset>
      <fieldset class={cx('field collab-pick', fieldClass)}>
        <legend>だれのファイルにするか</legend>
        <div class="collab-pick-grid">
          {COLLAB_SCOPES.map((s) => (
            <PickOption
              name="collab_scope"
              value={s}
              checked={s === scope}
              icon={s === 'course' ? 'userGroup' : 'user'}
              label={COLLAB_SCOPE_LABELS[s]}
              description={COLLAB_SCOPE_DESCRIPTIONS[s]}
            />
          ))}
        </div>
        <p class="field-hint">種類とだれのファイルにするかは、追加したあとは変えられません。</p>
      </fieldset>
    </>
  )
}

/** 変えられない設定（種類と分け方）の表示 */
export const CollabFacts = ({ settings }: { settings: CollabSettings }) => {
  useStyle('/src/components/collab.css')
  return (
    <div class="stack">
      <dl class="collab-facts">
        <dt>種類</dt>
        <dd>
          <Icon name={COLLAB_KIND_ICONS[settings.kind]} size={16} /> {COLLAB_KIND_LABELS[settings.kind]}
        </dd>
        <dt>だれのファイルか</dt>
        <dd>{COLLAB_SCOPE_LABELS[settings.scope]}</dd>
      </dl>
      <p class="muted small">種類とだれのファイルにするかは、追加したあとは変えられません。</p>
    </div>
  )
}

/** 編集画面の右の列に置く、変えられない設定の表示 */
export const CollabSettingsCard = ({ settings }: { settings: CollabSettings }) => (
  <Card heading="ファイル">
    <CollabFacts settings={settings} />
  </Card>
)

const ownerHref = (href: string, owner: CollabOwner) => `${href}?owner=${encodeURIComponent(owner)}`

const StudentFiles = ({ href, students }: { href: string; students: CollabStudentFile[] }) =>
  students.length === 0 ? (
    <EmptyState icon="users" title="まだ学生のファイルはありません" text="学生がファイルを開くと、ここに並びます。" />
  ) : (
    <Table columns={[{ label: '学生' }, { label: '最終更新' }, { label: '開く', srOnly: true }]}>
      {students.map((s) => (
        <tr>
          <td>
            <Person avatar={<Avatar name={s.name} size={28} />} name={`${s.name} さん`} />
          </td>
          <td class="muted small">{s.updatedAt ? formatDateTime(s.updatedAt) : 'まだ開いていません'}</td>
          <td class="actions">
            <Button href={ownerHref(href, userOwner(s.id))} size="sm" iconEnd="chevronRight">
              開く
            </Button>
          </td>
        </tr>
      ))}
    </Table>
  )

/** アイテムの画面の本体。ファイルを開く操作と、学生ごとのときの教師には学生のファイルの一覧 */
export const CollabPanel = ({ collab }: { collab: CollabView }) => {
  useStyle('/src/components/collab.css', '/src/components/card.css')
  const { settings, href, students } = collab
  const label = COLLAB_KIND_LABELS[settings.kind]
  const ext = COLLAB_FILE_EXTS[settings.kind]
  const teacherTemplate = !!students
  return (
    <div class="collab-open stack">
      <LinkCard href={href} icon={COLLAB_KIND_ICONS[settings.kind]} class={`link-card-lg collab-kind-${settings.kind}`}>
        <span class="file-name">
          <span class="strong">{teacherTemplate ? `ひな形の${label}を開く` : `${label}を開く`}</span>
          <span class="muted small">
            {teacherTemplate
              ? '学生が最初に開いたときの中身です。ここでの変更は、まだ開いていない学生にだけ届きます'
              : settings.scope === 'course'
                ? `開いている人みんなで同時に編集できます${ext ? `。.${ext} で保存・読み込みもできます` : ''}`
                : `あなただけのファイルです${ext ? `。.${ext} で保存できます` : ''}`}
          </span>
        </span>
        <Button as="span" variant="primary" iconEnd="chevronRight">
          開く
        </Button>
      </LinkCard>
      {students && (
        <Card
          heading="学生のファイル"
          description="学生ごとに 1 つのファイルです。開くと、学生と同時に編集できます。"
          actions={<Chip>{students.length} 人</Chip>}
        >
          <StudentFiles href={href} students={students} />
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 編集画面

/** 教師が学生ごとのファイルを切り替える選択肢 */
export type OwnerChoice = { owner: CollabOwner; label: string }

/** 編集画面の上の帯に置く、開いているファイルの切り替え（学生ごとのときの教師だけ） */
export const OwnerSwitcher = ({ href, current, choices }: { href: string; current: CollabOwner; choices: OwnerChoice[] }) => (
  <form method="get" action={href} class="collab-owner" data-autosubmit>
    <label class="sr-only" for="collab-owner">
      開くファイル
    </label>
    <select id="collab-owner" name="owner" class="input input-sm">
      {choices.map((c) => (
        <option value={c.owner} selected={c.owner === current}>
          {c.label}
        </option>
      ))}
    </select>
  </form>
)

const Tool = ({
  cmd,
  icon,
  label,
  value,
  ...rest
}: { cmd: string; icon: IconName; label: string; value?: string } & Record<string, unknown>) => (
  <IconButton icon={icon} label={label} class="collab-tool" data-cmd={cmd} data-cmd-value={value} aria-pressed="false" {...rest} />
)

const Sep = () => <span class="collab-sep" role="separator" />

const ColorTool = ({ cmd, icon, label, value }: { cmd: string; icon: IconName; label: string; value: string }) => (
  <label class="collab-color" title={label}>
    <Icon name={icon} size={16} />
    <input type="color" value={value} data-cmd={cmd} aria-label={label} />
    <span class="collab-color-bar" />
  </label>
)

const ToolSelect = ({
  cmd,
  label,
  options,
  value,
}: {
  cmd: string
  label: string
  options: { value: string; label: string }[]
  value?: string
}) => (
  <select class="input input-sm collab-select" data-cmd={cmd} aria-label={label} title={label}>
    {options.map((o) => (
      <option value={o.value} selected={o.value === value}>
        {o.label}
      </option>
    ))}
  </select>
)

const ToolMenu = ({ icon, label, children, text }: { icon: IconName; label: string; children: Child; text?: string }) => (
  <Popover
    class="collab-menu"
    trigger={
      <summary class={cx(text ? 'btn btn-ghost btn-sm' : 'icon-btn collab-tool')} aria-label={label} title={label}>
        <Icon name={icon} size={16} />
        {text && <span class="hide-sm">{text}</span>}
      </summary>
    }
  >
    {children}
  </Popover>
)

const SHAPES: { value: string; label: string; path: string }[] = [
  { value: 'rect', label: '四角形', path: 'M3 5h18v14H3z' },
  { value: 'roundRect', label: '角丸四角形', path: 'M7 5h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z' },
  { value: 'ellipse', label: '楕円', path: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z' },
  { value: 'triangle', label: '三角形', path: 'M12 4l9 16H3z' },
  { value: 'diamond', label: 'ひし形', path: 'M12 3l9 9-9 9-9-9z' },
  { value: 'star', label: '星', path: 'M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 16.8 6.4 20.1l1.4-6.3L3 9.5l6.4-.6z' },
  { value: 'arrowRight', label: '右矢印', path: 'M3 9h11V5l7 7-7 7v-4H3z' },
  { value: 'speech', label: '吹き出し', path: 'M4 5h16v10H10l-5 4v-4H4z' },
]

// アイコンの代わりに形そのものを描くのは、Heroicons に四角形・三角形などの図形のアイコンがないため
const ShapeButton = ({ cmd, shape }: { cmd: string; shape: { value: string; label: string; path: string } }) => (
  <button type="button" class="collab-shape" data-cmd={cmd} data-cmd-value={shape.value} aria-label={shape.label} title={shape.label}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={shape.path} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  </button>
)

const LINES = [
  { value: 'line', label: '線', path: 'M4 20L20 4' },
  { value: 'arrow', label: '矢印', path: 'M4 20L20 4M11 4h9v9' },
]

const ShapeMenu = ({ cmd, lineCmd }: { cmd: string; lineCmd?: string }) => (
  <ToolMenu icon="squaresPlus" label="図形">
    <div class="collab-shapes">
      {SHAPES.map((s) => (
        <ShapeButton cmd={cmd} shape={s} />
      ))}
      {lineCmd && LINES.map((s) => <ShapeButton cmd={lineCmd} shape={s} />)}
    </div>
  </ToolMenu>
)

const FileTools = ({ kind, canImport }: { kind: CollabKind; canImport: boolean }) => {
  const ext = COLLAB_FILE_EXTS[kind]
  if (!ext) return null
  return (
    <ToolMenu icon="file" label="ファイル" text="ファイル">
      <MenuItem icon="download" data-cmd="export">
        .{ext} で保存
      </MenuItem>
      {canImport && (
        <MenuItem icon="documentUp" data-cmd="import">
          .{ext} を読み込む（中身を置き換え）
        </MenuItem>
      )}
    </ToolMenu>
  )
}

const HistoryTools = () => (
  <>
    <Tool cmd="undo" icon="undo" label="元に戻す（⌘Z）" />
    <Tool cmd="redo" icon="redo" label="やり直す（⇧⌘Z）" />
  </>
)

const DOC_TEXT_COLORS = [
  { value: '#111827', label: '黒' },
  { value: '#6b7280', label: '灰色' },
  { value: '#d92d20', label: '赤' },
  { value: '#ea580c', label: 'オレンジ' },
  { value: '#a16207', label: '黄土色' },
  { value: '#15803d', label: '緑' },
  { value: '#1d4ed8', label: '青' },
  { value: '#7e22ce', label: '紫' },
]

const DOC_HIGHLIGHT_COLORS = [
  { value: '#fef08a', label: '黄色' },
  { value: '#fed7aa', label: 'オレンジ' },
  { value: '#fecaca', label: '赤' },
  { value: '#fbcfe8', label: 'ピンク' },
  { value: '#ddd6fe', label: '紫' },
  { value: '#bfdbfe', label: '青' },
  { value: '#bbf7d0', label: '緑' },
  { value: '#e5e7eb', label: '灰色' },
]

// 色の入力欄だけにしないのは、同じ色を選び直しても change が起きず、続けて同じ色を塗れないため
const DocColorMenu = ({
  cmd,
  label,
  glyph,
  noneLabel,
  colors,
}: {
  cmd: string
  label: string
  glyph: Child
  noneLabel: string
  colors: { value: string; label: string }[]
}) => (
  <Popover
    class="collab-menu"
    trigger={
      <summary class="icon-btn collab-tool doc-color" data-doc-color={cmd} aria-label={label} title={label}>
        {glyph}
        <span class="collab-color-bar" />
      </summary>
    }
  >
    <MenuItem icon="x" data-cmd={cmd} data-cmd-value="">
      {noneLabel}
    </MenuItem>
    <div class="doc-swatches">
      {colors.map((c) => (
        <button
          type="button"
          class="doc-swatch"
          style={`--swatch:${c.value}`}
          data-cmd={cmd}
          data-cmd-value={c.value}
          aria-label={c.label}
          title={c.label}
        />
      ))}
    </div>
    <label class="menu-item doc-custom-color">
      <Icon name="swatch" size={18} />
      <span>ほかの色</span>
      <input type="color" value={colors[0].value} data-cmd={cmd} aria-label={`${label}をほかの色から選ぶ`} />
    </label>
  </Popover>
)

const DocLinkMenu = () => (
  <Popover
    class="collab-menu"
    data-doc-link-menu
    trigger={
      <summary class="icon-btn collab-tool" data-doc-link-toggle aria-label="リンク（⌘K）" title="リンク（⌘K）" aria-pressed="false">
        <Icon name="link" size={16} />
      </summary>
    }
  >
    <div class="doc-link">
      <label class="small strong" for="doc-link-url">
        リンク先の URL
      </label>
      <input
        id="doc-link-url"
        class="input input-sm"
        data-doc-link-url
        inputmode="url"
        placeholder="https://example.com"
        autocomplete="off"
        spellcheck={false}
      />
      <div class="doc-link-actions">
        <Button size="sm" variant="primary" data-doc-link-apply>
          適用
        </Button>
        <Button size="sm" variant="ghost" data-cmd="unlink" data-doc-link-existing>
          解除
        </Button>
        <Button
          size="sm"
          variant="ghost"
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          iconEnd="external"
          data-no-prefetch
          data-doc-link-open
          data-doc-link-existing
        >
          開く
        </Button>
      </div>
    </div>
  </Popover>
)

const DocTools = () => (
  <>
    <ToolSelect
      cmd="block"
      label="段落のスタイル"
      options={[
        { value: 'p', label: '本文' },
        { value: 'h1', label: '見出し 1' },
        { value: 'h2', label: '見出し 2' },
        { value: 'h3', label: '見出し 3' },
        { value: 'h4', label: '見出し 4' },
        { value: 'blockquote', label: '引用' },
        { value: 'codeBlock', label: 'コード' },
      ]}
    />
    <ToolSelect
      cmd="fontFamily"
      label="フォント"
      options={[{ value: '', label: '標準' }, ...DOC_FONTS.map(({ value, label }) => ({ value, label }))]}
    />
    <ToolSelect
      cmd="fontSize"
      label="文字の大きさ（pt）"
      options={[{ value: '', label: '標準' }, ...DOC_FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))]}
    />
    <Sep />
    <Tool cmd="bold" icon="bold" label="太字（⌘B）" />
    <Tool cmd="italic" icon="italic" label="斜体（⌘I）" />
    <Tool cmd="underline" icon="underline" label="下線（⌘U）" />
    <Tool cmd="strike" icon="strikethrough" label="取り消し線" />
    <Tool cmd="code" icon="code" label="コード（⌘E）" />
    <DocColorMenu
      cmd="color"
      label="文字の色"
      glyph={<span class="doc-color-glyph">A</span>}
      noneLabel="自動（色なし）"
      colors={DOC_TEXT_COLORS}
    />
    <DocColorMenu
      cmd="highlight"
      label="蛍光ペン"
      glyph={<Icon name="paintBrush" size={16} />}
      noneLabel="蛍光ペンなし"
      colors={DOC_HIGHLIGHT_COLORS}
    />
    <Tool cmd="clearFormat" icon="backspace" label="書式をクリア" />
    <Sep />
    <ToolMenu icon="format" label="文字の揃え">
      <MenuItem icon="format" data-cmd="align" data-cmd-value="left" aria-pressed="false">
        左揃え
      </MenuItem>
      <MenuItem icon="alignCenter" data-cmd="align" data-cmd-value="center" aria-pressed="false">
        中央揃え
      </MenuItem>
      <MenuItem icon="indent" data-cmd="align" data-cmd-value="right" aria-pressed="false">
        右揃え
      </MenuItem>
      <MenuItem icon="menu" data-cmd="align" data-cmd-value="justify" aria-pressed="false">
        両端揃え
      </MenuItem>
    </ToolMenu>
    <Tool cmd="bulletList" icon="listBullet" label="箇条書き" />
    <Tool cmd="orderedList" icon="listNumbered" label="番号付きリスト" />
    <Tool cmd="outdent" icon="chevronDoubleLeft" label="字下げを減らす（⇧Tab）" />
    <Tool cmd="indent" icon="chevronDoubleRight" label="字下げを増やす（Tab）" />
    <Sep />
    <DocLinkMenu />
    <ToolMenu icon="table" label="表">
      <MenuItem icon="plus" data-cmd="tableInsert">
        表を挿入（3 × 3）
      </MenuItem>
      <MenuItem data-cmd="tableRowBefore" data-doc-needs-table>
        上に行を挿入
      </MenuItem>
      <MenuItem data-cmd="tableRowAfter" data-doc-needs-table>
        下に行を挿入
      </MenuItem>
      <MenuItem data-cmd="tableColBefore" data-doc-needs-table>
        左に列を挿入
      </MenuItem>
      <MenuItem data-cmd="tableColAfter" data-doc-needs-table>
        右に列を挿入
      </MenuItem>
      <MenuItem data-cmd="tableMerge">セルの結合・解除</MenuItem>
      <MenuItem data-cmd="tableHeaderRow" data-doc-needs-table>
        先頭の行を見出しにする・戻す
      </MenuItem>
      <MenuItem data-cmd="tableRowDelete" data-doc-needs-table>
        行を削除
      </MenuItem>
      <MenuItem data-cmd="tableColDelete" data-doc-needs-table>
        列を削除
      </MenuItem>
      <MenuItem icon="trash" class="is-danger" data-cmd="tableDelete" data-doc-needs-table>
        表を削除
      </MenuItem>
    </ToolMenu>
    <Tool cmd="image" icon="photo" label="画像を挿入" />
    <Tool cmd="rule" icon="minus" label="区切り線" />
  </>
)

const SheetTools = () => (
  <>
    <Tool cmd="bold" icon="bold" label="太字（⌘B）" />
    <Tool cmd="italic" icon="italic" label="斜体（⌘I）" />
    <Tool cmd="underline" icon="underline" label="下線（⌘U）" />
    <ColorTool cmd="color" icon="swatch" label="文字の色" value="#d92d20" />
    <ColorTool cmd="fill" icon="paintBrush" label="塗りつぶし" value="#fde047" />
    <Sep />
    <Tool cmd="align" value="left" icon="format" label="左揃え" />
    <Tool cmd="align" value="center" icon="alignCenter" label="中央揃え" />
    <Tool cmd="align" value="right" icon="indent" label="右揃え" />
    <ToolSelect
      cmd="format"
      label="表示形式"
      options={[
        { value: '', label: '標準' },
        { value: 'number', label: '数値（1,234）' },
        { value: 'fixed2', label: '小数 2 桁' },
        { value: 'currency', label: '通貨（¥）' },
        { value: 'percent', label: 'パーセント' },
        { value: 'date', label: '日付' },
      ]}
    />
    <Sep />
    <ToolMenu icon="table" label="行と列">
      <MenuItem data-cmd="rowAbove">上に行を挿入</MenuItem>
      <MenuItem data-cmd="rowBelow">下に行を挿入</MenuItem>
      <MenuItem data-cmd="colLeft">左に列を挿入</MenuItem>
      <MenuItem data-cmd="colRight">右に列を挿入</MenuItem>
      <MenuItem class="is-danger" data-cmd="rowDelete">
        行を削除
      </MenuItem>
      <MenuItem class="is-danger" data-cmd="colDelete">
        列を削除
      </MenuItem>
    </ToolMenu>
    <Tool cmd="clear" icon="trash" label="選んだセルを消去（Delete）" />
  </>
)

const FONT_SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '40', '48', '60', '72'].map((v) => ({ value: v, label: v }))

/** 図形・テキストを選んだときに効く操作（スライドとキャンバスで同じ） */
const ShapeStyleTools = ({ bullet }: { bullet?: boolean }) => (
  <span class="collab-tools-group" data-when-selected>
    <ToolSelect cmd="fontSize" label="文字の大きさ" options={FONT_SIZES} value="24" />
    <Tool cmd="bold" icon="bold" label="太字（⌘B）" />
    <Tool cmd="italic" icon="italic" label="斜体（⌘I）" />
    <Tool cmd="underline" icon="underline" label="下線（⌘U）" />
    <ColorTool cmd="color" icon="swatch" label="文字の色" value="#111827" />
    <ColorTool cmd="fill" icon="paintBrush" label="塗りつぶし" value="#bfdbfe" />
    <ColorTool cmd="stroke" icon="pencil" label="線の色" value="#1d4ed8" />
    <Tool cmd="align" value="left" icon="format" label="左揃え" />
    <Tool cmd="align" value="center" icon="alignCenter" label="中央揃え" />
    <Tool cmd="align" value="right" icon="indent" label="右揃え" />
    {bullet && <Tool cmd="bullet" icon="listBullet" label="箇条書き" />}
    <ToolMenu icon="layers" label="重なりと削除">
      <MenuItem icon="arrowUp" data-cmd="front">
        最前面へ
      </MenuItem>
      <MenuItem icon="arrowDown" data-cmd="back">
        最背面へ
      </MenuItem>
      <MenuItem icon="copy" data-cmd="duplicate">
        複製（⌘D）
      </MenuItem>
      <MenuItem icon="trash" class="is-danger" data-cmd="delete">
        削除（Delete）
      </MenuItem>
    </ToolMenu>
  </span>
)

const SlidesTools = () => (
  <>
    <ToolMenu icon="plus" label="新しいスライド" text="スライド">
      <MenuItem data-cmd="addSlide" data-cmd-value="title">
        タイトル
      </MenuItem>
      <MenuItem data-cmd="addSlide" data-cmd-value="content">
        タイトルと本文
      </MenuItem>
      <MenuItem data-cmd="addSlide" data-cmd-value="blank">
        白紙
      </MenuItem>
    </ToolMenu>
    <Tool cmd="addText" icon="pencilSquare" label="テキスト" />
    <ShapeMenu cmd="addShape" lineCmd="addLine" />
    <Tool cmd="image" icon="photo" label="画像" />
    <Sep />
    <ShapeStyleTools bullet />
    <Sep />
    <ColorTool cmd="background" icon="stop" label="スライドの背景色" value="#ffffff" />
    <Button size="sm" variant="ghost" icon="play" data-cmd="present" aria-label="スライドショー">
      <span class="hide-sm">スライドショー</span>
    </Button>
  </>
)

// src/collab/slides.ts で組み立てないのは、アイコンをサーバーでしか描けないため
const SlideThumbTools = () => (
  <template data-slide-tools>
    <div class="slides-thumb-tools">
      <IconButton icon="arrowUp" label="前へ移動" data-slide-action="up" />
      <IconButton icon="arrowDown" label="後ろへ移動" data-slide-action="down" />
      <IconButton icon="copy" label="スライドを複製" data-slide-action="copy" />
      <IconButton icon="trash" label="スライドを削除" danger data-slide-action="remove" />
    </div>
  </template>
)

const BoardTools = () => (
  <>
    <ShapeStyleTools />
  </>
)

/** キャンバスの左に縦に並べる道具 */
const BoardPalette = () => (
  <div class="board-palette" role="toolbar" aria-label="道具" aria-orientation="vertical">
    <Tool cmd="tool" value="select" icon="cursor" label="選択（V）" />
    <Tool cmd="tool" value="hand" icon="hand" label="手のひら（H・スペースを押しながら）" />
    <Tool cmd="tool" value="note" icon="note" label="付箋（N）" />
    <Tool cmd="tool" value="text" icon="pencilSquare" label="テキスト（T）" />
    <ShapeMenu cmd="shapeTool" />
    <Tool cmd="tool" value="line" icon="minus" label="線（L）" />
    <Tool cmd="tool" value="arrow" icon="arrowLongRight" label="矢印（A）" />
    <Tool cmd="tool" value="pen" icon="paintBrush" label="ペン（P）" />
    <Tool cmd="image" icon="photo" label="画像" />
  </div>
)

const BoardZoom = () => (
  <div class="board-zoom" role="group" aria-label="表示の大きさ">
    <Tool cmd="zoomOut" icon="zoomOut" label="縮小" />
    <span class="board-zoom-label" data-board-zoom>
      100%
    </span>
    <Tool cmd="zoomIn" icon="zoomIn" label="拡大" />
    <Tool cmd="fit" icon="maximize" label="全体を表示" />
  </div>
)

const NOTE_COLORS = ['#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#ddd6fe', '#bfdbfe', '#bbf7d0', '#e5e7eb']

const BoardNoteColors = () => (
  <div class="board-colors" data-when-tool="note" role="group" aria-label="付箋の色">
    {NOTE_COLORS.map((c, i) => (
      <button
        type="button"
        class="board-color"
        style={`--swatch:${c}`}
        data-cmd="noteColor"
        data-cmd-value={c}
        aria-pressed={i === 0 ? 'true' : 'false'}
        aria-label={`付箋の色 ${i + 1}`}
      />
    ))}
  </div>
)

export type CollabWorkspaceProps = {
  kind: CollabKind
  courseId: number
  itemId: number
  owner: CollabOwner
  user: { id: number; name: string }
  title: string
  /** 画像を上げる URL（POST）。置いた画像はこの下の /<名前> で開ける */
  imageBase: string
  /** Office のファイルを読み込んで中身を置き換えられるか（教師だけ） */
  canImport: boolean
  /** ファイルの説明（ひな形を開いているときなど） */
  note?: Child
}

/**
 * 共同編集のエディター。src/collab/ の各ファイルが、data-collab の中に種類ごとのエディターを組み立て、
 * data-cmd の付いた操作を受け持つ
 */
export const CollabWorkspace = ({ kind, courseId, itemId, owner, user, title, imageBase, canImport, note }: CollabWorkspaceProps) => {
  useStyle('/src/components/collab.css', '/src/components/button.css', '/src/components/overlay.css', '/src/components/form.css')
  const ext = COLLAB_FILE_EXTS[kind]
  return (
    <div
      class={`collab collab-${kind}`}
      data-collab={kind}
      data-course={courseId}
      data-item={itemId}
      data-owner={owner}
      data-user-id={user.id}
      data-user-name={user.name}
      data-title={title}
      data-image-base={imageBase}
      data-can-import={canImport ? '1' : '0'}
      data-state="connecting"
    >
      <div class="collab-bar" role="toolbar" aria-label="編集の操作">
        <FileTools kind={kind} canImport={canImport} />
        <HistoryTools />
        <Sep />
        <div class="collab-tools">
          {kind === 'doc' && <DocTools />}
          {kind === 'sheet' && <SheetTools />}
          {kind === 'slides' && <SlidesTools />}
          {kind === 'board' && <BoardTools />}
        </div>
        <div class="collab-presence">
          <div class="collab-people" data-collab-people aria-label="開いている人" />
          <span class="collab-status" data-collab-status role="status">
            接続しています…
          </span>
        </div>
      </div>
      <div class="collab-person-tip" role="tooltip" data-collab-person-tip hidden />
      {note && <div class="collab-note">{note}</div>}
      {kind === 'sheet' && (
        <div class="sheet-formula">
          <input class="input input-sm sheet-name-box" data-sheet-name-box aria-label="セルの場所" />
          <span class="sheet-fx" aria-hidden="true">
            <Icon name="variable" size={16} />
          </span>
          <input
            class="input input-sm sheet-formula-input"
            data-sheet-formula
            aria-label="セルの中身（= で始めると計算式）"
            autocomplete="off"
            spellcheck={false}
          />
        </div>
      )}
      <div class="collab-main">
        {kind === 'board' && <BoardPalette />}
        {kind === 'board' && <BoardNoteColors />}
        {kind === 'board' && <BoardZoom />}
        <div class="collab-stage" data-collab-stage>
          <div class="collab-loading">読み込んでいます…</div>
        </div>
      </div>
      {kind === 'slides' && <SlideThumbTools />}
      {ext && <input type="file" hidden accept={`.${ext}`} data-collab-import-file />}
      <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" data-collab-image-file />
    </div>
  )
}
