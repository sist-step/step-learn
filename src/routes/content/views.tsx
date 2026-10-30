import { ItemIcon } from '../../components/course'
import { cx } from '../../components/cx'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Button } from '../../components/button'
import { FileInput, FormField, SegmentedControl, SelectField, TextField } from '../../components/form'
import { Markdown, MarkdownEditor } from '../../components/markdown'
import { Card, DangerRow, LinkCard } from '../../components/card'
import { Alert, Breadcrumbs, Chip } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import { MAX_FILE_SIZE, formatBytes } from '../../lib/storage'
import { ITEM_TYPE_LABELS, type Item, type Section } from '../../lib/types'

export type ItemInput = { title: string; body: string; url: string; file: File | null }

export type OutlineItem = Pick<Item, 'id' | 'sectionId' | 'type' | 'title' | 'url' | 'hidden'>

export type OutlineSection = Pick<Section, 'id' | 'title' | 'hidden'>

export const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif))$/

export const editUrl = (courseId: number, sectionId?: number) => `/courses/${courseId}${sectionId ? `#section-${sectionId}` : ''}`

export const ItemEditPage = ({
  access,
  item,
  sections,
  values,
  error,
}: {
  access: CourseAccess
  item: Item
  sections: Section[]
  values?: Partial<ItemInput> & { hidden?: number; sectionId?: number }
  error?: string
}) => {
  const courseId = access.course.id
  const base = `/courses/${courseId}/items/${item.id}`
  const v = { title: item.title, body: item.body, url: item.url, hidden: item.hidden, sectionId: item.sectionId, ...values }
  const section = sections.find((s) => s.id === item.sectionId)
  const typeLabel = ITEM_TYPE_LABELS[item.type]
  return (
    <AppShell wide>
      <Styles use={['/src/routes/content/content.css']} />
      <Breadcrumbs
        items={[
          { href: '/courses', label: 'コース' },
          { href: editUrl(courseId, item.sectionId), label: access.course.code || access.course.title },
          { label: section?.title },
        ]}
      />
      <header class="editor-head">
        <ItemIcon type={item.type} />
        <div class="editor-head-text">
          <span class="eyebrow">{typeLabel}を編集</span>
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
        <form id="item-form" method="post" action={base} enctype="multipart/form-data" class="editor-form" data-loading-form>
          <Card class="editor-main stack">
            {error && <Alert>{error}</Alert>}
            <TextField label="タイトル" name="title" value={v.title} required maxlength={200} class="editor-title" />
            {item.type === 'link' && <TextField label="URL" name="url" type="url" value={v.url} required placeholder="https://" />}
            <MarkdownEditor
              label={item.type === 'page' ? '本文' : '説明（任意）'}
              name="body"
              value={v.body}
              rows={item.type === 'page' ? 18 : 5}
            />
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
              </div>
            </Card>
            {item.type === 'file' && (
              <Card heading="ファイル">
                <FormField
                  id="f-file"
                  label="差し替えるファイル"
                  hint={`選ばなければ今のファイルのまま（最大 ${formatBytes(MAX_FILE_SIZE)}）`}
                >
                  <div class="file-current">
                    <Icon name="file" />
                    <span class="truncate">{item.fileName}</span>
                    <span class="muted small">{formatBytes(item.fileSize ?? 0)}</span>
                  </div>
                  <FileInput id="f-file" name="file" aria-describedby="f-file-desc" />
                </FormField>
              </Card>
            )}
          </aside>
        </form>

        <Card tone="danger" class="editor-danger">
          <DangerRow heading="アイテムを削除" description="学生の完了記録も消え、元に戻せません。">
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
}) => {
  const id = access.course.id
  const isStudent = access.role === 'student'
  const isDone = done.has(item.id)
  const base = `/courses/${id}/items`
  const fileUrl = `${base}/${item.id}/file`
  const canPreview = item.type === 'file' && PREVIEWABLE.test(item.fileType ?? '')

  const navHref = (o: OutlineItem) => `${base}/${o.id}`
  const hiddenSections = new Set(sections.filter((s) => s.hidden).map((s) => s.id))
  const isHidden = (o: OutlineItem) => !!o.hidden || hiddenSections.has(o.sectionId)

  return (
    <AppShell wide>
      <Styles use={['/src/routes/content/content.css']} />
      <div class="reader">
        <article class="reader-main">
          <Breadcrumbs items={[{ href: `/courses/${id}`, label: access.course.title }, { label: section?.title }]} />
          <header class="reader-head">
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

          {item.type === 'link' && (
            <LinkCard href={item.url} icon="link" target="_blank" rel="noopener noreferrer" data-no-prefetch>
              <span class="truncate">{item.url}</span>
              <Button as="span" variant="primary" size="sm" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.type === 'screen' && (
            <LinkCard href={`${base}/${item.id}/screen`} icon="monitor" target="_blank" rel="noopener" data-no-prefetch>
              <span class="truncate">別のタブで画面共有を開きます</span>
              {sharing && <Chip tone="live">配信中</Chip>}
              <Button as="span" variant="primary" size="sm" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.type === 'file' && (
            <>
              <LinkCard icon="file">
                <span class="file-name">
                  <span class="truncate strong">{item.fileName}</span>
                  <span class="muted small">{formatBytes(item.fileSize ?? 0)}</span>
                </span>
                <Button href={fileUrl} variant="primary" size="sm" icon="download" data-no-prefetch download>
                  ダウンロード
                </Button>
              </LinkCard>
              {canPreview &&
                (item.fileType === 'application/pdf' ? (
                  <iframe class="file-preview" src={`${fileUrl}?inline=1`} title={item.fileName ?? 'プレビュー'} loading="lazy" />
                ) : (
                  <img class="file-preview-img" src={`${fileUrl}?inline=1`} alt={item.title} loading="lazy" />
                ))}
            </>
          )}

          {item.body ? <Markdown source={item.body} /> : item.type === 'page' && <p class="muted">本文はまだありません。</p>}

          {isStudent && (
            <form method="post" action={`${base}/${item.id}/complete`} class="complete-bar" data-complete>
              <Button
                type="submit"
                variant={isDone ? 'success' : 'primary'}
                size="lg"
                icon="check"
                aria-pressed={isDone ? 'true' : 'false'}
              >
                <span data-complete-label>{isDone ? '完了済み' : '完了にする'}</span>
              </Button>
            </form>
          )}

          <nav class="pager" aria-label="前後のアイテム">
            {prev ? (
              <a href={navHref(prev)} class="pager-link">
                <span class="muted small">
                  <Icon name="chevronLeft" size={14} /> 前へ
                </span>
                <span class="truncate">{prev.title}</span>
              </a>
            ) : (
              <span />
            )}
            {next ? (
              <a href={navHref(next)} class="pager-link pager-next">
                <span class="muted small">
                  次へ <Icon name="chevronRight" size={14} />
                </span>
                <span class="truncate">{next.title}</span>
              </a>
            ) : (
              <a href={`/courses/${id}`} class="pager-link pager-next">
                <span class="muted small">
                  コースへ <Icon name="chevronRight" size={14} />
                </span>
                <span class="truncate">{access.course.title}</span>
              </a>
            )}
          </nav>
        </article>

        <aside class="reader-outline" aria-label="コースの目次">
          <div class="outline-head">
            <a href={`/courses/${id}`} class="strong truncate">
              {access.course.title}
            </a>
            {isStudent && (
              <span class="muted small">
                {outline.filter((o) => done.has(o.id)).length} / {outline.length} 完了
              </span>
            )}
          </div>
          {sections.map((s) => (
            <div class="outline-section">
              <div class={cx('outline-title', !!s.hidden && 'is-hidden')}>
                {s.title}
                {!!s.hidden && <Icon name="eyeSlash" size={12} />}
              </div>
              <ul>
                {outline
                  .filter((o) => o.sectionId === s.id)
                  .map((o) => (
                    <li>
                      <a
                        href={o.type === 'link' ? o.url : o.type === 'screen' ? `${navHref(o)}/screen` : navHref(o)}
                        class={cx('outline-link', o.id === item.id && 'active', isHidden(o) && 'is-hidden')}
                        {...(o.type === 'link' || o.type === 'screen'
                          ? { target: '_blank', rel: o.type === 'link' ? 'noopener noreferrer' : 'noopener', 'data-no-prefetch': '' }
                          : {})}
                        aria-current={o.id === item.id ? 'page' : undefined}
                      >
                        <span class={done.has(o.id) ? 'outline-dot done' : 'outline-dot'} data-outline-dot={o.id}>
                          {done.has(o.id) && <Icon name="check" size={10} />}
                        </span>
                        <span class="truncate">{o.title}</span>
                        {!!o.hidden && <Icon name="eyeSlash" size={12} class="outline-hidden" />}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </AppShell>
  )
}
