import type { JSX } from 'hono/jsx'
import { Button, IconButton } from './button'
import { Icon } from './icons'
import { MenuItem, Popover } from './overlay'
import { useStyle } from './style'

const VIDEO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

const rateLabel = (rate: number) => (rate === 1 ? '標準' : `${rate}x`)

/** 動画のプレイヤー。操作は client/media.ts が data-video-* で受ける。残りの属性は <video> に付く */
export const VideoPlayer = ({ src, title, ...rest }: { src: string; title: string } & JSX.IntrinsicElements['video']) => {
  useStyle('/src/components/media.css')
  return (
    <div class="video-player" role="region" aria-label={`動画「${title}」`} tabindex={0} data-video-player>
      {/* #t を付けるのは、iOS の Safari が再生するまで最初のコマを描かず、黒い画面になるため */}
      <video class="video-player-media" src={`${src}#t=0.001`} preload="metadata" playsinline {...rest} />
      <button type="button" class="video-player-center" tabindex={-1} aria-hidden="true" data-video-action="play">
        <Icon name="play" size={30} />
      </button>
      <span class="video-player-spinner" aria-hidden="true" />
      <output class="video-player-osd" aria-live="polite" data-video-osd />
      <div class="video-player-controls">
        <div class="video-player-seek" data-video-seek-area>
          <span class="video-player-tip" aria-hidden="true" data-video-tip hidden />
          <input type="range" class="video-player-range" min="0" max="0" step="any" value="0" aria-label="再生位置" data-video-seek />
        </div>
        <div class="video-player-bar">
          <IconButton icon="play" label="再生" title="再生（k）" iconSize={20} class="video-player-fill" data-video-action="play" />
          <IconButton
            icon="pause"
            label="一時停止"
            title="一時停止（k）"
            iconSize={20}
            class="video-player-fill"
            data-video-action="pause"
          />
          <IconButton
            icon="backward"
            label="10 秒戻る"
            title="10 秒戻る（j）"
            iconSize={20}
            class="video-player-skip"
            data-video-action="back"
          />
          <IconButton
            icon="forward"
            label="10 秒進む"
            title="10 秒進む（l）"
            iconSize={20}
            class="video-player-skip"
            data-video-action="forward"
          />
          <div class="video-player-volume">
            <IconButton icon="volume" label="ミュート" title="ミュート（m）" iconSize={20} data-video-action="mute" />
            <IconButton icon="volumeMuted" label="ミュートを解除" title="ミュートを解除（m）" iconSize={20} data-video-action="unmute" />
            <input
              type="range"
              class="video-player-range video-player-level"
              min="0"
              max="1"
              step="0.05"
              value="1"
              aria-label="音量"
              data-video-volume
            />
          </div>
          <span class="video-player-time">
            <span data-video-current>0:00</span>
            <span class="video-player-time-sep">/</span>
            <span data-video-duration>0:00</span>
          </span>
          <Popover
            class="video-player-rate"
            panelClass="video-player-rate-panel"
            trigger={
              <summary class="video-player-rate-label" aria-label="再生速度" title="再生速度" data-video-rate-label>
                1x
              </summary>
            }
          >
            <div role="menu" aria-label="再生速度">
              {VIDEO_RATES.map((rate) => (
                <MenuItem role="menuitemradio" aria-checked={String(rate === 1)} data-video-rate={String(rate)}>
                  {rateLabel(rate)}
                </MenuItem>
              ))}
            </div>
          </Popover>
          {/* 最初から出さないのは、ピクチャー・イン・ピクチャーに対応していないブラウザ（Firefox など）があるため */}
          <IconButton icon="pip" label="ピクチャー・イン・ピクチャー" iconSize={20} hidden data-video-action="pip" />
          <IconButton icon="maximize" label="全画面" title="全画面（f）" iconSize={20} data-video-action="fullscreen" />
          <IconButton icon="minimize" label="全画面を終了" title="全画面を終了（f）" iconSize={20} data-video-action="exit-fullscreen" />
        </div>
      </div>
    </div>
  )
}

/** 画像のビューアー。押すと画面いっぱいに開き、拡大・移動・回転できる（client/media.ts） */
export const ImageViewer = ({
  id,
  src,
  alt,
  name,
  downloadHref,
}: {
  id: string
  src: string
  alt: string
  name: string
  downloadHref?: string
}) => {
  useStyle('/src/components/media.css')
  return (
    <>
      <figure class="image-viewer">
        <button type="button" class="image-viewer-open" popovertarget={id} aria-label={`「${alt}」を拡大して表示`}>
          <img class="image-viewer-img" src={src} alt={alt} loading="lazy" />
          <span class="image-viewer-hint" aria-hidden="true">
            <Icon name="maximize" size={14} />
            拡大
          </span>
        </button>
      </figure>
      <div id={id} popover="auto" class="image-lightbox" role="dialog" aria-label={alt} data-image-lightbox>
        <div class="image-lightbox-stage" data-image-stage>
          {/* 開くまで読み込まないのは、拡大しない人にも同じ画像をもう 1 枚デコードさせないため */}
          <img class="image-lightbox-img" src={src} alt="" loading="lazy" draggable={false} data-image-zoom />
        </div>
        <div class="image-lightbox-head">
          <span class="image-lightbox-name truncate">{name}</span>
          <span class="image-lightbox-dims" data-image-dims />
          <IconButton icon="x" label="閉じる" iconSize={20} popovertarget={id} popovertargetaction="hide" />
        </div>
        <div class="image-lightbox-toolbar" role="toolbar" aria-label="画像の操作">
          <IconButton icon="zoomOut" label="縮小" title="縮小（-）" iconSize={20} data-image-action="zoom-out" />
          <Button
            variant="ghost"
            size="sm"
            class="image-lightbox-zoom"
            aria-label="実寸と全体の表示を切り替える"
            data-image-action="toggle"
          >
            <span data-image-level>100%</span>
          </Button>
          <IconButton icon="zoomIn" label="拡大" title="拡大（+）" iconSize={20} data-image-action="zoom-in" />
          <span class="image-lightbox-sep" />
          <IconButton icon="minimize" label="全体を表示" title="全体を表示（0）" iconSize={20} data-image-action="fit" />
          <IconButton icon="redo" label="右に回転" title="右に回転（r）" iconSize={20} data-image-action="rotate" />
          {downloadHref && (
            <>
              <span class="image-lightbox-sep" />
              <IconButton icon="download" label="ダウンロード" iconSize={20} href={downloadHref} download data-no-prefetch />
            </>
          )}
        </div>
      </div>
    </>
  )
}
