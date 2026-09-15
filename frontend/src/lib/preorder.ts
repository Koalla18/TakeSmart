import { useEffect, useState } from 'react'
import { API_BASE_URL } from './config'
import type { ApiProductOut } from '../data/products'

// ─────────────────────────────────────────────────────────────────────────────
// Предзаказ на витрине. Один запрос на сессию страницы: шапка спрашивает
// «есть ли что показать», главная берёт первые карточки, страница /preorder —
// весь список. Все трое делят один промис, чтобы не бить в API трижды.
// ─────────────────────────────────────────────────────────────────────────────

const PREORDER_LIMIT = 200

let cached: Promise<ApiProductOut[]> | null = null

export function fetchPreorderProducts(): Promise<ApiProductOut[]> {
  if (!cached) {
    cached = fetch(`${API_BASE_URL}/api/products/preorder?limit=${PREORDER_LIMIT}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { items?: ApiProductOut[] } | ApiProductOut[]) => {
        const items = Array.isArray(data) ? data : (data.items ?? [])
        return items.filter(p => p.is_active !== false)
      })
      .catch(() => {
        // Сбой сети — не кэшируем пустоту навсегда, следующий вызов попробует снова
        cached = null
        return [] as ApiProductOut[]
      })
  }
  return cached
}

/** Есть ли активные товары по предзаказу — для пункта меню «Предзаказ» в шапке */
export function usePreorderAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchPreorderProducts().then(items => { if (!cancelled) setAvailable(items.length > 0) })
    return () => { cancelled = true }
  }, [])
  return available
}
