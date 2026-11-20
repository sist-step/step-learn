/** JSON として読めなければ null。形は呼ぶ側が zod などで確かめる */
export function parseJson(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
