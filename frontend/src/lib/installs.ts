// Услуга «Приложения на iPhone»: общие типы и запросы для админки, витрины /apps
// и страницы заказа /i/<ключ>.
import { API_BASE_URL } from './config'

export type OrderStatus = 'new' | 'ready' | 'active' | 'done' | 'expired' | 'cancelled'
export type OrderMode = 'staff' | 'self'

export interface InstallAccount { id: string; label: string; apple_id: string; note: string | null; is_active: boolean; apps_total: number; apps_active: number; created_at: string }
export interface CatalogApp { id: string; account_id: string; store_id: number | null; bundle_id: string; name: string; title: string | null; icon_url: string | null; version: string | null; genre: string | null; in_store: boolean | null; is_active: boolean; sort: number }
export interface InstallsConfig { price: number; bulk_price: number; bulk_min: number; window_minutes: number; code_limit: number; storefront_enabled: boolean; payment_text: string; support_phone: string; support_telegram: string }
export interface OrderApp { key: string; app_id?: string; bundle_id: string; store_id: number | null; name: string; icon_url: string | null; version: string | null; status: 'pending' | 'installed' }
export interface OrderEvent { t: string; who: string; msg: string }
export interface InstallOrder {
  id: string; number: number; token: string; account_id: string | null; account_label: string | null; apple_id: string | null
  status: OrderStatus; mode: OrderMode; source: 'admin' | 'site'; apps: OrderApp[]; price: number
  customer_name: string | null; customer_phone: string | null; note: string | null; created_by: string | null
  created_at: string; paid_at: string | null; started_at: string | null; expires_at: string | null; finished_at: string | null
  seconds_left: number | null; code_requests: number; code_limit: number; code_requested_at: string | null
  code_value: string | null; code_delivered_at: string | null; code_waiting: boolean; events: OrderEvent[]
  rating: number | null; feedback: string | null
}
export interface OrderStats { orders_today: number; orders_month: number; apps_month: number; revenue_today: number; revenue_month: number; waiting: number; active: number; code_waiting: number }

export interface PublicCodeState { requests: number; limit: number; waiting: boolean; value: string | null; age_seconds: number | null; fresh_seconds: number; retry_in: number }
export interface PublicOrder {
  number: number; status: OrderStatus; mode: OrderMode; apps: OrderApp[]; price: number; paid: boolean
  created_at: string; expires_at: string | null; seconds_left: number | null; window_minutes: number
  apple_id: string | null; code: PublicCodeState; payment_text: string; support_phone: string; support_telegram: string; rating: number | null
}
export interface PublicCatalogApp { id: string; name: string; bundle_id: string; icon_url: string | null; version: string | null; genre: string | null }
export interface PublicCatalog { enabled: boolean; price: number; bulk_price: number; bulk_min: number; window_minutes: number; support_phone: string; support_telegram: string; apps: PublicCatalogApp[] }

/** Настройки по умолчанию — как на сервере, пока их ни разу не сохраняли. */
export const DEFAULT_INSTALLS_CONFIG: InstallsConfig = {
  price: 350, bulk_price: 300, bulk_min: 3, window_minutes: 60, code_limit: 3,
  storefront_enabled: false, payment_text: '', support_phone: '', support_telegram: '',
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; dark: string; light: string }> = {
  new: { label: 'Ждёт подтверждения', dark: 'bg-yellow-400/15 text-yellow-300', light: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Готов к установке', dark: 'bg-sky-500/15 text-sky-300', light: 'bg-sky-100 text-sky-800' },
  active: { label: 'Идёт установка', dark: 'bg-emerald-500/15 text-emerald-300', light: 'bg-emerald-100 text-emerald-800' },
  done: { label: 'Завершён', dark: 'bg-white/10 text-slate-300', light: 'bg-gray-100 text-gray-700' },
  expired: { label: 'Время вышло', dark: 'bg-red-500/15 text-red-300', light: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Отменён', dark: 'bg-white/10 text-slate-500', light: 'bg-gray-100 text-gray-500' },
}

/** Цена заказа: от bulk_min приложений действует цена за штуку пониже. */
export function orderPrice(cfg: Pick<InstallsConfig, 'price' | 'bulk_price' | 'bulk_min'>, count: number): number {
  return count * (count >= cfg.bulk_min ? cfg.bulk_price : cfg.price)
}

export function rub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`
}

/** 3725 → «1:02:05», 185 → «3:05» */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function orderUrl(token: string): string {
  return `${window.location.origin}/i/${token}`
}

/** Текст ошибки из ответа сервера: detail бывает строкой, списком или объектом с message. */
export async function errorText(res: Response): Promise<string> {
  try {
    const d = await res.json()
    const detail = d?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail.message === 'string') return detail.message
    if (Array.isArray(d?.details) && d.details.length) return d.details.map((x: { message?: string }) => x.message).filter(Boolean).join('; ')
    if (Array.isArray(detail)) return detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join('; ')
    if (typeof d?.error === 'string') return d.error
  } catch { /* не JSON */ }
  return res.status === 429 ? 'Слишком часто. Подождите немного.' : `Ошибка ${res.status}`
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/installs/public${path}`, {
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!res.ok) {
    const err = new Error(await errorText(res)) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as T
}

export const publicInstalls = {
  catalog: () => publicRequest<PublicCatalog>('/catalog'),
  createOrder: (body: { app_ids: string[]; name: string; phone: string; consent: boolean }) =>
    publicRequest<{ number: number; token: string }>('/orders', { method: 'POST', body: JSON.stringify(body) }),
  order: (token: string) => publicRequest<PublicOrder>(`/orders/${encodeURIComponent(token)}`),
  start: (token: string) => publicRequest<PublicOrder>(`/orders/${encodeURIComponent(token)}/start`, { method: 'POST' }),
  requestCode: (token: string) => publicRequest<PublicOrder>(`/orders/${encodeURIComponent(token)}/code`, { method: 'POST' }),
  markApp: (token: string, key: string, done: boolean) =>
    publicRequest<PublicOrder>(`/orders/${encodeURIComponent(token)}/apps/${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify({ done }) }),
  finish: (token: string, body: { rating?: number | null; text?: string | null }) =>
    publicRequest<PublicOrder>(`/orders/${encodeURIComponent(token)}/finish`, { method: 'POST', body: JSON.stringify(body) }),
}
