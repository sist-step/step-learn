import type { Child, JSX } from 'hono/jsx'
import { cx } from './cx'
import { useStyle } from './style'

export const MASCOT_MOODS = ['normal', 'happy', 'sad', 'surprised', 'thinking', 'sleepy'] as const
export const MASCOT_POSES = ['idle', 'wave', 'greet', 'cheer', 'point', 'raise', 'open'] as const
export const MASCOT_MOTIONS = ['none', 'float', 'bounce', 'hop', 'wiggle', 'nod', 'tilt', 'shake'] as const
export const MASCOT_LOOKS = ['front', 'left', 'right', 'up'] as const

export type MascotMood = (typeof MASCOT_MOODS)[number]
export type MascotPose = (typeof MASCOT_POSES)[number]
export type MascotMotion = (typeof MASCOT_MOTIONS)[number]
export type MascotLook = (typeof MASCOT_LOOKS)[number]

type MascotState = { mood: MascotMood; pose: MascotPose; motion: MascotMotion; look: MascotLook }

export const MASCOT_ACTS = {
  greet: { mood: 'happy', pose: 'greet', motion: 'float', look: 'front' },
  cheer: { mood: 'happy', pose: 'cheer', motion: 'hop', look: 'front' },
  advise: { mood: 'happy', pose: 'point', motion: 'float', look: 'right' },
  idea: { mood: 'surprised', pose: 'raise', motion: 'bounce', look: 'up' },
  ask: { mood: 'normal', pose: 'raise', motion: 'float', look: 'front' },
  think: { mood: 'thinking', pose: 'idle', motion: 'tilt', look: 'up' },
  warn: { mood: 'surprised', pose: 'point', motion: 'shake', look: 'front' },
  agree: { mood: 'happy', pose: 'idle', motion: 'nod', look: 'front' },
  share: { mood: 'happy', pose: 'open', motion: 'bounce', look: 'front' },
  rest: { mood: 'sleepy', pose: 'idle', motion: 'float', look: 'front' },
} as const satisfies Record<string, MascotState>

export type MascotAct = keyof typeof MASCOT_ACTS

const DEFAULT_STATE: MascotState = { mood: 'normal', pose: 'idle', motion: 'float', look: 'front' }

type MascotOwnProps = {
  act?: MascotAct
  mood?: MascotMood
  pose?: MascotPose
  motion?: MascotMotion
  look?: MascotLook
  size?: number
  label?: string
  stand?: boolean
  say?: Child
  class?: string
}

export type MascotProps = MascotOwnProps & Omit<JSX.IntrinsicElements['div'], keyof MascotOwnProps>

const WIDTH = 200
const HEIGHT_WITH_STAND = 220
const HEIGHT_WITHOUT_STAND = 194

// 表情やポーズを描き分けず全部の部品を置いておくのは、表示後に data-* を書き換えるだけで切り替えられるようにするため
export const Mascot = ({ act, mood, pose, motion, look, size = 120, label, stand = true, say, class: cls, ...rest }: MascotProps) => {
  useStyle('/src/components/mascot.css')
  const height = stand ? HEIGHT_WITH_STAND : HEIGHT_WITHOUT_STAND
  const base = act ? MASCOT_ACTS[act] : DEFAULT_STATE
  return (
    <div
      class={cx('mascot', cls)}
      data-mascot
      data-mood={mood ?? base.mood}
      data-pose={pose ?? base.pose}
      data-motion={motion ?? base.motion}
      data-look={look ?? base.look}
      data-talking={say ? '' : undefined}
      data-typing={say ? '' : undefined}
      {...rest}
    >
      <svg
        class="mascot-svg"
        viewBox={`0 0 ${WIDTH} ${height}`}
        width={size}
        height={Math.round((size * height) / WIDTH)}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
      >
        <g class="mascot-actor">
          <g class="mascot-body">
            <path class="mascot-limb" d="M88 158 V180 M112 158 V180" />
            <ellipse class="mascot-ink mascot-foot-l" cx="85" cy="183" rx="9" ry="5" />
            <ellipse class="mascot-ink mascot-foot-r" cx="115" cy="183" rx="9" ry="5" />
            <path class="mascot-ink" d="M94 29 A75 75 0 0 0 51 165.4 L63.3 156.4 A64 64 0 0 1 100 40 Z" />
            <path class="mascot-bracket" d="M108 36 H168 V100" />
            <path class="mascot-face" d="M100 57 H147 V104 A47 47 0 1 1 100 57 Z" />
            <path class="mascot-ring" d="M100 50 H154 V104 A54 54 0 1 1 100 50 Z" pathLength="362" />
            <ellipse class="mascot-cheek" cx="71" cy="115" rx="6.5" ry="4" />
            <ellipse class="mascot-cheek" cx="129" cy="115" rx="6.5" ry="4" />
            <g class="mascot-brows">
              <path class="mascot-line mascot-brow-l" d="M77 91 H89" />
              <path class="mascot-line mascot-brow-r" d="M111 91 H123" />
            </g>
            <g class="mascot-gaze">
              <g class="mascot-eyes-open">
                <g class="mascot-blink">
                  <ellipse class="mascot-pupil" cx="83" cy="104" rx="5" ry="7" />
                  <ellipse class="mascot-pupil" cx="117" cy="104" rx="5" ry="7" />
                  <circle class="mascot-shine" cx="85" cy="101" r="1.8" />
                  <circle class="mascot-shine" cx="119" cy="101" r="1.8" />
                </g>
              </g>
              <path class="mascot-line mascot-eyes-happy" d="M77 106 Q83 97 89 106 M111 106 Q117 97 123 106" />
              <path class="mascot-line mascot-eyes-sleepy" d="M77 104 Q83 109 89 104 M111 104 Q117 109 123 104" />
            </g>
            <path class="mascot-tear" d="M125 110 C121 116 121 120 125 120 C129 120 129 116 125 110 Z" />
            <g class="mascot-mouths">
              <path class="mascot-line mascot-mouth mascot-mouth-normal" d="M93 119 Q100 125 107 119" />
              <path class="mascot-pupil mascot-mouth mascot-mouth-happy" d="M90 117 Q100 133 110 117 Z" />
              <path class="mascot-line mascot-mouth mascot-mouth-sad" d="M93 124 Q100 117 107 124" />
              <ellipse class="mascot-pupil mascot-mouth mascot-mouth-surprised" cx="100" cy="122" rx="5" ry="6" />
              <path class="mascot-line mascot-mouth mascot-mouth-thinking" d="M94 122 Q101 119 107 121" />
              <ellipse class="mascot-pupil mascot-mouth mascot-mouth-sleepy" cx="100" cy="121" rx="3" ry="2.5" />
            </g>
            <g class="mascot-arm mascot-arm-l">
              <path class="mascot-limb" d="M46 124 L31 148" />
              <circle class="mascot-hand" cx="30" cy="150" r="6" />
            </g>
            <g class="mascot-arm mascot-arm-r">
              <path class="mascot-limb" d="M154 124 L169 148" />
              <circle class="mascot-hand" cx="170" cy="150" r="6" />
            </g>
            <g class="mascot-zzz">
              <text x="150" y="24">
                z
              </text>
              <text x="164" y="10">
                z
              </text>
            </g>
          </g>
        </g>
        {stand && (
          <g class="mascot-stand">
            <rect class="mascot-ink" x="56" y="192" width="88" height="24" />
            <text x="101.5" y="209.5">
              STEP
            </text>
          </g>
        )}
      </svg>
      {say && (
        <div class="mascot-say">
          <span class="mascot-say-text">{say}</span>
        </div>
      )}
    </div>
  )
}
