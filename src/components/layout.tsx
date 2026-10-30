import type { Child } from 'hono/jsx'
import { useRequestContext } from 'hono/jsx-renderer'
import { getTheme } from '../lib/http'
import { ROLE_LABELS, type AppEnv, type Flash } from '../lib/types'
import { Icon, type IconName } from './icons'
import { FluidArt } from './art'
import { IconButton } from './button'
import { Switch } from './form'
import { MenuItem, Popover } from './overlay'
import { useStyle } from './style'
import { Avatar, Person } from './ui'

type ToastType = Flash['type']

const TOAST_ICONS: Record<ToastType, IconName> = { success: 'checkCircle', info: 'info', error: 'alert' }
const TOAST_TITLES: Record<ToastType, string> = { success: '完了', info: 'お知らせ', error: 'エラー' }

const ToastItem = ({ type, message }: { type: ToastType; message?: string }) => (
  <div class={`toast toast-${type}`} role={type === 'error' ? 'alert' : 'status'} data-toast>
    <span class="toast-icon">
      <Icon name={TOAST_ICONS[type]} size={22} />
    </span>
    <div class="toast-body">
      <strong class="toast-title">{TOAST_TITLES[type]}</strong>
      <p class="toast-message" data-toast-message>
        {message}
      </p>
    </div>
    <button type="button" class="toast-close" data-toast-close aria-label="閉じる">
      <Icon name="x" size={16} />
    </button>
  </div>
)

// client.ts で同じ見た目を組み立て直さないのは、マークアップが 2 か所に分かれて見た目がずれていくため
const Toast = () => {
  useStyle('/src/components/toast.css')
  const c = useRequestContext<AppEnv>()
  const flash = c.var.flash
  return (
    <div class="toasts" aria-live="polite">
      {flash && <ToastItem type={flash.type} message={flash.message} />}
      {(['success', 'info', 'error'] as const).map((type) => (
        <template data-toast-template={type}>
          <ToastItem type={type} />
        </template>
      ))}
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

const UserMenu = ({ editable }: { editable?: boolean }) => {
  const c = useRequestContext<AppEnv>()
  const user = c.var.user!
  return (
    <Popover
      class="user-menu"
      panelClass="user-menu-panel"
      trigger={
        <summary class="topbar-avatar" aria-label="ユーザーメニュー" title={user.name}>
          <Avatar name={user.name} size={40} />
        </summary>
      }
    >
      <Person
        class="user-menu-head"
        avatar={<Avatar name={user.name} size={40} />}
        name={user.name}
        meta={`${user.email} · ${ROLE_LABELS[user.role]}`}
      />
      <div class="user-menu-group">
        <MenuItem href="/account" icon="user">
          アカウント設定
        </MenuItem>
        <Switch class="menu-item" icon="moon" label="ダークモード" checked={getTheme(c) === 'dark'} data-theme-toggle />
        {editable && <Switch class="menu-item" icon="pencil" label="編集モード" checked={false} data-edit-mode-toggle />}
      </div>
      <form method="post" action="/logout" class="user-menu-group">
        <MenuItem type="submit" icon="logout">
          ログアウト
        </MenuItem>
      </form>
    </Popover>
  )
}

export const AppShell = ({ children, wide, editable }: { children: Child; wide?: boolean; editable?: boolean }) => {
  useStyle('/src/components/layout.css')
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
          <IconButton icon="menu" label="メニューを開く" iconSize={18} class="nav-open-btn" data-nav-toggle aria-controls="rail" />
          <Brand />
        </div>
        <div class="topbar-end">
          <UserMenu editable={editable} />
        </div>
      </header>

      <aside class="rail" id="rail" data-persist>
        <div class="rail-head">
          <Brand />
          <IconButton icon="x" label="メニューを閉じる" iconSize={18} data-nav-toggle />
        </div>

        <nav class="rail-nav" aria-label="メイン">
          {links.map((l) => (
            <a
              href={l.href}
              class={l.active ? 'rail-link active' : 'rail-link'}
              aria-current={l.active ? 'page' : undefined}
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
          <form method="post" action="/logout">
            <button type="submit" class="rail-link">
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

export const AuthShell = ({ children }: { children: Child }) => {
  useStyle('/src/components/auth.css')
  return (
    <div class="auth">
      <div class="auth-frame">
        <main class="auth-main">
          <div class="auth-column">
            <Brand />
            {children}
          </div>
        </main>
        <section class="auth-art" aria-hidden="true">
          <FluidArt id="auth-art" class="auth-art-svg" />
          <div class="auth-glass">
            <strong>学びを、一歩ずつ確かに。</strong>
            <span>コース・教材・進捗をひとつの場所に。</span>
            <small>© {new Date().getFullYear()} StepLearn</small>
          </div>
        </section>
      </div>
      <Toast />
    </div>
  )
}
