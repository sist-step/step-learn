/// <reference lib="dom" />
import { z } from 'zod'
import { parseJson } from './json'

export const SETTINGS_KEY = 'settings'

/** AI のパネルを本文の横に並べる幅。これより狭いと本文に重ねて出す */
export const AI_PANEL_DOCKED = '(min-width: 1100px)'

// 項目ごとに .catch で既定値に戻すのは、壊れた値や古い形式の値が 1 つあるだけで、ほかの設定まで失わないようにするため
const SETTINGS = z.object({
  // OS の設定に合わせないのは、利用者が自分で選んだときだけダークにするため
  theme: z.enum(['light', 'dark']).catch('light'),
  coursesAll: z.boolean().catch(false),
  coursesOthers: z.boolean().catch(false),
  editMode: z.boolean().catch(false),
  pdfThumbs: z.boolean().catch(true),
  collapsedSections: z.array(z.string()).catch([]),
  aiPanel: z.boolean().catch(false),
  mdSplit: z.boolean().catch(true),
  outlineHidden: z.array(z.string()).catch([]),
})

export type Settings = z.infer<typeof SETTINGS>
export type SettingKey = keyof Settings
export type Theme = Settings['theme']

const toSettings = (value: unknown): Settings => SETTINGS.safeParse(value).data ?? SETTINGS.parse({})

// 保存できない環境（プライベートブラウズなど）でも、開いているあいだは切り替えた設定のまま使えるよう、読み書きした値を持っておく
let memory: Settings | null = null

export function readSettings(): Readonly<Settings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    memory = raw === null ? migrateLegacy() : toSettings(parseJson(raw))
  } catch {
    memory ??= toSettings({})
  }
  return memory
}

export const getSetting = <K extends SettingKey>(key: K): Settings[K] => readSettings()[key]

export const setSetting = <K extends SettingKey>(key: K, value: Settings[K]) => writeSettings({ ...readSettings(), [key]: value })

export const updateSetting = <K extends SettingKey>(key: K, update: (current: Settings[K]) => Settings[K]) =>
  setSetting(key, update(getSetting(key)))

function writeSettings(settings: Settings) {
  memory = settings
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {}
}

// 旧形式を捨てずに移すのは、まとめる前に選んだダークモードや絞り込みが、更新のあと既定に戻ってしまうのを避けるため
const LEGACY_KEYS = ['sl:courses-all', 'sl:courses-others', 'sl:edit-mode', 'pdf-thumbs', 'sl:collapsed']

function migrateLegacy(): Settings {
  const flag = (key: string) => localStorage.getItem(key) === '1'
  const settings = toSettings({
    theme: /(?:^|;\s*)theme=dark(?:;|$)/.test(document.cookie) ? 'dark' : 'light',
    coursesAll: flag('sl:courses-all'),
    coursesOthers: flag('sl:courses-others'),
    editMode: flag('sl:edit-mode'),
    pdfThumbs: localStorage.getItem('pdf-thumbs') !== '0',
    collapsedSections: parseJson(localStorage.getItem('sl:collapsed')),
  })
  writeSettings(settings)
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key))
  document.cookie = 'theme=; path=/; max-age=0; samesite=lax'
  document.cookie = 'pdf=; path=/; max-age=0; samesite=lax'
  return settings
}

// client.ts で当てないのは、module のスクリプトは描画のあとに動くので、ダークの人に一瞬ライトの画面が見えてしまい、AI のパネルを開いている人には本文の幅が一瞬広く見えてしまうため
// 幅の狭い画面で AI のパネルを開き直さないのは、本文を覆って出るので、ページを開くたびに本文が隠れてしまうため
// 目次を閉じた種類を CSS の属性セレクターで書き出さないのは、種類（Moodle の活動名を含む）が増えるたびに CSS を直すことになるため
// MutationObserver で待つのは、<head> で動くこのスクリプトからは、まだ解析されていないアイテムの種類が見えないため（描画の前に呼ばれるので、閉じた目次が一瞬見えることはない）
export const BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}));if(s.theme==='dark'){document.documentElement.dataset.theme='dark';document.querySelector('meta[name=color-scheme]').content='dark'}if(s.aiPanel&&matchMedia(${JSON.stringify(AI_PANEL_DOCKED)}).matches)document.documentElement.dataset.aiOpen='';var h=s.outlineHidden;if(Array.isArray(h)&&h.length){var o=new MutationObserver(function(){var r=document.querySelector('.reader[data-outline-kind]');if(!r)return;o.disconnect();if(h.indexOf(r.dataset.outlineKind)>=0)document.documentElement.dataset.outlineClosed=''});o.observe(document.documentElement,{childList:true,subtree:true});addEventListener('DOMContentLoaded',function(){o.disconnect()})}}catch(e){}`
