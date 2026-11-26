import { Button, IconButton } from '../../../components/button'
import { Card } from '../../../components/card'
import { DateTimeField, FileInput, SegmentedControl, validateWith } from '../../../components/form'
import { Icon } from '../../../components/icons'
import { useStyle } from '../../../components/style'
import { Alert, Chip, EmptyState, formatDateTime } from '../../../components/ui'
import { formatBytes } from '../../../lib/bytes'
import type { FieldErrors } from '../../../lib/forms'
import { previewKind } from '../../../lib/preview'
import { MAX_FILE_SIZE } from '../../../lib/storage'
import {
  MAX_PUBLICATION_FILES,
  PUBLICATION_STATE_LABELS,
  publicationStateOf,
  type PublicationFile,
  type PublicationSettings,
  type PublicationState,
  type PublicationView,
} from '../publication'

const STATE_TONES: Record<PublicationState, 'success' | 'accent' | 'default'> = {
  public: 'success',
  waiting: 'accent',
  rejected: 'default',
}

const STATE_ICONS = { public: 'eye', waiting: 'clock', rejected: 'eyeSlash' } as const satisfies Record<PublicationState, string>

const StateChip = ({ state }: { state: PublicationState }) => (
  <Chip tone={STATE_TONES[state]} icon={STATE_ICONS[state]}>
    {PUBLICATION_STATE_LABELS[state]}
  </Chip>
)

/** ファイルの名前。プレビューできる種類は別のタブで開き、それ以外はダウンロードする */
const FileLink = ({ href, file }: { href: string; file: PublicationFile }) => {
  const preview = previewKind(file.type, file.name)
  return preview && preview !== 'text' ? (
    <a href={`${href}?inline=1`} class="pub-name truncate" target="_blank" rel="noopener" data-no-prefetch>
      {file.name}
    </a>
  ) : (
    <a href={href} class="pub-name truncate" data-no-prefetch download>
      {file.name}
    </a>
  )
}

const FileRow = ({
  base,
  file,
  settings,
  owner,
  canDelete,
  manage,
}: {
  base: string
  file: PublicationFile
  settings: PublicationSettings
  /** 上げた人の名前を出す */
  owner: boolean
  canDelete: boolean
  /** 公開・非公開を切り替えるボタンを出す */
  manage?: boolean
}) => {
  const href = `${base}/files/${file.id}`
  const state = publicationStateOf(settings, file.status)
  return (
    <li class="pub-row">
      <Icon name="file" size={16} />
      <span class="pub-main">
        <FileLink href={href} file={file} />
        <span class="pub-meta muted small">
          {owner && file.userName && <span class="strong">{file.userName} さん</span>}
          <span>{formatBytes(file.size)}</span>
          <span>{formatDateTime(file.createdAt)}</span>
        </span>
      </span>
      <span class="pub-actions">
        {(manage || !owner) && <StateChip state={state} />}
        {manage && (
          <form method="post" action={`${href}/status`}>
            <input type="hidden" name="status" value={state === 'public' ? 'rejected' : 'approved'} />
            <Button type="submit" size="sm" icon={state === 'public' ? 'eyeSlash' : 'check'}>
              {state === 'public' ? '非公開にする' : settings.approval ? '承認する' : '公開する'}
            </Button>
          </form>
        )}
        <IconButton href={href} icon="download" label={`「${file.name}」をダウンロード`} data-no-prefetch download />
        {canDelete && (
          <form method="post" action={`${href}/delete`} data-confirm={`「${file.name}」を削除しますか？`} data-confirm-ok="削除する">
            <IconButton type="submit" icon="trash" label={`「${file.name}」を削除`} danger />
          </form>
        )}
      </span>
    </li>
  )
}

const periodText = ({ opensAt, closesAt }: PublicationSettings) =>
  [opensAt && `${formatDateTime(opensAt)} から`, closesAt && `${formatDateTime(closesAt)} まで`].filter(Boolean).join(' ')

const UploadForm = ({ base, left }: { base: string; left: number }) => (
  <form
    method="post"
    action={`${base}/files`}
    enctype="multipart/form-data"
    class="pub-upload"
    data-loading-form
    {...validateWith('publicationUpload')}
  >
    <FileInput id="publication-files" name="files" multiple buttonLabel="ファイルを選択" />
    <div class="pub-upload-foot">
      <span class="muted small">
        あと {left} 個（1 回のアップロードは合わせて {formatBytes(MAX_FILE_SIZE)} まで）
      </span>
      <Button type="submit" variant="primary" icon="upload">
        アップロード
      </Button>
    </div>
  </form>
)

/** 学生の画面の、自分のファイルのカード */
const MineCard = ({ base, view }: { base: string; view: PublicationView }) => {
  const { settings, period, mine } = view
  const open = period === 'open'
  const left = MAX_PUBLICATION_FILES - mine.length
  const span = periodText(settings)
  return (
    <Card
      heading="自分のファイル"
      description={
        settings.approval
          ? '先生が承認したファイルが、クラスのみんなに公開されます。'
          : 'アップロードしたファイルは、すぐにクラスのみんなに公開されます。'
      }
    >
      <div class="stack">
        {span && (
          <p class="pub-period small">
            <Icon name="clock" size={16} />
            提出の期間：{span}
          </p>
        )}
        {period === 'before' && <Alert tone="info">まだ提出の期間が始まっていません。</Alert>}
        {period === 'after' && <Alert tone="info">提出の期間は終わりました。ファイルの追加と削除はできません。</Alert>}
        {open && left > 0 && <UploadForm base={base} left={left} />}
        {open && left <= 0 && <Alert tone="info">アップロードできるのは {MAX_PUBLICATION_FILES} 個までです。</Alert>}
        {mine.length > 0 && (
          <ul class="pub-list">
            {mine.map((f) => (
              <FileRow base={base} file={f} settings={settings} owner={false} canDelete={open} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/** アイテムの画面の本体。学生には自分のファイルとみんなのファイル、教師にはすべてのファイルと公開の切り替え */
export const PublicationPanel = ({ base, view }: { base: string; view: PublicationView }) => {
  useStyle('/src/features/publication/components/publication.css', '/src/components/card.css')
  const { settings, others } = view
  if (view.manage) {
    const waiting = others.filter((f) => publicationStateOf(settings, f.status) === 'waiting').length
    const students = new Set(others.map((f) => f.userId)).size
    return (
      <Card
        class="pub-panel"
        heading="学生のファイル"
        description={
          others.length
            ? `${students} 人・${others.length} 個${settings.approval ? `（承認待ち ${waiting} 個）` : ''}`
            : '学生がアップロードしたファイルが、ここに並びます。'
        }
        actions={
          settings.approval &&
          waiting > 0 && (
            <form
              method="post"
              action={`${base}/approve-all`}
              data-confirm={`承認待ちの ${waiting} 個をすべて承認しますか？`}
              data-confirm-ok="すべて承認する"
            >
              <Button type="submit" size="sm" variant="primary" icon="check">
                すべて承認
              </Button>
            </form>
          )
        }
      >
        {others.length > 0 && (
          <ul class="pub-list">
            {others.map((f) => (
              <FileRow base={base} file={f} settings={settings} owner canDelete manage />
            ))}
          </ul>
        )}
      </Card>
    )
  }
  return (
    <div class="pub-panel stack-lg">
      <MineCard base={base} view={view} />
      <Card heading="みんなのファイル" description={settings.showNames ? undefined : 'アップロードした人の名前は表示されません。'}>
        {others.length ? (
          <ul class="pub-list">
            {others.map((f) => (
              <FileRow base={base} file={f} settings={settings} owner canDelete={false} />
            ))}
          </ul>
        ) : (
          <EmptyState icon="folderOpen" title="まだ公開されたファイルはありません" />
        )}
      </Card>
    </div>
  )
}

/** 編集画面の右の列に置く、公開の方法と提出の期間のカード */
export const PublicationSettingsCard = ({
  settings,
  opensAt,
  closesAt,
  errors,
}: {
  settings: Pick<PublicationSettings, 'approval' | 'showNames'>
  /** 日時の入力欄の値 */
  opensAt: string
  closesAt: string
  errors: FieldErrors
}) => (
  <Card heading="公開と提出">
    <div class="stack">
      <fieldset class="field">
        <legend>ほかの学生への公開</legend>
        <SegmentedControl
          name="approval"
          label="ほかの学生への公開"
          options={[
            { value: '1', label: '承認してから', icon: 'check' },
            { value: '0', label: 'すぐに', icon: 'eye' },
          ]}
          value={String(settings.approval)}
        />
        <p class="field-hint">「すぐに」でも、ファイルごとに非公開にできます。</p>
      </fieldset>
      <fieldset class="field">
        <legend>上げた人の名前</legend>
        <SegmentedControl
          name="show_names"
          label="上げた人の名前"
          options={[
            { value: '1', label: '見せる', icon: 'user' },
            { value: '0', label: '見せない', icon: 'eyeSlash' },
          ]}
          value={String(settings.showNames)}
        />
        <p class="field-hint">先生には、いつも名前が見えます。</p>
      </fieldset>
      <DateTimeField label="開始日時（任意）" name="opens_at" value={opensAt} error={errors.opens_at} optional />
      <DateTimeField
        label="締め切り（任意）"
        name="closes_at"
        value={closesAt}
        error={errors.closes_at}
        optional
        hint="期間の外は、学生がファイルを追加・削除できません。"
      />
    </div>
  </Card>
)
