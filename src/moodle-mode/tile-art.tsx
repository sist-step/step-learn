import type { Child } from 'hono/jsx'

const W = 160
const H = 90

type Random = () => number
type Motif = (rand: Random) => Child

const mulberry32 = (seed: number): Random => {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const round = (n: number) => Math.round(n * 10) / 10
const between = (rand: Random, min: number, max: number) => round(min + rand() * (max - min))
const pick = <T,>(rand: Random, list: readonly T[]) => list[Math.floor(rand() * list.length)]
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

const rings: Motif = (rand) => {
  const cx = pick(rand, [between(rand, 0, 30), between(rand, 130, W)])
  const cy = between(rand, 0, H)
  const step = between(rand, 9, 13)
  return (
    <>
      <circle class="art-b" cx={between(rand, 50, 110)} cy={between(rand, 20, 70)} r={between(rand, 14, 22)} />
      {range(9).map((i) => (
        <circle class="art-c" cx={cx} cy={cy} r={round(step * (i + 1))} />
      ))}
    </>
  )
}

const stripes: Motif = (rand) => {
  const width = between(rand, 7, 12)
  const angle = pick(rand, [-1, 1]) * between(rand, 25, 55)
  return (
    <>
      <g transform={`rotate(${angle} ${W / 2} ${H / 2})`}>
        {range(14).map((i) => (
          <rect class={i % 3 === 0 ? 'art-b' : 'art-a'} x={round(-80 + i * width * 2.6)} y={-80} width={width} height={H + 160} />
        ))}
      </g>
      <circle class="art-d" cx={between(rand, 20, 140)} cy={between(rand, 15, 75)} r={between(rand, 4, 7)} />
    </>
  )
}

const dots: Motif = (rand) => {
  const gap = between(rand, 10, 13)
  const cols = Math.ceil(W / gap) + 1
  const rows = Math.ceil(H / gap) + 1
  return (
    <>
      <circle class="art-a" cx={between(rand, 100, 150)} cy={between(rand, 10, 40)} r={between(rand, 26, 36)} />
      <circle class="art-b" cx={between(rand, 10, 60)} cy={between(rand, 55, 90)} r={between(rand, 18, 28)} />
      {range(rows).flatMap((y) =>
        range(cols).map((x) => <circle class="art-d" cx={round(x * gap + (y % 2) * (gap / 2))} cy={round(y * gap)} r={1.3} />),
      )}
    </>
  )
}

const hills: Motif = (rand) => {
  const layer = (base: number) => {
    const span = between(rand, 40, 60)
    const amp = between(rand, 5, 10)
    const start = -between(rand, 0, span)
    const crests = range(Math.ceil((W - start) / span) + 1)
      .map((i) => `T${round(start + span * (i + 2))} ${base}`)
      .join(' ')
    return `M${start} ${base} Q${round(start + span / 2)} ${round(base - amp)} ${round(start + span)} ${base} ${crests} V${H} H${start} Z`
  }
  return (
    <>
      <circle class="art-d" cx={between(rand, 25, 135)} cy={between(rand, 14, 26)} r={between(rand, 7, 10)} />
      <path class="art-b" d={layer(between(rand, 40, 48))} />
      <path class="art-a" d={layer(between(rand, 56, 64))} />
      <path class="art-a" d={layer(between(rand, 72, 80))} />
    </>
  )
}

const bubbles: Motif = (rand) => (
  <>
    <circle class="art-a" cx={between(rand, 0, 50)} cy={between(rand, 0, 40)} r={between(rand, 30, 44)} />
    <circle class="art-b" cx={between(rand, 100, 160)} cy={between(rand, 50, 90)} r={between(rand, 34, 48)} />
    <circle class="art-c" cx={between(rand, 60, 110)} cy={between(rand, 25, 65)} r={between(rand, 20, 30)} />
    <circle class="art-d" cx={between(rand, 30, 130)} cy={between(rand, 60, 85)} r={between(rand, 3, 6)} />
  </>
)

const peaks: Motif = (rand) => {
  const count = 5
  const span = W / (count - 1)
  return (
    <>
      {range(count).map((i) => {
        const x = round(i * span + between(rand, -10, 10))
        const half = between(rand, 22, 34)
        const top = between(rand, 18, 58)
        return <path class={i % 2 ? 'art-b' : 'art-a'} d={`M${round(x - half)} ${H} L${x} ${top} L${round(x + half)} ${H} Z`} />
      })}
      <path class="art-c" d={`M0 ${between(rand, 20, 40)} L${W} ${between(rand, 10, 50)}`} />
    </>
  )
}

const squares: Motif = (rand) => (
  <>
    {range(9).map((i) => {
      const size = between(rand, 10, 26)
      const x = round((i % 5) * 36 + between(rand, -4, 14))
      const y = round(Math.floor(i / 5) * 44 + between(rand, 4, 26))
      return (
        <rect
          class={pick(rand, ['art-a', 'art-b', 'art-c'])}
          x={x}
          y={y}
          width={size}
          height={size}
          rx={3}
          transform={`rotate(${between(rand, -30, 30)} ${round(x + size / 2)} ${round(y + size / 2)})`}
        />
      )
    })}
  </>
)

const arcs: Motif = (rand) => {
  const cell = 30
  return (
    <>
      {range(3).flatMap((row) =>
        range(6).map((col) => {
          if (rand() < 0.35) return null
          const x = col * cell - 10
          const y = row * cell
          const turn = Math.floor(rand() * 4) * 90
          return (
            <path
              class={rand() < 0.5 ? 'art-a' : 'art-b'}
              d={`M${x} ${y} H${x + cell} A${cell} ${cell} 0 0 1 ${x} ${y + cell} Z`}
              transform={`rotate(${turn} ${x + cell / 2} ${y + cell / 2})`}
            />
          )
        }),
      )}
    </>
  )
}

const MOTIFS: Motif[] = [bubbles, stripes, hills, dots, arcs, rings, peaks, squares]
// 色相の段数を模様の数と同じにしないのは、模様と色相が同じ周期で回り、同じ組み合わせが一定の間隔で並んでしまうため
const HUE_SHIFTS = [0, 24, -20, 40, -34] as const

export const TileArt = ({ index, seed }: { index: number; seed: number }) => {
  const motif = MOTIFS[index % MOTIFS.length]
  const shift = HUE_SHIFTS[index % HUE_SHIFTS.length]
  return (
    <svg class="tile-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={`--art-shift:${shift}`}>
      <rect class="tile-art-bg" width={W} height={H} />
      {motif(mulberry32(seed))}
    </svg>
  )
}
