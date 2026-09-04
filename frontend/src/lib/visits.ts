// ─── Свой счётчик визитов ────────────────────────────────────────────────────
// Считаем посещения витрины собственными силами, чтобы админская аналитика
// показывала визиты и конверсию рядом с заказами (Метрика живёт отдельно и её
// данные внутрь панели не отдаёт). Всё здесь — best-effort: любая ошибка
// (нет сети, приватный режим, блокировщик) гасится молча и никогда не мешает
// навигации по сайту.

import { API_BASE_URL } from './config'

const VISITOR_KEY = 'takesmart_visitor_id'
const VISITOR_TS_KEY = 'takesmart_visitor_ts'
const SESSION_KEY = 'takesmart_session_id'

/** Идентификатор посетителя живёт год, потом считаем человека «новым». */
const VISITOR_TTL_MS = 365 * 24 * 60 * 60 * 1000

/** Защита от дублей: StrictMode в dev вызывает эффекты дважды. */
const DEDUPE_WINDOW_MS = 1000

// ── Безопасные обёртки над storage ───────────────────────────────────────────
// В Safari в приватном режиме обращение к localStorage может кинуть исключение.

function readStore(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStore(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value)
  } catch {
    /* приватный режим / переполнение — просто живём без идентификатора */
  }
}

function randomUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      // RFC 4122 v4 из случайных байт — фолбэк для старых браузеров и http-домена
      // (randomUUID доступен только в защищённом контексте).
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch {
    /* ниже — совсем простой фолбэк */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Постоянный id посетителя (localStorage, перевыпускается раз в год). */
export function getVisitorId(): string {
  const store = typeof localStorage !== 'undefined' ? localStorage : undefined
  const existing = readStore(store, VISITOR_KEY)
  const createdAt = Number(readStore(store, VISITOR_TS_KEY) ?? 0)
  const isFresh = existing && createdAt > 0 && Date.now() - createdAt < VISITOR_TTL_MS
  if (existing && isFresh) return existing

  const id = randomUuid()
  writeStore(store, VISITOR_KEY, id)
  writeStore(store, VISITOR_TS_KEY, String(Date.now()))
  return id
}

/** Id сессии (sessionStorage — живёт до закрытия вкладки). */
export function getSessionId(): string {
  const store = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
  const existing = readStore(store, SESSION_KEY)
  if (existing) return existing

  const id = randomUuid()
  writeStore(store, SESSION_KEY, id)
  return id
}

function isSameOrigin(url: string): boolean {
  if (!url || url.startsWith('/')) return true
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

// Последний отправленный путь и время — чтобы не слать дубль на том же рендере.
let lastPath: string | null = null
let lastSentAt = 0

/**
 * Отправить визит. Ошибки не пробрасываются наружу: аналитика не имеет права
 * ронять навигацию. sendBeacon предпочтительнее — он переживает уход со
 * страницы; на кросс-доменном API падаем на fetch с keepalive (beacon не умеет
 * preflight и молча потерял бы запрос).
 */
export function trackVisit(path: string, referrer?: string | null): void {
  try {
    const now = Date.now()
    if (path === lastPath && now - lastSentAt < DEDUPE_WINDOW_MS) return
    lastPath = path
    lastSentAt = now

    const url = `${API_BASE_URL}/api/track/visit`
    const payload = JSON.stringify({
      path,
      referrer: referrer || null,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
    })

    if (isSameOrigin(url) && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
      if (ok) return
      // beacon мог отказать (очередь переполнена) — добиваем обычным запросом
    }

    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* аналитика не критична */
    })
  } catch {
    /* аналитика не критична */
  }
}
