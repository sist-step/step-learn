/** 秒数を「1:05」の形にする。音声入力の録音時間のように、1 時間に満たない長さに使う */
export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
