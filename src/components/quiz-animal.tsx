import type { Child } from 'hono/jsx'
import type { QuizKind } from '../lib/quiz'
import { useStyle } from './style'

export type AnimalMood = 'normal' | 'happy' | 'sad'

type Animal = {
  /** 代替テキストに使う呼び名 */
  name: string
  /** ゲームの見た目で、その形式の答え方を伝えるひとこと */
  hint: string
  /** 目より後ろに描く形（耳・頭・模様） */
  body: Child
  /** 目と口より手前に描く形（鼻・くちばし・歯） */
  front?: Child
  /** 左右の目の x と、目の y */
  eyes: [number, number, number]
  eyeSize: number
  /** 口の中心の x と y、幅の半分。くちばしの動物には口を描かない */
  mouth?: [number, number, number]
}

const Mirror = ({ children }: { children: Child }) => (
  <>
    {children}
    <g transform="translate(100 0) scale(-1 1)">{children}</g>
  </>
)

/** 出題の形式ごとの案内役。形式と動物の動きや習性を結び付けて、どの形式かを絵で覚えられるようにしている */
export const QUIZ_ANIMALS: Record<QuizKind, Animal> = {
  choice: {
    name: 'フクロウ',
    hint: '正しいものをひとつ選ぼう。まよったら、ちがうものから消していくといいよ。',
    body: (
      <>
        <Mirror>
          <path class="qa-main" d="M19 32 L23 9 L43 25 Z" />
        </Mirror>
        <ellipse class="qa-main" cx="50" cy="57" rx="38" ry="35" />
        <ellipse class="qa-sub" cx="50" cy="78" rx="20" ry="11" />
        <Mirror>
          <circle class="qa-white" cx="34" cy="49" r="15" />
        </Mirror>
      </>
    ),
    front: <path class="qa-accent qa-round" d="M45 59 L55 59 L50 68 Z" />,
    eyes: [34, 66, 49],
    eyeSize: 6,
  },
  output: {
    name: 'ネコ',
    hint: '頭の中でコードを動かしてみよう。画面に出る文字を、そのまま書いてね。',
    body: (
      <>
        <Mirror>
          <path class="qa-main qa-round" d="M15 42 L19 11 L44 27 Z" />
          <path class="qa-accent" d="M22 33 L24 19 L36 28 Z" />
        </Mirror>
        <ellipse class="qa-main" cx="50" cy="59" rx="38" ry="32" />
        <path class="qa-line qa-shade-line" d="M50 28 L50 36 M41 30 L43 37 M59 30 L57 37" />
        <ellipse class="qa-sub" cx="50" cy="69" rx="15" ry="10" />
        <Mirror>
          <path class="qa-line qa-whisker" d="M7 61 L21 64 M7 71 L21 69" />
        </Mirror>
      </>
    ),
    front: <path class="qa-accent qa-round" d="M46.5 62 L53.5 62 L50 66 Z" />,
    eyes: [34, 66, 54],
    eyeSize: 5,
    mouth: [50, 69, 6],
  },
  order: {
    name: 'ペンギン',
    hint: 'ばらばらの行を、正しく動く順にならべよう。行はつかんで動かせるよ。',
    body: (
      <>
        <circle class="qa-main" cx="50" cy="54" r="38" />
        <Mirror>
          <circle class="qa-white" cx="37" cy="52" r="17" />
        </Mirror>
        <ellipse class="qa-white" cx="50" cy="67" rx="27" ry="18" />
        <Mirror>
          <circle class="qa-cheek" cx="27" cy="65" r="5" />
        </Mirror>
      </>
    ),
    front: <ellipse class="qa-accent" cx="50" cy="62" rx="8" ry="5" />,
    eyes: [37, 63, 50],
    eyeSize: 5,
  },
  bug: {
    name: 'カエル',
    hint: 'バグ（まちがい）は、どの行にかくれているかな？ 1 行だけ選んでね。',
    body: (
      <>
        <Mirror>
          <circle class="qa-main" cx="30" cy="34" r="15" />
        </Mirror>
        <ellipse class="qa-main" cx="50" cy="62" rx="42" ry="30" />
        <ellipse class="qa-sub" cx="50" cy="79" rx="26" ry="11" />
        <Mirror>
          <circle class="qa-white" cx="30" cy="34" r="10" />
          <circle class="qa-cheek" cx="20" cy="66" r="5" />
          <circle class="qa-ink" cx="46" cy="55" r="1.3" />
        </Mirror>
      </>
    ),
    eyes: [30, 70, 34],
    eyeSize: 5,
    mouth: [50, 64, 15],
  },
  flow: {
    name: 'ウサギ',
    hint: 'コードが実行される順に、行をぴょんぴょん押していこう。同じ行を何回押してもいいよ。',
    body: (
      <>
        <Mirror>
          <ellipse class="qa-main" cx="36" cy="25" rx="10" ry="24" transform="rotate(-8 36 25)" />
          <ellipse class="qa-accent" cx="36" cy="27" rx="4.5" ry="16" transform="rotate(-8 36 27)" />
        </Mirror>
        <ellipse class="qa-main" cx="50" cy="65" rx="34" ry="29" />
        <Mirror>
          <circle class="qa-cheek" cx="27" cy="72" r="5" />
        </Mirror>
      </>
    ),
    front: <path class="qa-accent qa-round" d="M47 66 L53 66 L50 69.5 Z" />,
    eyes: [37, 63, 61],
    eyeSize: 5,
    mouth: [50, 73, 5],
  },
  indent: {
    name: 'カニ',
    hint: 'よこ歩きはまかせて！ 左右のボタンで行を動かして、字下げをつけ直そう。',
    body: (
      <>
        <Mirror>
          <path class="qa-line qa-limb" d="M23 58 L16 48 M19 72 L7 78 M22 80 L12 90" />
          <path class="qa-main" d="M13 40 L23.4 34 A12 12 0 1 1 13 28 Z" />
          <path class="qa-line qa-limb" d="M40 46 L38 32" />
        </Mirror>
        <ellipse class="qa-main" cx="50" cy="67" rx="34" ry="24" />
        <Mirror>
          <circle class="qa-white" cx="38" cy="28" r="9" />
          <circle class="qa-cheek" cx="28" cy="72" r="5" />
        </Mirror>
      </>
    ),
    eyes: [38, 62, 28],
    eyeSize: 4.5,
    mouth: [50, 70, 8],
  },
  table: {
    name: 'リス',
    hint: '変数の値をメモしていこう。くり返しの 1 回ごとに、いくつになるかな？',
    body: (
      <>
        <circle class="qa-shade" cx="77" cy="42" r="23" />
        <circle class="qa-sub" cx="78" cy="40" r="11" />
        <circle class="qa-main" cx="28" cy="31" r="9" />
        <circle class="qa-main" cx="58" cy="29" r="9" />
        <circle class="qa-accent" cx="28" cy="31" r="4" />
        <circle class="qa-accent" cx="58" cy="29" r="4" />
        <ellipse class="qa-main" cx="44" cy="60" rx="32" ry="30" />
        <ellipse class="qa-sub" cx="28" cy="72" rx="12" ry="10" />
        <ellipse class="qa-sub" cx="60" cy="72" rx="12" ry="10" />
      </>
    ),
    front: (
      <>
        <rect class="qa-white" x="41.5" y="71" width="5" height="5.5" rx="1" />
        <ellipse class="qa-ink" cx="44" cy="64.5" rx="3" ry="2.2" />
      </>
    ),
    eyes: [32, 56, 54],
    eyeSize: 5,
    mouth: [44, 70, 5],
  },
}

const Eyes = ({ animal, mood }: { animal: Animal; mood: AnimalMood }) => {
  const [left, right, y] = animal.eyes
  const r = animal.eyeSize
  return (
    <g class={`qa-eyes qa-${mood}`}>
      {[left, right].map((x, i) => {
        // 眉の内側の端を下げないのは、怒った顔に見えて、間違えた学生を責めているように受け取られるため
        const inner = i === 0 ? 1 : -1
        return mood === 'happy' ? (
          <path class="qa-line qa-ink-line" d={`M${x - r - 1} ${y + 1.5} Q${x} ${y - r - 3} ${x + r + 1} ${y + 1.5}`} />
        ) : (
          <>
            <circle class="qa-ink" cx={x} cy={y} r={r} />
            <circle class="qa-shine" cx={x + r * 0.32} cy={y - r * 0.36} r={r * 0.32} />
            {mood === 'sad' && (
              <path class="qa-line qa-ink-line" d={`M${x - inner * (r + 1)} ${y - r - 3} L${x + inner * (r + 0.5)} ${y - r - 6.5}`} />
            )}
          </>
        )
      })}
    </g>
  )
}

const Mouth = ({ animal, mood }: { animal: Animal; mood: AnimalMood }) => {
  if (!animal.mouth) return null
  const [x, y, w] = animal.mouth
  if (mood === 'happy') return <path class={`qa-ink qa-round qa-${mood}`} d={`M${x - w} ${y} Q${x} ${y + w * 1.7} ${x + w} ${y} Z`} />
  const d =
    mood === 'sad'
      ? `M${x - w * 0.8} ${y + 3.5} Q${x} ${y - 1.5} ${x + w * 0.8} ${y + 3.5}`
      : `M${x - w} ${y} Q${x} ${y + w * 0.75} ${x + w} ${y}`
  return <path class={`qa-line qa-ink-line qa-${mood}`} d={d} />
}

const MOODS: readonly AnimalMood[] = ['normal', 'happy', 'sad']

/**
 * 小テストのゲームの見た目に出す動物。3 つの表情をすべて描いておき、data-mood（か、親の data-done）で CSS が出し分ける。
 * label を渡さなければ飾りとして読み上げから隠す
 */
export const QuizAnimal = ({
  kind,
  size = 64,
  mood = 'normal',
  label,
  class: cls,
}: {
  kind: QuizKind
  size?: number
  mood?: AnimalMood
  label?: string
  class?: string
}) => {
  useStyle('/src/components/quiz-game.css')
  const animal = QUIZ_ANIMALS[kind]
  return (
    <svg
      class={`qa qa-${kind}${cls ? ` ${cls}` : ''}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      data-mood={mood}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      {animal.body}
      {MOODS.map((m) => (
        <Eyes animal={animal} mood={m} />
      ))}
      {MOODS.map((m) => (
        <Mouth animal={animal} mood={m} />
      ))}
      {animal.front}
    </svg>
  )
}
