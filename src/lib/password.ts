export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_HINT = `${PASSWORD_MIN_LENGTH}文字以上。推測されやすいものは使えません`

// 流出したパスワードの上位や、サービス・地域から連想しやすい語。
// 前後の数字・記号を取り除いた形でも照合するので、「password123!」のような変形もここで弾ける
const COMMON = new Set([
  'password',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'pass',
  'qwerty',
  'qwertyui',
  'qwertyuiop',
  'asdf',
  'asdfgh',
  'asdfghjk',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  '1qaz2wsx',
  'qazwsx',
  'iloveyou',
  'admin',
  'administrator',
  'welcome',
  'letmein',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'soccer',
  'superman',
  'batman',
  'trustno',
  'shadow',
  'michael',
  'charlie',
  'jordan',
  'hunter',
  'ranger',
  'buster',
  'abc',
  'abcd',
  'test',
  'guest',
  'login',
  'root',
  'changeme',
  'secret',
  'hello',
  'freedom',
  'whatever',
  'starwars',
  'pokemon',
  'computer',
  'internet',
  'default',
  'user',
  'student',
  'teacher',
  'school',
  'japan',
  'tokyo',
  'nippon',
  'sakura',
  'doraemon',
  'pikachu',
  'steplearn',
  'moodle',
  'lms',
])

const strip = (s: string) => s.replace(/^[\d\W_]+|[\d\W_]+$/g, '')

function isSequence(s: string) {
  const step = s.charCodeAt(1) - s.charCodeAt(0)
  if (Math.abs(step) !== 1) return false
  for (let i = 2; i < s.length; i++) if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false
  return true
}

/** 使えないパスワードなら理由を、問題なければ null を返す */
export function checkPassword(
  password: string,
  { email = '', name = '', username }: { email?: string; name?: string; username?: string | null } = {},
) {
  if (password.length < PASSWORD_MIN_LENGTH) return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください。`

  const lower = password.toLowerCase()
  if (COMMON.has(lower) || COMMON.has(strip(lower))) return 'よく使われているパスワードのため使えません。'
  if (/^\d+$/.test(password)) return '数字だけのパスワードは使えません。'
  if (new Set(password).size < 4 || isSequence(lower)) return '同じ文字の繰り返しや連続した文字は使えません。'

  const personal = [email.split('@')[0], username ?? '', name.replace(/\s+/g, ''), ...name.split(/\s+/)]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= 3)
  if (personal.some((s) => lower.includes(s))) return 'メールアドレス・ユーザー名・氏名を含むパスワードは使えません。'

  return null
}
