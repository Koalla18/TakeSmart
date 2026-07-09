// ─── Яндекс.Метрика ──────────────────────────────────────────────────────────
// Тонкий типобезопасный слой поверх глобальной функции `ym`, которую грузит
// сниппет в index.html. Все хелперы — no-op, если счётчик ещё не загрузился
// (например, скрипт заблокирован блокировщиком рекламы), чтобы аналитика
// никогда не роняла приложение.

export const YM_COUNTER_ID = 110553535

type YmParams = Record<string, unknown>

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

/** Отправить просмотр страницы (для SPA — вручную при смене роута). */
export function ymHit(url: string, referrer?: string): void {
  window.ym?.(YM_COUNTER_ID, 'hit', url, referrer ? { referer: referrer } : undefined)
}

/** Достигнута цель (add_to_cart, order_success, contact_phone и т.д.). */
export function ymReachGoal(goal: string, params?: YmParams): void {
  window.ym?.(YM_COUNTER_ID, 'reachGoal', goal, params)
}

// ─── E-commerce (dataLayer) ──────────────────────────────────────────────────
// Метрика читает электронную коммерцию из window.dataLayer. Отправляем данные
// в её формате: https://yandex.ru/support/metrica/ecommerce/data.html

interface EcommerceProduct {
  id: string
  name: string
  price: number
  brand?: string
  category?: string
  quantity?: number
}

function pushEcommerce(event: Record<string, unknown>): void {
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ ecommerce: event })
}

/** Товар добавлен в корзину. */
export function ymEcommerceAdd(product: EcommerceProduct): void {
  pushEcommerce({
    currencyCode: 'RUB',
    add: { products: [product] },
  })
}

/** Покупка оформлена. */
export function ymEcommercePurchase(
  orderId: string,
  products: EcommerceProduct[],
  revenue: number,
): void {
  pushEcommerce({
    currencyCode: 'RUB',
    purchase: {
      actionField: { id: orderId, revenue },
      products,
    },
  })
}
