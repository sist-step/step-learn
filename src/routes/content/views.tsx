import { CodeBarActions, CodeGrade, CodeGradingFields, CodeStarterFields, CodeWorkspace, type GradeView } from '../../components/code'
import {
  CompletionField,
  CompletionStatus,
  CourseLiveSync,
  ITEM_ICONS,
  ItemBar,
  ItemIcon,
  LinkEmbed,
  LinkTargetField,
  linkOpenAttrs,
} from '../../components/course'
import { cx } from '../../components/cx'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Button } from '../../components/button'
import { FileChip, FileInput, FormField, SegmentedControl, SelectField, TextField, validateWith } from '../../components/form'
import { Markdown, MarkdownEditor } from '../../components/markdown'
import { Card, DangerRow, LinkCard } from '../../components/card'
import { PdfBar, PdfStage } from '../../components/pdf'
import { Alert, Breadcrumbs, Chip } from '../../components/ui'
import type { CodeFiles, CodeLanguage } from '../../lib/code'
import type { CourseAccess } from '../../lib/courses'
import type { FieldErrors } from '../../lib/forms'
import { previewKind } from '../../lib/preview'
import { formatBytes } from '../../lib/bytes'
import { MAX_FILE_SIZE } from '../../lib/storage'
import { ITEM_TYPE_LABELS, type CodeItem, type Item, type Section } from '../../lib/types'

export type ItemInput = {
  title: string
  body: string
  url: string
  linkTarget: string
  file: File | null
  starter: CodeFiles
  stdin: string
  criteria: string
  maxScore: string
}

/** コードのアイテムの言語と、見ている学生のいちばん新しい提出の採点 */
export type CodeView = { language: CodeLanguage; canRun: boolean; grade: GradeView | null }

export type OutlineItem = Pick<
  Item,
  'id' | 'sectionId' | 'type' | 'title' | 'url' | 'linkTarget' | 'fileName' | 'fileType' | 'hidden' | 'completion'
>

export type OutlineSection = Pick<Section, 'id' | 'title' | 'hidden'>

export const TEXT_PREVIEW_MAX = 200 * 1024

export const editUrl = (courseId: number, sectionId?: number) => `/courses/${courseId}${sectionId ? `#section-${sectionId}` : ''}`

const hostName = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export const ItemEditPage = ({
  access,
  item,
  code,
  gradingEnabled,
  sections,
  values,
  errors = {},
}: {
  access: CourseAccess
  item: Item
  code?: CodeItem
  /** AI が設定されていて、提出を自動で採点するか */
  gradingEnabled: boolean
  sections: Section[]
  values?: Partial<ItemInput> & { hidden?: number; sectionId?: number; completion?: string }
  errors?: FieldErrors
}) => {
  const courseId = access.course.id
  const base = `/courses/${courseId}/items/${item.id}`
  const v = {
    title: item.title,
    body: item.body,
    url: item.url,
    linkTarget: item.linkTarget as string,
    hidden: item.hidden,
    sectionId: item.sectionId,
    completion: item.completion as string,
    starter: code?.starter ?? {},
    stdin: code?.stdin ?? '',
    criteria: code?.criteria ?? '',
    maxScore: String(code?.maxScore ?? ''),
    ...values,
  }
  const section = sections.find((s) => s.id === item.sectionId)
  const typeLabel = ITEM_TYPE_LABELS[item.type]
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/content/content.css']} />
      <Breadcrumbs
        items={[
          { href: '/courses', label: 'コース一覧' },
          { href: `/courses/${courseId}`, label: access.course.title },
          section && { href: editUrl(courseId, section.id), label: section.title },
          { href: base, label: item.title },
        ].filter((b) => !!b)}
      />
      <header class="editor-head">
        <ItemIcon type={item.type} />
        <div class="editor-head-text">
          <span class="eyebrow truncate">{typeLabel}を編集</span>
          <h1 class="truncate">{item.title}</h1>
        </div>
        <div class="editor-head-actions">
          <Button href={base} variant="ghost" icon="eye" aria-label="表示">
            <span class="hide-sm">表示</span>
          </Button>
          <Button type="submit" form="item-form" variant="primary" icon="check" title="保存（⌘S / Ctrl+S）" data-save-shortcut>
            保存
          </Button>
        </div>
      </header>

      <div class="editor">
        <form
          id="item-form"
          method="post"
          action={base}
          enctype="multipart/form-data"
          class="editor-form"
          data-loading-form
          {...validateWith('itemEdit')}
        >
          <input type="hidden" name="type" value={item.type} />
          <Card class="editor-main stack">
            <TextField label="タイトル" name="title" value={v.title} error={errors.title} class="editor-title" />
            {item.type === 'link' && (
              <TextField label="URL" name="url" type="url" value={v.url} error={errors.url} placeholder="https://" />
            )}
            {item.type === 'link' && <LinkTargetField id="f-link-target" value={v.linkTarget} />}
            <MarkdownEditor
              label={item.type === 'page' ? '本文' : item.type === 'code' ? '問題文' : '説明（任意）'}
              name="body"
              value={v.body}
              error={errors.body}
              rows={item.type === 'page' ? 18 : item.type === 'code' ? 10 : 5}
            />
            {code && <CodeStarterFields language={code.language} starter={v.starter} stdin={v.stdin} errors={errors} />}
            {code && <CodeGradingFields gradingEnabled={gradingEnabled} criteria={v.criteria} maxScore={v.maxScore} errors={errors} />}
          </Card>

          <aside class="editor-side">
            <Card heading="公開と配置">
              <div class="stack">
                <fieldset class="field">
                  <legend>学生への表示</legend>
                  <SegmentedControl
                    name="hidden"
                    label="学生への表示"
                    options={[
                      { value: '0', label: '表示', icon: 'eye' },
                      { value: '1', label: '非表示', icon: 'eyeSlash' },
                    ]}
                    value={String(v.hidden)}
                  />
                </fieldset>
                <SelectField
                  label="セクション"
                  name="section_id"
                  id="f-section"
                  options={sections.map((s) => ({ value: String(s.id), label: s.title }))}
                  value={String(v.sectionId)}
                />
                {!!access.course.completionEnabled && (
                  <CompletionField type={item.type} id="f-completion" value={v.completion} error={errors.completion} />
                )}
              </div>
            </Card>
            {item.type === 'file' && (
              <Card heading="ファイル">
                <div class="stack">
                  <FileChip name={item.fileName ?? ''} meta={`現在のファイル・${formatBytes(item.fileSize ?? 0)}`} />
                  <FormField
                    id="f-file"
                    error={errors.file}
                    label="差し替えるファイル"
                    hint={`選ばなければ今のファイルのまま（最大 ${formatBytes(MAX_FILE_SIZE)}）`}
                  >
                    <FileInput
                      id="f-file"
                      name="file"
                      aria-invalid={errors.file ? 'true' : undefined}
                      aria-describedby="f-file-error f-file-desc"
                    />
                  </FormField>
                </div>
              </Card>
            )}
          </aside>
        </form>

        <Card tone="danger" class="editor-danger">
          <DangerRow heading="アイテムを削除" description={`学生の${code ? '提出と' : ''}完了記録も消え、元に戻せません。`}>
            <form method="post" action={`${base}/delete`} data-confirm={`「${item.title}」を削除しますか？`}>
              <Button type="submit" variant="danger-outline" size="sm" icon="trash">
                削除
              </Button>
            </form>
          </DangerRow>
        </Card>
      </div>
    </AppShell>
  )
}

export const ItemPage = ({
  access,
  item,
  section,
  sections,
  outline,
  done,
  prev,
  next,
  sharing,
  textPreview,
  code,
  revision,
}: {
  access: CourseAccess
  item: Item
  section?: OutlineSection
  sections: OutlineSection[]
  outline: OutlineItem[]
  done: Set<number>
  prev?: OutlineItem
  next?: OutlineItem
  sharing: boolean
  textPreview: string | null
  code?: CodeView
  revision: string
}) => {
  const id = access.course.id
  const isStudent = access.role === 'student'
  const isDone = done.has(item.id)
  const base = `/courses/${id}/items`
  const fileUrl = `${base}/${item.id}/file`
  const preview = item.type === 'file' ? previewKind(item.fileType ?? '', item.fileName ?? '') : null
  const previewUrl = `${fileUrl}?inline=1`

  const isTracked = (o: OutlineItem) => !!access.course.completionEnabled && o.completion !== 'none'
  const completeUrl = (o: OutlineItem) => `${base}/${o.id}/complete`
  // 完了済みなら付けないのは、開くたびに送って、すでに付いている完了を書き直さないため
  const waitsFor = (o: OutlineItem, completion: 'view' | 'play') =>
    isStudent && isTracked(o) && o.completion === completion && !done.has(o.id)
  const onOpen = (o: OutlineItem) => (waitsFor(o, 'view') ? { 'data-complete-on-open': completeUrl(o) } : {})
  const embedded = item.type === 'link' && item.linkTarget === 'embed'
  const opensOnView = item.type === 'page' || embedded || !!code || (!!preview && (preview !== 'text' || textPreview !== null))
  const tracked = outline.filter(isTracked)

  const navHref = (o: OutlineItem) => `${base}/${o.id}`
  const opensNewTab = (o: OutlineItem) =>
    o.type === 'screen' || (o.type === 'file' && previewKind(o.fileType ?? '', o.fileName ?? '') === 'pdf')
  const hiddenSections = new Set(sections.filter((s) => s.hidden).map((s) => s.id))
  const isHidden = (o: OutlineItem) => !!o.hidden || hiddenSections.has(o.sectionId)
  const siblings = outline.filter((o) => o.sectionId === item.sectionId)
  const position = siblings.findIndex((o) => o.id === item.id) + 1
  const outlineSections = sections
    .map((s) => ({ section: s, items: outline.filter((o) => o.sectionId === s.id) }))
    .filter((s) => access.canManage || s.items.length > 0)

  const pdf = preview === 'pdf'
  const crumbs = (
    <Breadcrumbs
      items={[
        { href: '/courses', label: 'コース一覧' },
        { href: `/courses/${id}`, label: access.course.title },
      ]}
    />
  )
  const head = (
    <>
      <header class="reader-head">
        {section && position > 0 && (
          <span class="eyebrow">
            <a href={editUrl(id, section.id)}>{section.title}</a> · {position} / {siblings.length}
          </span>
        )}
        <ItemIcon type={item.type} />
        <h1>{item.title}</h1>
        {access.canManage && (
          <Button href={`${base}/${item.id}/edit`} variant="ghost" size="sm" icon="pencil">
            編集
          </Button>
        )}
      </header>
      {access.canManage && isHidden(item) && (
        <Alert tone="info">
          {item.hidden ? 'このアイテム' : 'このアイテムのセクション'}は学生に非表示です。学生のコース画面には表示されず、URL
          を開いても見つかりません。
        </Alert>
      )}
    </>
  )

  const barCrumbs = [
    { href: '/courses', label: 'コース一覧' },
    { href: `/courses/${id}`, label: access.course.title },
    ...(section && position > 0 ? [{ href: editUrl(id, section.id), label: `${section.title} · ${position} / ${siblings.length}` }] : []),
  ]
  const hiddenNote =
    access.canManage && isHidden(item) ? `${item.hidden ? 'このアイテム' : 'このアイテムのセクション'}は学生に非表示です。` : undefined
  const editButton = access.canManage && (
    <Button href={`${base}/${item.id}/edit`} variant="ghost" size="sm" icon="pencil" aria-label="編集">
      <span class="hide-sm">編集</span>
    </Button>
  )

  const pdfBar = pdf ? (
    <PdfBar crumbs={barCrumbs} title={item.title} hiddenNote={hiddenNote}>
      {editButton}
      <Button href={fileUrl} size="sm" icon="download" aria-label="ダウンロード" data-no-prefetch download {...onOpen(item)}>
        <span class="hide-sm">ダウンロード</span>
      </Button>
    </PdfBar>
  ) : undefined

  const codeBar = code ? (
    <ItemBar type="code" crumbs={barCrumbs} title={item.title} hiddenNote={hiddenNote}>
      {editButton}
      <CodeBarActions base={`${base}/${item.id}/code`} canManage={access.canManage} isStudent={isStudent} grade={code.grade} />
    </ItemBar>
  ) : undefined

  return (
    <AppShell tone={access.course.color} topbar={pdfBar ?? codeBar}>
      <Styles use={['/src/routes/content/content.css']} />
      {pdf ? (
        <PdfStage src={previewUrl} title={item.fileName ?? 'プレビュー'} />
      ) : code ? (
        <CodeWorkspace base={`${base}/${item.id}/code`} language={code.language} body={item.body} canRun={code.canRun} />
      ) : (
        crumbs
      )}
      <div class="reader">
        <article class="reader-main">
          {!pdf && !code && head}
          {code?.grade && <CodeGrade grade={code.grade} pollUrl={`${base}/${item.id}/code/grading`} />}

          {item.type === 'link' && embedded && <LinkEmbed url={item.url} title={item.title} />}

          {item.type === 'link' && !embedded && (
            <LinkCard
              icon="link"
              class={`link-card-lg kind-${item.type}`}
              {...linkOpenAttrs(item.url, item.linkTarget, navHref(item))}
              {...onOpen(item)}
            >
              <span class="file-name">
                <span class="strong">外部サイトを開く</span>
                <span class="muted small truncate">{hostName(item.url)}</span>
              </span>
              <Button as="span" variant="primary" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.type === 'screen' && (
            <LinkCard
              href={`${base}/${item.id}/screen`}
              icon="monitor"
              class={`link-card-lg kind-${item.type}`}
              target="_blank"
              rel="noopener"
              data-no-prefetch
            >
              <span class="file-name">
                <span class="strong">画面共有を開く</span>
                <span class="muted small truncate">別のタブで開きます</span>
              </span>
              {sharing && <Chip tone="live">配信中</Chip>}
              <Button as="span" variant="primary" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.type === 'file' && !pdf && (
            <>
              <LinkCard icon="file" class={`link-card-lg kind-${item.type}`}>
                <span class="file-name">
                  <span class="strong">ファイルをダウンロード</span>
                  <span class="file-meta muted small">
                    <span class="truncate">{item.fileName}</span>
                    <span>{formatBytes(item.fileSize ?? 0)}</span>
                  </span>
                </span>
                <Button href={fileUrl} variant="primary" icon="download" data-no-prefetch download {...onOpen(item)}>
                  ダウンロード
                </Button>
              </LinkCard>
              {textPreview !== null && (
                <div class="file-preview-text">
                  <pre>{textPreview}</pre>
                  {(item.fileSize ?? 0) > TEXT_PREVIEW_MAX && (
                    <p class="muted small">
                      先頭の {formatBytes(TEXT_PREVIEW_MAX)} だけを表示しています。全体はダウンロードして確認してください。
                    </p>
                  )}
                </div>
              )}
              {preview === 'image' && <img class="file-preview-img" src={previewUrl} alt={item.title} loading="lazy" />}
              {preview === 'video' && (
                <video
                  class="file-preview-video"
                  src={previewUrl}
                  controls
                  preload="metadata"
                  data-complete-on-ended={waitsFor(item, 'play') ? completeUrl(item) : undefined}
                />
              )}
              {preview === 'audio' && (
                <audio
                  class="file-preview-audio"
                  src={previewUrl}
                  controls
                  preload="metadata"
                  data-complete-on-ended={waitsFor(item, 'play') ? completeUrl(item) : undefined}
                />
              )}
            </>
          )}

          {!code && (item.body || item.type === 'page') && (
            <div class="reader-sheet">{item.body ? <Markdown source={item.body} /> : <p class="muted">本文はまだありません。</p>}</div>
          )}

          {waitsFor(item, 'view') && opensOnView && <span hidden data-complete-on-view={completeUrl(item)} />}

          {isStudent && isTracked(item) && item.completion !== 'manual' && (
            <div class="complete-bar">
              <CompletionStatus itemId={item.id} type={item.type} completion={item.completion} done={isDone} />
            </div>
          )}

          {isStudent && isTracked(item) && item.completion === 'manual' && (
            <form method="post" action={completeUrl(item)} class="complete-bar" data-complete>
              <Button
                type="submit"
                variant={isDone ? 'success' : next ? 'default' : 'primary'}
                size="lg"
                icon="check"
                aria-pressed={isDone ? 'true' : 'false'}
                data-complete-secondary={!isDone && next ? '' : undefined}
              >
                <span data-complete-label>{isDone ? '完了済み' : '完了にする'}</span>
              </Button>
              {!isDone && next && (
                <Button type="submit" variant="primary" size="lg" iconEnd="chevronRight" data-complete-then={navHref(next)}>
                  完了して次へ
                </Button>
              )}
            </form>
          )}

          <nav class="pager" aria-label="前後のアイテム">
            {prev && (
              <a href={navHref(prev)} class="pager-link pager-prev">
                <span class="pager-arrow">
                  <Icon name="chevronLeft" size={18} />
                </span>
                <span class="pager-text">
                  <span class="pager-label muted small">前へ</span>
                  <span class="pager-title truncate">{prev.title}</span>
                </span>
              </a>
            )}
            <a href={next ? navHref(next) : `/courses/${id}`} class="pager-link pager-next">
              <span class="pager-text">
                <span class="pager-label muted small">{next ? '次へ' : 'コースへ'}</span>
                <span class="pager-title truncate">{next ? next.title : access.course.title}</span>
              </span>
              <span class="pager-arrow">
                <Icon name="chevronRight" size={18} />
              </span>
            </a>
          </nav>
        </article>

        <aside class="reader-outline" aria-label="コースの目次">
          <div class="outline-head">
            <a href={`/courses/${id}`} class="strong truncate">
              {access.course.title}
            </a>
            {isStudent && tracked.length > 0 && (
              <span class="muted small">
                <span data-progress-done>{tracked.filter((o) => done.has(o.id)).length}</span> / {tracked.length} 完了
              </span>
            )}
          </div>
          {outlineSections.map(({ section: s, items }) => (
            <div class={cx('outline-section', items.length === 0 && 'is-empty')}>
              <div class={cx('outline-title', !!s.hidden && 'is-hidden')}>
                {s.title}
                {!!s.hidden && <Icon name="eyeSlash" size={12} />}
                {items.length === 0 && <span class="outline-count">0</span>}
              </div>
              {items.length > 0 && (
                <ul>
                  {items.map((o) => (
                    <li>
                      <a
                        href={o.type === 'screen' ? `${navHref(o)}/screen` : navHref(o)}
                        class={cx('outline-link', o.id === item.id && 'active', isHidden(o) && 'is-hidden')}
                        {...(opensNewTab(o) ? { target: '_blank', rel: 'noopener', 'data-no-prefetch': '' } : {})}
                        {...(o.type === 'link' ? linkOpenAttrs(o.url, o.linkTarget, navHref(o)) : {})}
                        aria-current={o.id === item.id ? 'page' : undefined}
                        {...(o.type === 'link' && o.linkTarget !== 'embed' ? onOpen(o) : {})}
                      >
                        {isTracked(o) ? (
                          <span class={cx('outline-dot', done.has(o.id) && 'done')} data-outline-dot={o.id}>
                            {done.has(o.id) && <Icon name="check" size={10} />}
                          </span>
                        ) : (
                          <Icon name={ITEM_ICONS[o.type]} size={14} class="outline-kind" />
                        )}
                        <span class="truncate">{o.title}</span>
                        {!!o.hidden && <Icon name="eyeSlash" size={12} class="outline-hidden" />}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </aside>
      </div>
      <CourseLiveSync courseId={id} revision={revision} />
    </AppShell>
  )
}
