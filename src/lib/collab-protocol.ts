// Node の API を使わないのは、ブラウザ側の src/collab/provider.ts からも読み込むため

/** socket.io の接続先のパス。画面共有（/socket.io）とは別のサーバーにする */
export const COLLAB_SOCKET_PATH = '/collab-io/'

export type CollabAuth = { courseId: number; itemId: number; owner: string }

export type ServerToClientEvents = {
  /** 接続した直後のサーバーの状態。state は全体、vector はサーバーの状態ベクトル（クライアントの差分を返してもらうため） */
  sync: (state: Uint8Array, vector: Uint8Array) => void
  update: (update: Uint8Array) => void
  awareness: (update: Uint8Array) => void
  /** 大きすぎるなどで変更を受け付けなかった。このあと接続を切る */
  rejected: (reason: CollabError) => void
  /** 権限がなくなったので、このあと接続を切る */
  revoked: () => void
}

export type ClientToServerEvents = {
  update: (update: Uint8Array) => void
  awareness: (update: Uint8Array) => void
}

export type CollabError = 'not_found' | 'too_large'
