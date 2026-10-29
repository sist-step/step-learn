import type { Child } from 'hono/jsx'
import { useRequestContext } from 'hono/jsx-renderer'
import { ROLE_LABELS, type AppEnv } from '../lib/types'
import { Icon, type IconName } from './icons'
import { Avatar } from './ui'

const Toast = () => {
  const c = useRequestContext<AppEnv>()
  const flash = c.var.flash
  return (
    <div class="toasts" aria-live="polite">
      {flash && (
        <div class={`toast toast-${flash.type}`} role="status" data-toast>
          <Icon name={flash.type === 'error' ? 'alert' : flash.type === 'info' ? 'info' : 'check'} />
          <span>{flash.message}</span>
          <button type="button" class="toast-close" data-toast-close aria-label="閉じる">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

type NavItem = { href: string; icon: IconName; label: string; active: boolean }

export const Brand = () => (
  <a href="/" class="brand">
    <img src="/favicon.png" alt="" class="brand-mark" width={32} height={32} />
    <span class="brand-name">StepLearn</span>
  </a>
)

const ThemeToggle = ({ class: cls }: { class: string }) => (
  <button type="button" class={cls} data-theme-toggle aria-label="テーマを切り替え" title="テーマを切り替え">
    <span class="theme-to-dark">
      <Icon name="moon" size={18} />
      <span class="rail-label">ダークモード</span>
    </span>
    <span class="theme-to-light">
      <Icon name="sun" size={18} />
      <span class="rail-label">ライトモード</span>
    </span>
  </button>
)

export const AppShell = ({ children, wide, editable }: { children: Child; wide?: boolean; editable?: boolean }) => {
  const c = useRequestContext<AppEnv>()
  const user = c.var.user!
  const path = c.req.path
  const navCourses = c.var.navCourses
  const courseMatch = path.match(/^\/courses\/(\d+)/)
  const currentCourse = courseMatch ? Number(courseMatch[1]) : null
  const links = (
    [
      { href: '/dashboard', icon: 'home', label: 'ダッシュボード', active: path === '/dashboard' },
      { href: '/courses', icon: 'book', label: 'コース一覧', active: path === '/courses' },
      user.role === 'admin' && { href: '/admin', icon: 'shield', label: '管理', active: path.startsWith('/admin') },
    ] satisfies (NavItem | false)[]
  ).filter((l) => l !== false)

  return (
    <div class="app">
      <header class="topbar">
        <div class="topbar-start">
          <button type="button" class="icon-btn nav-open-btn" data-nav-toggle aria-label="メニューを開く" aria-controls="rail">
            <Icon name="menu" />
          </button>
          <Brand />
        </div>
        <nav class="pill-nav" aria-label="メイン">
          {links.map((l) => (
            <a href={l.href} class={l.active ? 'pill active' : 'pill'} aria-current={l.active ? 'page' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <div class="topbar-end">
          {editable && (
            <button type="button" class="switch" role="switch" aria-checked="false" data-edit-mode-toggle>
              <span class="switch-track" />
              <span>編集モード</span>
            </button>
          )}
          <ThemeToggle class="icon-btn round-btn topbar-theme" />
          <a href="/account" class="topbar-avatar" aria-label="アカウント" title={`${user.name}（${ROLE_LABELS[user.role]}）`}>
            <Avatar name={user.name} size={40} />
          </a>
        </div>
      </header>

      <aside class="rail" id="rail">
        <div class="rail-head">
          <Brand />
          <button type="button" class="icon-btn" data-nav-toggle aria-label="メニューを閉じる">
            <Icon name="x" />
          </button>
        </div>

        <nav class="rail-nav" aria-label="メイン">
          {links.map((l) => (
            <a
              href={l.href}
              class={l.active ? 'rail-link active' : 'rail-link'}
              aria-current={l.active ? 'page' : undefined}
              title={l.label}
            >
              <Icon name={l.icon} size={20} />
              <span class="rail-label">{l.label}</span>
            </a>
          ))}
        </nav>

        {navCourses.length > 0 && (
          <nav class="rail-nav" aria-label="マイコース">
            <span class="rail-heading rail-label">マイコース</span>
            {navCourses.map((nc) => (
              <a
                href={`/courses/${nc.id}`}
                class={currentCourse === nc.id ? 'rail-link active' : 'rail-link'}
                aria-current={currentCourse === nc.id ? 'page' : undefined}
                title={nc.title}
              >
                <span class={`dot tone-${nc.color}`}>{[...nc.title][0]}</span>
                <span class="rail-label truncate">{nc.title}</span>
              </a>
            ))}
          </nav>
        )}

        <div class="rail-foot">
          <ThemeToggle class="rail-link rail-theme" />
          <form method="post" action="/logout">
            <button type="submit" class="rail-link" title="ログアウト">
              <Icon name="logout" size={20} />
              <span class="rail-label">ログアウト</span>
            </button>
          </form>
        </div>
      </aside>
      <div class="backdrop" data-nav-toggle />

      <main class={wide ? 'content content-wide' : 'content'}>{children}</main>
      <Toast />
    </div>
  )
}

export const AuthShell = ({ children }: { children: Child }) => (
  <div class="auth">
    <section class="auth-hero" aria-hidden="true">
      <Brand />
      <div class="auth-hero-body">
        <h2>
          学びを、
          <br />
          一歩ずつ確かに。
        </h2>
        <p>コース・教材・進捗をひとつの場所に。軽くて速い、これからの学習プラットフォーム。</p>
        <ul class="auth-points">
          <li>
            <Icon name="check" size={16} /> 進捗が一目でわかるダッシュボード
          </li>
          <li>
            <Icon name="check" size={16} /> ページ・リンク・ファイルで教材を整理
          </li>
          <li>
            <Icon name="check" size={16} /> 画面共有でライブ授業を配信
          </li>
        </ul>
      </div>
      <div class="auth-hero-art">
        <span />
        <span />
        <span />
        <span />
      </div>
    </section>
    <main class="auth-main">
      <div class="auth-mobile-brand">
        <Brand />
      </div>
      {children}
    </main>
    <Toast />
  </div>
)
