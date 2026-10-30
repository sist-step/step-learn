export const USERNAME_MAX_LENGTH = 30
export const USERNAME_HINT = `半角英数字と . _ - で3〜${USERNAME_MAX_LENGTH}文字。ログインにも使えます`

// 入力のまま保存して COLLATE NOCASE に任せないのは、同じユーザー名でも入力した人によって大文字小文字の違う表示になるため
export const normalizeUsername = (s: string) => s.trim().toLowerCase()

// @ を許さないのは、ログイン欄の入力がメールアドレスかユーザー名かを @ の有無で見分けているため
const USERNAME_RE = new RegExp(`^[a-z0-9._-]{3,${USERNAME_MAX_LENGTH}}$`)

/** 形の正しくないユーザー名なら理由を、問題なければ null を返す。使われているかは lib/auth.ts の isUsernameTaken で確かめる */
export function checkUsername(username: string) {
  if (!username) return 'ユーザー名を入力してください。'
  if (!USERNAME_RE.test(username)) return `ユーザー名は半角英数字と . _ - で3〜${USERNAME_MAX_LENGTH}文字にしてください。`
  return null
}
