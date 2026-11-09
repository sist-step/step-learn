// サーバーの handlers と client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

const DAY = 86_400

export const isDateInput = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateInputToUnix(s))

/** 日付の入力欄の値（YYYY-MM-DD）を、日本時間のその日の 0 時の UNIX 秒にする */
export const dateInputToUnix = (s: string) => Date.parse(`${s}T00:00:00+09:00`) / 1000

const DATE_INPUT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })

export const unixToDateInput = (unix: number | null | undefined) => (unix == null ? '' : DATE_INPUT.format(new Date(unix * 1000)))

export const isDateTimeInput = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && !Number.isNaN(dateTimeInputToUnix(s))

/** 日時の入力欄の値（YYYY-MM-DDTHH:mm）を、日本時間の UNIX 秒にする */
export const dateTimeInputToUnix = (s: string) => Date.parse(`${s}:00+09:00`) / 1000

const DATE_TIME_INPUT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const unixToDateTimeInput = (unix: number | null | undefined) =>
  unix == null ? '' : DATE_TIME_INPUT.format(new Date(unix * 1000)).replace(' ', 'T')

/** 終了日はその日の終わりまでを期間に含める。期間を決めていない側は区切らない */
export const isInPeriod = (period: { startAt: number | null; endAt: number | null }, at = Math.floor(Date.now() / 1000)) =>
  (period.startAt == null || period.startAt <= at) && (period.endAt == null || at < period.endAt + DAY)

export const isUpcoming = (period: { startAt: number | null }, at = Math.floor(Date.now() / 1000)) =>
  period.startAt != null && at < period.startAt
