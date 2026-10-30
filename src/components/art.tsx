import { raw } from 'hono/html'
import { useStyle } from './style'

// 画像ファイルにしないのは、ノイズを歪ませて描けば数百バイトで済み、色もテーマのトークンに合わせられるため
// JSX で書かないのは、hono が baseFrequency などの SVG 属性名をそのまま出力する保証がないため
export const FluidArt = ({ id, class: cls }: { id: string; class?: string }) => {
  useStyle('/src/components/art.css')
  return raw(`<svg class="${cls ?? 'fluid-art'}" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${id}-bands" x1="0" y1="0" x2="0.16" y2="0.1" spreadMethod="reflect">
      <stop offset="0" class="art-deep" />
      <stop offset="0.15" class="art-deep" />
      <stop offset="0.55" class="art-mid" />
      <stop offset="0.82" class="art-bright" />
      <stop offset="0.93" class="art-shine" />
      <stop offset="1" class="art-bright" />
    </linearGradient>
    <filter id="${id}-flow" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0026 0.004" numOctaves="3" seed="12" />
      <feDisplacementMap in="SourceGraphic" scale="400" xChannelSelector="R" yChannelSelector="B" />
      <feGaussianBlur stdDeviation="2.5" />
    </filter>
  </defs>
  <rect x="-150" y="-150" width="900" height="1100" fill="url(#${id}-bands)" filter="url(#${id}-flow)" />
</svg>`)
}
