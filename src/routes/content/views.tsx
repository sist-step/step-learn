import { raw } from 'hono/html'
import { CourseHeader, ItemIcon } from '../../components/course'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Button } from '../../components/button'
import { FileInput, FormField, SelectField, TextAreaField, TextField } from '../../components/form'
import { Card, LinkCard } from '../../components/card'
import { Alert, Breadcrumbs, Chip } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import { renderMarkdown } from '../../lib/markdown'
import { MAX_FILE_SIZE, formatBytes } from '../../lib/storage'
import { ITEM_TYPE_LABELS, type Item, type Section } from '../../lib/types'

export type ItemInput = { title: string; body: string; url: string; file: File | null }

export type OutlineItem = Pick<Item, 'id' | 'sectionId' | 'type' | 'title' | 'url'>

export type OutlineSection = Pick<Section, 'id' | 'title'>

export const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif))$/

export const editUrl = (courseId: number, sectionId?: number) =>
  `/courses/${courseId}${sectionId ? `#section-${sectionId}` : ''}`

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
  values?: Partial<ItemInput>
  error?: string
}) => {
  const courseId = access.course.id
  const base = `/courses/${courseId}/items/${item.id}`
  const v = { title: item.title, body: item.body, url: item.url, ...values }
  return (
    <AppShell wide>
      <Styles use={['/src/routes/content/content.css']} />
      <CourseHeader access={access} tab="content" />
      <div class="narrow">
        <a href={editUrl(courseId, item.sectionId)} class="back-link">
          <Icon name="chevronLeft" size={16} /> コースに戻る
        </a>
        <Card
          as="form"
          method="post"
          action={base}
          enctype="multipart/form-data"
          class="stack"
          data-loading-form
          leading={<ItemIcon type={item.type} />}
          heading={`${ITEM_TYPE_LABELS[item.type]}を編集`}
        >
          {error && <Alert>{error}</Alert>}
          <TextField label="タイトル" name="title" value={v.title} required maxlength={200} />
          <SelectField
            label="セクション"
            name="section_id"
            id="f-section"
            options={sections.map((s) => ({ value: String(s.id), label: s.title }))}
            value={String(item.sectionId)}
          />
          {item.type === 'link' && <TextField label="URL" name="url" type="url" value={v.url} required />}
          {item.type === 'file' && (
            <FormField id="f-file" label="ファイル" hint={`差し替える場合は新しいファイルを選択（最大 ${formatBytes(MAX_FILE_SIZE)}）`}>
              <div class="file-current">
                <Icon name="file" />
                <span class="truncate">{item.fileName}</span>
                <span class="muted small">{formatBytes(item.fileSize ?? 0)}</span>
              </div>
              <FileInput id="f-file" name="file" aria-describedby="f-file-desc" />
            </FormField>
          )}
          <TextAreaField
            label={item.type === 'page' ? '本文' : '説明（任意）'}
            name="body"
            value={v.body}
            rows={item.type === 'page' ? 16 : 4}
            hint="Markdown が使えます：# 見出し、**太字**、*斜体*、- 箇条書き、1. 番号付き、> 引用、```コード```、[リンク](https://…)"
          />
          <div class="form-actions">
            <Button href={editUrl(courseId, item.sectionId)} variant="ghost">
              キャンセル
            </Button>
            <Button type="submit" variant="primary">
              保存
            </Button>
          </div>
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

          {item.body ? (
            <div class="prose">{raw(renderMarkdown(item.body))}</div>
          ) : (
            item.type === 'page' && <p class="muted">本文はまだありません。</p>
          )}

          {isStudent && (
            <form method="post" action={`${base}/${item.id}/complete`} class="complete-bar" data-complete>
              <Button type="submit" variant={isDone ? 'success' : 'primary'} size="lg" icon="check" aria-pressed={isDone ? 'true' : 'false'}>
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
                {done.size} / {outline.length} 完了
              </span>
            )}
          </div>
          {sections.map((s) => (
            <div class="outline-section">
              <div class="outline-title">{s.title}</div>
              <ul>
                {outline
                  .filter((o) => o.sectionId === s.id)
                  .map((o) => (
                    <li>
                      <a
                        href={o.type === 'link' ? o.url : o.type === 'screen' ? `${navHref(o)}/screen` : navHref(o)}
                        class={o.id === item.id ? 'outline-link active' : 'outline-link'}
                        {...(o.type === 'link' || o.type === 'screen'
                          ? { target: '_blank', rel: o.type === 'link' ? 'noopener noreferrer' : 'noopener', 'data-no-prefetch': '' }
                          : {})}
                        aria-current={o.id === item.id ? 'page' : undefined}
                      >
                        <span class={done.has(o.id) ? 'outline-dot done' : 'outline-dot'} data-outline-dot={o.id}>
                          {done.has(o.id) && <Icon name="check" size={10} />}
                        </span>
                        <span class="truncate">{o.title}</span>
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
