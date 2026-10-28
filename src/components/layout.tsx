import type { Child } from 'hono/jsx'
import { useRequestContext } from 'hono/jsx-renderer'
import { canCreateCourse } from '../lib/auth'
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

const RailLink = ({ href, icon, label, active }: NavItem) => (
  <a href={href} class={active ? 'rail-link active' : 'rail-link'} aria-current={active ? 'page' : undefined} title={label}>
    <Icon name={icon} size={20} />
    <span class="sr-only">{label}</span>
  </a>
)

const NavLink = ({ href, icon, label, active }: NavItem) => (
  <a href={href} class={active ? 'nav-link active' : 'nav-link'} aria-current={active ? 'page' : undefined}>
    <Icon name={icon} size={16} />
    <span>{label}</span>
  </a>
)

export const Brand = () => (
  <a href="/" class="brand">
    <span class="brand-mark">
      <Icon name="logo" size={18} />
    </span>
    <span class="brand-name">StepLearn</span>
  </a>
)

export const AppShell = ({ children, wide }: { children: Child; wide?: boolean }) => {
  const c = useRequestContext<AppEnv>()
  const user = c.var.user!
  const path = c.req.path
  const navCourses = c.var.navCourses
  const courseMatch = path.match(/^\/courses\/(\d+)/)
  const currentCourse = courseMatch ? Number(courseMatch[1]) : null
  const links = (
    [
      { href: '/dashboard', icon: 'home', label: 'ダッシュボード', active: path === '/dashboard' },
      { href: '/courses', icon: 'compass', label: 'コースを探す', active: path === '/courses' },
      canCreateCourse(user) && { href: '/courses/new', icon: 'plus', label: 'コースを作成', active: path === '/courses/new' },
      user.role === 'admin' && { href: '/admin/users', icon: 'shield', label: 'ユーザー管理', active: path.startsWith('/admin') },
    ] satisfies (NavItem | false)[]
  ).filter((l) => l !== false)

  return (
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="rail">
          <a href="/" class="brand-mark" aria-label="StepLearn">
            <Icon name="logo" size={18} />
          </a>
          <nav class="rail-nav" aria-label="メイン">
            {links.map((l) => (
              <RailLink {...l} />
            ))}
          </nav>
          <div class="rail-foot">
            {canCreateCourse(user) && (
              <a href="/courses/new" class="rail-add" aria-label="コースを作成" title="コースを作成">
                <Icon name="plus" size={18} />
              </a>
            )}
            <form method="post" action="/logout">
              <button type="submit" class="rail-link" aria-label="ログアウト" title="ログアウト">
                <Icon name="logout" size={20} />
              </button>
            </form>
            <a href="/account" class={path === '/account' ? 'rail-avatar active' : 'rail-avatar'} title={`${user.name}（${ROLE_LABELS[user.role]}）`}>
              <Avatar name={user.name} size={32} />
              <span class="sr-only">アカウント</span>
            </a>
          </div>
        </div>

        <div class="panel">
          <div class="panel-top">
            <span class="panel-title">StepLearn</span>
            <button type="button" class="icon-btn nav-close" data-nav-toggle aria-label="メニューを閉じる">
              <Icon name="x" />
            </button>
          </div>

          <nav class="nav" aria-label="メニュー">
            {links.map((l) => (
              <NavLink {...l} />
            ))}
          </nav>

          {navCourses.length > 0 && (
            <div class="nav-section">
              <div class="nav-heading">
                <span>マイコース</span>
                <span class="nav-heading-count">{navCourses.length}</span>
              </div>
              <nav class="nav" aria-label="マイコース">
                {navCourses.map((nc) => (
                  <a
                    href={`/courses/${nc.id}`}
                    class={currentCourse === nc.id ? 'nav-link nav-course active' : 'nav-link nav-course'}
                  >
                    <span class={`dot tone-${nc.color}`}>{[...nc.title][0]}</span>
                    <span class="truncate">{nc.title}</span>
                  </a>
                ))}
              </nav>
            </div>
          )}

          <a href="/courses" class="panel-promo">
            <span class="panel-promo-icon">
              <Icon name="sparkle" size={18} />
            </span>
            <strong>新しいコースを探す</strong>
            <span class="muted small">公開中のコースから、次に学ぶことを見つけましょう。</span>
            <span class="panel-promo-cta">
              コース一覧へ <Icon name="chevronRight" size={14} />
            </span>
          </a>
        </div>
      </aside>
      <div class="backdrop" data-nav-toggle />

      <div class="main">
        <header class="topbar">
          <button type="button" class="icon-btn" data-nav-toggle aria-label="メニューを開く" aria-controls="sidebar">
            <Icon name="menu" />
          </button>
          <Brand />
          <a href="/account" class="topbar-avatar" aria-label="アカウント">
            <Avatar name={user.name} size={30} />
          </a>
        </header>
        <main class={wide ? 'content content-wide' : 'content'}>{children}</main>
      </div>
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
            <Icon name="check" size={16} /> 登録キーでかんたんにコース参加
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
