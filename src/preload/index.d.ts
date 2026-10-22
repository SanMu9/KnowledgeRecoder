import type { KrApi } from '../shared/bridge'

declare global {
  interface Window {
    api: KrApi
  }
}

export {}
