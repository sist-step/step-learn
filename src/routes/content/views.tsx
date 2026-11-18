import { AGENT_BODY_HINT, AgentEditPanel, AgentInstructionsField, AgentModelCard, AgentOpen, AgentPeriodCard } from '../../components/agent'
import { BundleEditPanel, BundleOpen, type BundleView } from '../../components/bundle'
import {
  CodeAiHelp,
  CodeFinalizedCard,
  CodeGradingCard,
  CodeOpen,
  CodePeriodCard,
  CodeSolutionCard,
  CodeStageCard,
  CodeStarterCard,
  type ConstraintRow,
  type GradeView,
} from '../../components/code'
import {
  CompletionField,
  CompletionStatus,
  CourseLiveSync,
  ITEM_FORM,
  ITEM_ICONS,
  ItemBar,
  ItemEditActions,
  ItemFileField,
  ItemIcon,
  LinkEmbed,
  LinkTargetField,
  linkOpenAttrs,
  OutlineToggle,
} from '../../components/course'
import { cx } from '../../components/cx'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Button } from '../../components/button'
import { SegmentedControl, SelectField, TextField, validateWith } from '../../components/form'
import { Markdown, MarkdownEditor } from '../../components/markdown'
import { Card, LinkCard } from '../../components/card'
import { PdfBar, PdfStage } from '../../components/pdf'
import { PresentationBar, PresentationEditNote, PresentationStage, type PresentationSummary } from '../../components/presentation'
import { QuizEditor, QuizGradingCard, QuizLookCard, QuizPanel } from '../../components/quiz'
import { CollabPanel, CollabSettingsCard } from '../../components/collab'
import { Alert, Breadcrumbs, Chip } from '../../components/ui'
import type { CollabSettings, CollabView } from '../../lib/collab'
import { agentBase, type AgentView } from '../../lib/agent'
import type { OpenRouterModelInfo } from '../../lib/ai-models'
import { bundleBase } from '../../lib/bundle'
import { isFinalized, type CodeFiles, type CodeLanguage, type CodeStage, type Goal, type Judge } from '../../lib/code'
import { unixToDateTimeInput } from '../../lib/course-period'
import type { CourseAccess } from '../../lib/courses'
import type { FieldErrors } from '../../lib/forms'
import { presentationBase } from '../../lib/presentation'
import { previewKind } from '../../lib/preview'
import { quizFormRows, type QuizFormRow, type QuizLook, type QuizSettings } from '../../lib/quiz'
import type { QuizView } from '../../lib/quiz-store'
import { formatBytes } from '../../lib/bytes'
import type { CodeItem, Item, Section } from '../../lib/types'

export type ItemInput = {
  title: string
  body: string
  url: string
  linkTarget: string
  file: File | null
  starter: CodeFiles
  stdin: string
  criteria: string
  constraints: ConstraintRow[]
  /** コードのアイテムの解答例と、提出の期間が終わったあと学生に見せるか */
  solution: CodeFiles
  solutionPublic: boolean
  /** 提出の期間（コード）・使える期間（コーディングエージェント）の、日時の入力欄の値 */
  opensAt: string
  closesAt: string
  /** コーディングエージェントの 1 人あたりの上限（入力欄の値） */
  userLimit: string
  /** コーディングエージェントの、教師が書く AI への指示 */
  instructions: string
  /** 小テストの問題・合格にする正解の割合（入力欄の値）・不正解の問題の正解を見せるか・学生に出す見た目 */
  questions: QuizFormRow[]
  passPercent: string
  showAnswers: number
  look: QuizLook
  /** コーディングエージェントの、選んだモデルの ID */
  model: string
}

/** コードのアイテムの言語と、見ている学生のいちばん新しい提出。goals は学生に見せるクリアの条件（制約のラベル） */
export type CodeView = { language: CodeLanguage; goals: Goal[]; grade: GradeView | null; solution: CodeFiles | null; stage: CodeStage }

export type OutlineItem = Pick<
  Item,
  'id' | 'sectionId' | 'type' | 'title' | 'url' | 'linkTarget' | 'fileName' | 'fileType' | 'hidden' | 'completion'
>

export type OutlineSection = Pick<Section, 'id' | 'title' | 'hidden'>

/** 学生がアクセス制限でまだ開けないアイテムと、目次にも出さないアイテム・セクション */
export type RestrictedOutline = { locked: Set<number>; hidden: Set<number>; hiddenSections: Set<number> }

const NO_RESTRICTION: RestrictedOutline = { locked: new Set(), hidden: new Set(), hiddenSections: new Set() }

export const TEXT_PREVIEW_MAX = 200 * 1024

export const editUrl = (courseId: number, sectionId?: number) => `/courses/${courseId}${sectionId ? `#section-${sectionId}` : ''}`

const hostName = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

const JUDGE_FORM = 'code-judge-form'
const PREPARE_FORM = 'code-prepare-form'
const DUPLICATE_FORM = 'code-duplicate-form'

export const ItemEditPage = ({
  access,
  item,
  code,
  preparing = false,
  bundle,
  presentation,
  agent,
  quiz,
  collab,
  agentModels = null,
  gradingEnabled,
  judge,
  sections,
  values,
  errors = {},
}: {
  access: CourseAccess
  item: Item
  code?: CodeItem
  /** コーディング問題の準備を、このプロセスで進めている */
  preparing?: boolean
  /** ファイル自動配布のアイテムで配るファイルと、同期の状態 */
  bundle?: BundleView
  /** 発表ファイルのアイテムの、今の PDF */
  presentation?: PresentationSummary
  /** コーディングエージェントのアイテムの設定と利用状況 */
  agent?: AgentView
  /** 小テストのアイテムの設定 */
  quiz?: QuizSettings
  /** 共同編集のアイテムの種類と分け方 */
  collab?: CollabSettings
  /** コーディングエージェントのアイテムで選べる OpenRouter のモデル。一覧を取れなければ null */
  agentModels?: OpenRouterModelInfo[] | null
  /** AI が設定されていて、提出を自動で採点するか */
  gradingEnabled: boolean
  /** 制約ごとの判定をするもの。切り替えられる開発サーバーでだけ渡す */
  judge?: Judge
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
    constraints: (code?.constraints ?? []).map((c) => ({ label: c.label, text: c.text, optional: !!c.optional })),
    solution: code?.solution ?? {},
    solutionPublic: code?.solutionPublic === 1,
    opensAt: unixToDateTimeInput(code?.opensAt ?? agent?.settings.opensAt ?? undefined),
    closesAt: unixToDateTimeInput(code?.closesAt ?? agent?.settings.closesAt ?? undefined),
    userLimit: agent ? String(agent.settings.userLimit) : '',
    instructions: agent?.settings.instructions ?? '',
    questions: quizFormRows(quiz?.questions ?? []),
    passPercent: quiz ? String(quiz.passPercent) : '',
    showAnswers: quiz?.showAnswers ?? 1,
    look: quiz?.look ?? 'plain',
    model: agent?.settings.model.id ?? '',
    ...values,
  }
  const finalized = !!code && isFinalized(code.stage)
  const section = sections.find((s) => s.id === item.sectionId)
  const crumbs = [
    { href: '/courses', label: 'コース一覧' },
    { href: `/courses/${courseId}`, label: access.course.title },
    ...(section ? [{ href: editUrl(courseId, section.id), label: section.title }] : []),
  ]
  const lost = `${bundle ? '配布するファイルと、' : presentation ? 'PDF と、' : ''}学生の${code ? '提出と' : bundle ? '変更履歴と' : agent ? '利用状況と' : quiz ? '受験の記録と' : collab ? 'ファイルと' : ''}完了記録も消え、元に戻せません。`
  return (
    <AppShell
      tone={access.course.color}
      topbar={
        <ItemBar type={item.type} crumbs={crumbs} title={item.title}>
          <ItemEditActions href={base} deleteAction={`${base}/delete`} deleteConfirm={`「${item.title}」を削除しますか？${lost}`} />
        </ItemBar>
      }
    >
      <Styles use={['/src/routes/content/content.css']} />
      <div class="item-editor">
        <form
          id={ITEM_FORM}
          method="post"
          action={base}
          enctype="multipart/form-data"
          class="editor-form"
          data-loading-form
          data-ai-watch={`item:${item.id}`}
          {...validateWith('itemEdit')}
        >
          <input type="hidden" name="type" value={item.type} />
          <Card class="editor-main stack">
            <TextField label="タイトル" name="title" value={v.title} error={errors.title} class="editor-title" />
            {item.type === 'link' && (
              <div class="editor-link">
                <TextField label="URL" name="url" type="url" value={v.url} error={errors.url} placeholder="https://" />
                <LinkTargetField id="f-link-target" value={v.linkTarget} />
              </div>
            )}
            {item.type === 'file' && <ItemFileField name={item.fileName ?? ''} size={item.fileSize ?? 0} error={errors.file} />}
            {presentation && <PresentationEditNote summary={presentation} />}
            {finalized ? (
              <div class="field">
                <span class="strong small">問題文</span>
                <div class="reader-sheet">
                  <Markdown source={v.body || '（問題文はありません）'} />
                </div>
              </div>
            ) : (
              <MarkdownEditor
                label={item.type === 'page' ? '本文' : item.type === 'code' ? '問題文' : '説明（任意）'}
                name="body"
                value={v.body}
                error={errors.body}
                hint={agent ? AGENT_BODY_HINT : undefined}
                rows={item.type === 'page' ? 18 : item.type === 'code' ? 10 : 5}
                split
              />
            )}
            {agent && <AgentInstructionsField value={v.instructions} error={errors.instructions} />}
            {code && !finalized && (
              <CodeAiHelp
                suggest={gradingEnabled ? `${base}/code/suggest` : undefined}
                item={{ courseId, itemId: item.id, title: item.title }}
              />
            )}
          </Card>
          {code && finalized && (
            <CodeFinalizedCard
              code={{
                language: code.language,
                starter: code.starter,
                stdin: code.stdin,
                criteria: code.criteria,
                constraints: v.constraints,
                solution: code.solution,
                solutionPublic: v.solutionPublic,
                guides: code.guides,
              }}
            />
          )}
          {code && !finalized && <CodeStarterCard language={code.language} starter={v.starter} stdin={v.stdin} errors={errors} />}
          {code && !finalized && (
            <CodeSolutionCard
              language={code.language}
              solution={v.solution}
              solutionPublic={v.solutionPublic}
              trial={gradingEnabled ? `${base}/code/trial` : undefined}
              errors={errors}
            />
          )}
          {code && !finalized && (
            <CodeGradingCard
              gradingEnabled={gradingEnabled}
              criteria={v.criteria}
              constraints={v.constraints}
              suggest={gradingEnabled ? `${base}/code/constraints` : undefined}
              judge={judge && { current: judge, form: JUDGE_FORM }}
              errors={errors}
            />
          )}
          {quiz && <QuizEditor rows={v.questions} errors={errors} />}

          <aside class="editor-side">
            {code && (
              <CodeStageCard
                stage={code.stage}
                running={preparing}
                forms={{ finalize: ITEM_FORM, prepare: PREPARE_FORM, duplicate: DUPLICATE_FORM }}
              />
            )}
            {code && <CodePeriodCard opensAt={v.opensAt} closesAt={v.closesAt} errors={errors} />}
            {quiz && <QuizGradingCard passPercent={v.passPercent} showAnswers={v.showAnswers} errors={errors} />}
            {quiz && <QuizLookCard look={v.look} />}
            {collab && <CollabSettingsCard settings={collab} />}
            {agent && <AgentModelCard value={v.model} saved={agent.settings.model} models={agentModels} error={errors.agent_model} />}
            {agent && <AgentPeriodCard opensAt={v.opensAt} closesAt={v.closesAt} userLimit={v.userLimit} errors={errors} />}
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
          </aside>
        </form>

        {bundle && <BundleEditPanel base={bundleBase(courseId, item.id)} {...bundle} class="editor-extra" />}
        {agent?.manage && (
          <AgentEditPanel base={agentBase(courseId, item.id)} settings={agent.settings} manage={agent.manage} class="editor-extra" />
        )}

        {judge && code && <form id={JUDGE_FORM} method="post" action={`${base}/judge`} hidden />}
        {code && <form id={PREPARE_FORM} method="post" action={`${base}/prepare`} hidden data-loading-form />}
        {code && <form id={DUPLICATE_FORM} method="post" action={`${base}/duplicate`} hidden data-loading-form />}
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
  restricted = NO_RESTRICTION,
  done,
  prev,
  next,
  sharing,
  textPreview,
  code,
  bundle,
  agent,
  quiz,
  collab,
  revision,
}: {
  access: CourseAccess
  item: Item
  section?: OutlineSection
  sections: OutlineSection[]
  outline: OutlineItem[]
  restricted?: RestrictedOutline
  done: Set<number>
  prev?: OutlineItem
  next?: OutlineItem
  sharing: boolean
  textPreview: string | null
  code?: CodeView
  bundle?: BundleView
  agent?: AgentView
  quiz?: QuizView
  collab?: CollabView
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
  const opensOnView =
    item.type === 'page' ||
    item.type === 'presentation' ||
    item.type === 'bundle' ||
    item.type === 'agent' ||
    item.type === 'quiz' ||
    item.type === 'collab' ||
    embedded ||
    !!code ||
    (!!preview && (preview !== 'text' || textPreview !== null))
  const tracked = outline.filter(isTracked)

  const navHref = (o: OutlineItem) => `${base}/${o.id}`
  const opensNewTab = (o: OutlineItem) =>
    o.type === 'screen' || o.type === 'presentation' || (o.type === 'file' && previewKind(o.fileType ?? '', o.fileName ?? '') === 'pdf')
  const hiddenSections = new Set(sections.filter((s) => s.hidden).map((s) => s.id))
  const isHidden = (o: OutlineItem) => !!o.hidden || hiddenSections.has(o.sectionId)
  const listed = outline.filter((o) => !restricted.hidden.has(o.id))
  const siblings = listed.filter((o) => o.sectionId === item.sectionId)
  const position = siblings.findIndex((o) => o.id === item.id) + 1
  const outlineSections = sections
    .filter((s) => !restricted.hiddenSections.has(s.id))
    .map((s) => ({ section: s, items: listed.filter((o) => o.sectionId === s.id) }))
    .filter((s) => access.canManage || s.items.length > 0)

  const pdf = preview === 'pdf'
  const presenting = item.type === 'presentation'
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
  ) : presenting ? (
    <PresentationBar
      crumbs={barCrumbs}
      title={item.title}
      hiddenNote={hiddenNote}
      base={presentationBase(id, item.id)}
      canManage={access.canManage}
    >
      {editButton}
    </PresentationBar>
  ) : undefined

  return (
    <AppShell tone={access.course.color} topbar={pdfBar}>
      <Styles
        use={['/src/routes/content/content.css', ...(restricted.locked.size > 0 ? (['/src/components/restriction.css'] as const) : [])]}
      />
      {pdf ? (
        <PdfStage src={previewUrl} title={item.fileName ?? 'プレビュー'} />
      ) : presenting ? (
        <PresentationStage base={presentationBase(id, item.id)} title={item.title} canManage={access.canManage} />
      ) : (
        crumbs
      )}
      <div class="reader" data-outline-kind={item.type}>
        <article class="reader-main" data-ai-watch={`item:${item.id}`}>
          {!pdf && !presenting && head}

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

          {code && (
            <CodeOpen
              base={`${base}/${item.id}/code`}
              language={code.language}
              goals={code.goals}
              grade={code.grade}
              solution={code.solution}
              canManage={access.canManage}
              stage={code.stage}
            />
          )}

          {bundle && (
            <BundleOpen base={bundleBase(id, item.id)} {...bundle} editHref={access.canManage ? `${base}/${item.id}/edit` : undefined} />
          )}

          {agent && (
            <AgentOpen base={agentBase(id, item.id)} {...agent} editHref={access.canManage ? `${base}/${item.id}/edit` : undefined} />
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

          {(item.body || item.type === 'page') && (
            <div class="reader-sheet">{item.body ? <Markdown source={item.body} /> : <p class="muted">本文はまだありません。</p>}</div>
          )}

          {quiz && <QuizPanel quiz={quiz} editHref={access.canManage ? `${base}/${item.id}/edit` : undefined} />}

          {collab && <CollabPanel collab={collab} />}

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
            <OutlineToggle />
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
                      {restricted.locked.has(o.id) ? (
                        <span class="outline-link is-locked" data-item={o.id}>
                          <Icon name="lock" size={14} class="outline-kind" />
                          <span class="truncate">{o.title}</span>
                        </span>
                      ) : (
                        <a
                          href={o.type === 'screen' ? `${navHref(o)}/screen` : navHref(o)}
                          class={cx('outline-link', o.id === item.id && 'active', isHidden(o) && 'is-hidden')}
                          data-item={o.id}
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
                      )}
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
