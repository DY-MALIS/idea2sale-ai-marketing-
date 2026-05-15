/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TIKTOK_CLIENT_ID: string
  readonly VITE_TIKTOK_CLIENT_SECRET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
