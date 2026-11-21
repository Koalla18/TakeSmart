/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** Ключ JavaScript API Яндекс Карт с тарифом «Базовый (без рекламы)» — убирает рекламу в карте магазина */
  readonly VITE_YANDEX_MAPS_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
