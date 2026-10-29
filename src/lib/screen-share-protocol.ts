// Node の API を使わないのは、ブラウザ側の src/screen-share.ts からも読み込むため

export const MAX_WIDTH = 1920
export const MAX_HEIGHT = 1080
export const MAX_FPS = 30
export const MAX_FRAME_BYTES = 4_000_000

export type ShareMode = 'present' | 'view'

export type StreamConfig = { codec: string; width: number; height: number }

export type FrameMeta = { key: boolean; timestamp: number }

export type ShareAuth = { courseId: number; mode: ShareMode }

export type ServerToClientEvents = {
  stream: (info: { presenter: string; config: StreamConfig }) => void
  idle: () => void
  frame: (meta: FrameMeta, data: ArrayBuffer | Uint8Array, ack: () => void) => void
  keyframe: () => void
  viewers: (count: number) => void
}

export type ClientToServerEvents = {
  config: (config: StreamConfig) => void
  frame: (meta: FrameMeta, data: ArrayBuffer | Uint8Array, ack: () => void) => void
  keyframe: () => void
}

export type ShareError = 'not_found' | 'busy'
