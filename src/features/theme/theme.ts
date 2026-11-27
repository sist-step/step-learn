export const THEMES = ['glass', 'soft', 'cute'] as const
export type ThemeName = (typeof THEMES)[number]

export const DEFAULT_THEME: ThemeName = 'glass'

export const isThemeName = (v: string | undefined): v is ThemeName => (THEMES as readonly (string | undefined)[]).includes(v)

export const THEME_LABELS: Record<ThemeName, string> = {
  glass: 'ガラス',
  soft: 'やわらかい',
  cute: 'かわいい',
}

export const THEME_DESCRIPTIONS: Record<ThemeName, string> = {
  glass: '色のにじむ背景に、半透明のガラスの面を重ねる標準の見た目。',
  soft: 'クリーム色の紙に、大きな丸みとふっくらした影。落ち着いたパステルの色。',
  cute: 'ピンクの水玉に、ふち取りのシールのような面。押すとキラキラが弾ける。',
}

/** テーマの JS。start は切り替えたときと最初の表示、page は再読み込みなしの遷移のたびに呼ぶ */
export type ThemeScript = { start(): void; stop(): void; page(): void }
