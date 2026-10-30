import { raw } from 'hono/html'
import sliders from 'heroicons/24/outline/adjustments-horizontal.svg?raw'
import arrowDown from 'heroicons/24/outline/arrow-down.svg?raw'
import download from 'heroicons/24/outline/arrow-down-tray.svg?raw'
import logout from 'heroicons/24/outline/arrow-right-start-on-rectangle.svg?raw'
import external from 'heroicons/24/outline/arrow-top-right-on-square.svg?raw'
import arrowUp from 'heroicons/24/outline/arrow-up.svg?raw'
import upload from 'heroicons/24/outline/arrow-up-tray.svg?raw'
import maximize from 'heroicons/24/outline/arrows-pointing-out.svg?raw'
import menu from 'heroicons/24/outline/bars-3.svg?raw'
import book from 'heroicons/24/outline/book-open.svg?raw'
import check from 'heroicons/24/outline/check.svg?raw'
import checkCircle from 'heroicons/24/outline/check-circle.svg?raw'
import chevronDoubleLeft from 'heroicons/24/outline/chevron-double-left.svg?raw'
import chevronDown from 'heroicons/24/outline/chevron-down.svg?raw'
import chevronLeft from 'heroicons/24/outline/chevron-left.svg?raw'
import chevronRight from 'heroicons/24/outline/chevron-right.svg?raw'
import monitor from 'heroicons/24/outline/computer-desktop.svg?raw'
import file from 'heroicons/24/outline/document-arrow-down.svg?raw'
import copy from 'heroicons/24/outline/document-duplicate.svg?raw'
import page from 'heroicons/24/outline/document-text.svg?raw'
import alert from 'heroicons/24/outline/exclamation-circle.svg?raw'
import eye from 'heroicons/24/outline/eye.svg?raw'
import globe from 'heroicons/24/outline/globe-alt.svg?raw'
import home from 'heroicons/24/outline/home.svg?raw'
import info from 'heroicons/24/outline/information-circle.svg?raw'
import link from 'heroicons/24/outline/link.svg?raw'
import search from 'heroicons/24/outline/magnifying-glass.svg?raw'
import moon from 'heroicons/24/outline/moon.svg?raw'
import pencil from 'heroicons/24/outline/pencil.svg?raw'
import photo from 'heroicons/24/outline/photo.svg?raw'
import plus from 'heroicons/24/outline/plus.svg?raw'
import shield from 'heroicons/24/outline/shield-check.svg?raw'
import layers from 'heroicons/24/outline/square-3-stack-3d.svg?raw'
import trash from 'heroicons/24/outline/trash.svg?raw'
import user from 'heroicons/24/outline/user.svg?raw'
import users from 'heroicons/24/outline/users.svg?raw'
import x from 'heroicons/24/outline/x-mark.svg?raw'

// 外部アイコンフォントを読み込まず、使う分だけをビルド時に文字列として埋め込む
const svgs = {
  home,
  globe,
  search,
  plus,
  book,
  users,
  user,
  sliders,
  logout,
  menu,
  chevronDoubleLeft,
  x,
  check,
  checkCircle,
  chevronDown,
  chevronRight,
  chevronLeft,
  arrowUp,
  arrowDown,
  link,
  external,
  page,
  file,
  upload,
  download,
  pencil,
  trash,
  eye,
  shield,
  copy,
  layers,
  info,
  alert,
  monitor,
  maximize,
  moon,
  photo,
} as const

export type IconName = keyof typeof svgs

export const Icon = ({ name, size = 18, class: cls }: { name: IconName; size?: number; class?: string }) =>
  raw(svgs[name].replace('<svg ', `<svg class="${cls ? `icon ${cls}` : 'icon'}" width="${size}" height="${size}" `))
