import { useEffect, useState } from 'react'
import { API_BASE_URL } from './config'
import type { ApiProductOut } from '../data/products'

// ─────────────────────────────────────────────────────────────────────────────
// Предзаказ на витрине: список товаров + переключатели из админки.
// Один запрос каждого вида на загрузку страницы — шапка, главная, каталог и
// /preorder делят одни промисы, чтобы не бить в API по несколько раз.
// ─────────────────────────────────────────────────────────────────────────────

export interface PreorderSettings {
  /** Раздел показывается на сайте: пункт меню, блок на главной, чип в каталоге, /preorder */
  preorder_section_enabled: boolean
  /** Предзаказные товары попадают и в общий список каталога, а не только в раздел */
  preorder_in_catalog: boolean
}

const DEFAULT_SETTINGS: PreorderSettings = { preorder_section_enabled: true, preorder_in_catalog: false }
const PREORDER_LIMIT = 200

let productsCache: Promise<ApiProductOut[]> | null = null
let settingsCache: Promise<PreorderSettings> | null = null

export function fetchPreorderProducts(): Promise<ApiProductOut[]> {
  if (!productsCache) {
    productsCache = fetch(`${API_BASE_URL}/api/products/preorder?limit=${PREORDER_LIMIT}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { items?: ApiProductOut[] } | ApiProductOut[]) => {
        const items = Array.isArray(data) ? data : (data.items ?? [])
        return items.filter(p => p.is_active !== false)
      })
      .catch(() => {
        // Сбой сети — не кэшируем пустоту навсегда, следующий вызов попробует снова
        productsCache = null
        return [] as ApiProductOut[]
      })
  }
  return productsCache
}

export function fetchPreorderSettings(): Promise<PreorderSettings> {
  if (!settingsCache) {
    settingsCache = fetch(`${API_BASE_URL}/api/settings/public`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Partial<PreorderSettings>) => ({ ...DEFAULT_SETTINGS, ...data }))
      .catch(() => {
        settingsCache = null
        return DEFAULT_SETTINGS
      })
  }
  return settingsCache
}

export interface PreorderState {
  /** Ответы получены — до этого ничего не рисуем, чтобы блоки не мигали */
  ready: boolean
  /** Раздел включён в админке и в нём есть товары */
  visible: boolean
  /** Показывать предзаказ и в общем каталоге */
  inCatalog: boolean
  products: ApiProductOut[]
}

const EMPTY: PreorderState = { ready: false, visible: false, inCatalog: false, products: [] }

export function usePreorderState(): PreorderState {
  const [state, setState] = useState<PreorderState>(EMPTY)
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchPreorderSettings(), fetchPreorderProducts()]).then(([settings, products]) => {
      if (cancelled) return
      setState({
        ready: true,
        visible: settings.preorder_section_enabled && products.length > 0,
        inCatalog: settings.preorder_in_catalog,
        products,
      })
    })
    return () => { cancelled = true }
  }, [])
  return state
}

/** Есть ли что показывать — для пункта «Предзаказ» в меню */
export function usePreorderAvailable(): boolean {
  return usePreorderState().visible
}
