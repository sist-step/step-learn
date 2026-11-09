import type { Child } from 'hono/jsx'
import { IconButton } from './button'
import { ItemIcon } from './course'
import { Input, SegmentedControl, type SegmentOption } from './form'
import { useStyle } from './style'
import { Breadcrumbs, Chip, type Crumb } from './ui'

const PDF_MODE_OPTIONS = [
  { value: 'viewer', label: 'ビューアー', icon: 'page' },
  { value: 'browser', label: 'ブラウザ', icon: 'globe' },
] as const satisfies readonly SegmentOption[]

export const PdfBar = ({
  crumbs,
  title,
  hiddenNote,
  children,
}: {
  crumbs: readonly Crumb[]
  title: string
  hiddenNote?: string
  children?: Child
}) => {
  useStyle('/src/components/pdf.css')
  return (
    <div class="pdf-bar">
      <ItemIcon type="file" />
      <div class="pdf-bar-text">
        <Breadcrumbs items={crumbs} />
        <h1 class="truncate" title={title}>
          {title}
        </h1>
      </div>
      {hiddenNote && (
        <Chip icon="eyeSlash" class="pdf-bar-hidden" title={hiddenNote}>
          非表示
        </Chip>
      )}
      <div class="pdf-bar-actions">
        <SegmentedControl name="pdf-mode" label="PDF の表示方法" options={PDF_MODE_OPTIONS} class="pdf-mode" data-pdf-mode />
        {children}
      </div>
    </div>
  )
}

export const PdfStage = ({ src, title }: { src: string; title: string }) => {
  useStyle('/src/components/pdf.css')
  return (
    <div class="pdf-stage">
      <div class="pdf-viewer" data-pdf-viewer={src}>
        <nav class="pdf-thumbs" id="pdf-thumbs" aria-label="ページの一覧" data-pdf-thumbs hidden />
        <div class="pdf-pages" data-pdf-pages tabindex={0} role="region" aria-label={title} />
        <p class="pdf-status muted" data-pdf-status>
          読み込んでいます…
        </p>
        <div class="pdf-toolbar" role="toolbar" aria-label="PDF の操作" data-pdf-toolbar hidden>
          <IconButton icon="pages" label="ページの一覧" aria-pressed="false" aria-controls="pdf-thumbs" data-pdf-action="thumbs" />
          <span class="pdf-toolbar-sep" />
          <IconButton icon="chevronLeft" label="前のページ" data-pdf-action="prev" />
          <span class="pdf-page-count">
            <Input class="pdf-page-input" inputmode="numeric" aria-label="ページ番号" value="1" data-pdf-page />
            <span class="muted">/</span>
            <span class="muted" data-pdf-count />
          </span>
          <IconButton icon="chevronRight" label="次のページ" data-pdf-action="next" />
          <span class="pdf-toolbar-sep" />
          <IconButton icon="zoomOut" label="縮小" data-pdf-action="zoom-out" />
          <output class="pdf-zoom" aria-label="表示倍率" data-pdf-zoom />
          <IconButton icon="zoomIn" label="拡大" data-pdf-action="zoom-in" />
          <IconButton icon="fitWidth" label="幅に合わせる" aria-pressed="false" data-pdf-action="fit" />
        </div>
      </div>
      {/* src を最初から入れないのは、ブラウザの表示に切り替えるまで同じ PDF を二重に読み込まないようにするため */}
      <iframe class="pdf-frame" title={title} data-pdf-frame={src} hidden />
    </div>
  )
}
