import { Link } from 'vite-ssr-components/hono'
import { Card } from '../../../components/card'
import { Icon } from '../../../components/icons'
import { useStyle } from '../../../components/style'
import { cx } from '../../../components/cx'
import { THEMES, THEME_DESCRIPTIONS, THEME_LABELS, type ThemeName } from '../theme'

// components/style.tsx の STYLESHEETS に入れないのは、部品が使うかどうかではなく利用者の選んだテーマで決まり、ページをまたいで外さずに残すため（features/theme/client.ts）
const THEME_STYLESHEETS: Record<ThemeName, string | null> = {
  glass: null,
  soft: '/src/features/theme/themes/soft.css',
  cute: '/src/features/theme/themes/cute.css',
}

/** 選んだテーマの CSS。ページで使う部品の CSS より後ろに置く（renderer.tsx） */
export const ThemeStylesheet = ({ theme }: { theme: ThemeName }) => {
  const href = THEME_STYLESHEETS[theme]
  return href ? <Link href={href} rel="stylesheet" data-theme-sheet={theme} /> : null
}

/** テーマの見た目を小さな画面で見せる。テーマの CSS を読み込む前に見せるので、色は theme.css に書き写してある */
export const ThemePreview = ({ theme }: { theme: ThemeName }) => (
  <span class={`theme-preview theme-preview-${theme}`} data-theme-preview={theme} aria-hidden="true">
    <span class="tp-bar">
      <span class="tp-dot" />
    </span>
    <span class="tp-rail">
      <span class="tp-dot" />
      <span class="tp-dot" />
      <span class="tp-dot" />
    </span>
    <span class="tp-body">
      <span class="tp-card">
        <span class="tp-line" />
        <span class="tp-line tp-line-short" />
        <span class="tp-btn" />
      </span>
      <span class="tp-card tp-card-sub">
        <span class="tp-line" />
        <span class="tp-line tp-line-short" />
      </span>
    </span>
  </span>
)

export const ThemePicker = ({ current }: { current: ThemeName }) => {
  useStyle('/src/features/theme/components/theme.css')
  return (
    <Card
      id="theme"
      heading="テーマ"
      description="画面の見た目を選びます。どの端末でも同じテーマで表示されます。ダークモードはユーザーメニューで切り替えます。"
    >
      <form method="post" action="/account/theme" class="theme-picker" data-theme-form>
        {THEMES.map((theme) => (
          <button
            type="submit"
            name="theme"
            value={theme}
            class={cx('theme-option', theme === current && 'is-current')}
            aria-pressed={String(theme === current)}
            disabled={theme === current}
          >
            <ThemePreview theme={theme} />
            <span class="theme-option-text">
              <span class="theme-option-name">
                {THEME_LABELS[theme]}
                {theme === current && <Icon name="check" size={16} />}
              </span>
              <span class="theme-option-desc">{THEME_DESCRIPTIONS[theme]}</span>
            </span>
          </button>
        ))}
      </form>
    </Card>
  )
}
