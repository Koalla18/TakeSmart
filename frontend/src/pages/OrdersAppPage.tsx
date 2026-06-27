import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'

// ─────────────────────────────────────────────────────────────────────────────
// «TakeSmart — Заказы»: отдельное мини-приложение (PWA) для владельца и избранных.
// Вход по админ-логину → лента заказов с авто-обновлением. Новый заказ → системное
// уведомление (пока приложение открыто). Фоновый Web Push добавим в Ф2 (нужен бэкенд).
// Доступ только у тех, у кого есть админ-аккаунт.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  pending: { label: 'Новый', cls: 'bg-blue-500/20 text-blue-300', icon: '🆕' },
  confirmed: { label: 'Подтверждён', cls: 'bg-cyan-500/20 text-cyan-300', icon: '✅' },
  processing: { label: 'В обработке', cls: 'bg-orange-500/20 text-orange-300', icon: '⏳' },
  shipped: { label: 'Отправлен', cls: 'bg-indigo-500/20 text-indigo-300', icon: '🚚' },
  delivered: { label: 'Доставлен', cls: 'bg-green-500/20 text-green-300', icon: '📦' },
  cancelled: { label: 'Отменён', cls: 'bg-red-500/20 text-red-300', icon: '❌' },
  refunded: { label: 'Возврат', cls: 'bg-gray-500/20 text-gray-300', icon: '💸' },
}

interface AppOrder {
  id: string
  order_number: string
  customer_name: string
  customer_phone?: string | null
  shipping_city?: string | null
  status: string
  total_amount: number
  created_at: string
}

const fmtRub = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽'
const fmtTime = (s: string) =>
  new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Подключаем манифест/тему и регистрируем SW только для этого приложения.
function usePwaSetup() {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const createdLink = !link
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    const prevHref = link.href
    link.href = '/app.webmanifest'

    let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const createdTheme = !theme
    if (!theme) {
      theme = document.createElement('meta')
      theme.name = 'theme-color'
      document.head.appendChild(theme)
    }
    const prevTheme = theme.content
    theme.content = '#0f172a'

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/app-sw.js').catch(() => {})
    }

    return () => {
      if (link) link.href = createdLink ? '' : prevHref
      if (theme) theme.content = createdTheme ? '' : prevTheme
    }
  }, [])
}

async function showOrderNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg) {
      await reg.showNotification(title, { body, icon: '/app-icon.svg', badge: '/app-icon.svg', tag: 'takesmart-order', data: { url: '/app' } })
      return
    }
  } catch { /* fallback below */ }
  try { new Notification(title, { body, icon: '/app-icon.svg' }) } catch { /* ignore */ }
}

function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const ok = await login(username.trim(), password)
    setBusy(false)
    if (!ok) setErr('Неверный логин или пароль')
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-900 px-6">
      <div className="mb-8 flex flex-col items-center">
        <img src="/app-icon.svg" alt="" className="h-16 w-16 rounded-2xl" />
        <h1 className="mt-4 text-xl font-bold text-white">TakeSmart — Заказы</h1>
        <p className="mt-1 text-sm text-slate-400">Вход для сотрудников</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-xs space-y-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Логин"
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-yellow-400/60"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-yellow-400/60"
        />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full rounded-xl bg-yellow-400 px-4 py-3 font-semibold text-gray-900 transition hover:bg-yellow-300 disabled:opacity-40"
        >
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

function NotifyButton() {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported')
  const [busy, setBusy] = useState(false)

  const enable = useCallback(async () => {
    if (!supported) return
    setBusy(true)
    try {
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p === 'granted') {
        try { await navigator.serviceWorker?.ready } catch { /* ignore */ }
        await showOrderNotification('Уведомления включены', 'Вы будете получать оповещения о новых заказах.')
      }
    } finally {
      setBusy(false)
    }
  }, [supported])

  if (!supported) return <span className="text-xs text-slate-500">Уведомления не поддерживаются</span>
  if (perm === 'granted') return <span className="rounded-lg bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-300">🔔 Уведомления вкл.</span>
  if (perm === 'denied') return <span className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300">🔕 Заблокированы в системе</span>
  return (
    <button onClick={enable} disabled={busy} className="rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-yellow-300 disabled:opacity-40">
      {busy ? '…' : '🔔 Включить уведомления'}
    </button>
  )
}

function OrdersFeed() {
  const { logout } = useAuth()
  const [orders, setOrders] = useState<AppOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const seenIds = useRef<Set<string> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders?limit=50`, { headers: getAuthHeaders() })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const items: AppOrder[] = (Array.isArray(data) ? data : data.items ?? [])
        .slice()
        .sort((a: AppOrder, b: AppOrder) => +new Date(b.created_at) - +new Date(a.created_at))

      // Уведомление о новых заказах (кроме самой первой загрузки)
      if (seenIds.current) {
        const fresh = items.filter((o) => !seenIds.current!.has(o.id))
        if (fresh.length === 1) {
          const o = fresh[0]
          void showOrderNotification(`Новый заказ ${o.order_number}`, `${o.customer_name} · ${fmtRub(o.total_amount)}`)
        } else if (fresh.length > 1) {
          void showOrderNotification(`Новых заказов: ${fresh.length}`, 'Откройте приложение, чтобы посмотреть.')
        }
      }
      seenIds.current = new Set(items.map((o) => o.id))

      setOrders(items)
      setError('')
      setUpdatedAt(new Date())
    } catch {
      setError('Не удалось обновить. Проверьте связь.')
    } finally {
      setLoading(false)
    }
  }, [logout])

  useEffect(() => {
    load()
    const t = window.setInterval(load, 20000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  return (
    <div className="min-h-[100dvh] bg-slate-900 pb-10">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src="/app-icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <div>
              <div className="text-sm font-bold leading-tight text-white">Заказы</div>
              <div className="text-[11px] leading-tight text-slate-500">
                {updatedAt ? `обновлено ${updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '…'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotifyButton />
            <button onClick={() => load()} aria-label="Обновить" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-sm text-white hover:bg-white/20">↻</button>
            <button onClick={logout} aria-label="Выйти" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/20">Выйти</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-3 py-4">
        {error && <div className="mb-3 rounded-xl bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />)}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl bg-white/5 p-12 text-center">
            <div className="mb-3 text-4xl">📭</div>
            <div className="font-semibold text-white">Заказов пока нет</div>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const cfg = STATUS[o.status]
              return (
                <div key={o.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-yellow-400">{o.order_number}</span>
                    <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${cfg?.cls || 'bg-gray-500/20 text-gray-300'}`}>
                      {cfg?.icon} {cfg?.label || o.status}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">{o.customer_name}</div>
                  {o.customer_phone && <div className="text-xs text-slate-500">{o.customer_phone}</div>}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-400">{o.shipping_city || '—'} · {fmtTime(o.created_at)}</span>
                    <span className="text-sm font-bold text-yellow-400">{fmtRub(o.total_amount)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function OrdersAppPage() {
  const { isAuthenticated } = useAuth()
  usePwaSetup()
  return isAuthenticated ? <OrdersFeed /> : <LoginScreen />
}
