import { useEffect, useRef, useState, useCallback, useMemo, type FormEvent } from 'react'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'

// ─────────────────────────────────────────────────────────────────────────────
// «TakeSmart — Заказы»: отдельное премиальное мини-приложение (PWA) для владельца
// и избранных сотрудников. Вход по админ-логину → живая лента заказов с авто-
// обновлением, статистикой, фильтрами и системными уведомлениями о новых заказах.
// Фоновый Web Push (когда приложение закрыто) добавляется в Ф2 (нужен бэкенд).
// ─────────────────────────────────────────────────────────────────────────────

type StatusKey = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'

const STATUS: Record<string, { label: string; dot: string; pill: string }> = {
  pending: { label: 'Новый', dot: 'bg-blue-400', pill: 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/20' },
  confirmed: { label: 'Подтверждён', dot: 'bg-cyan-400', pill: 'bg-cyan-500/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/20' },
  processing: { label: 'В обработке', dot: 'bg-amber-400', pill: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/20' },
  shipped: { label: 'Отправлен', dot: 'bg-indigo-400', pill: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/20' },
  delivered: { label: 'Доставлен', dot: 'bg-emerald-400', pill: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/20' },
  cancelled: { label: 'Отменён', dot: 'bg-rose-400', pill: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/20' },
  refunded: { label: 'Возврат', dot: 'bg-slate-400', pill: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-400/20' },
}

const FILTERS: { key: string; label: string; statuses?: StatusKey[] }[] = [
  { key: 'all', label: 'Все' },
  { key: 'pending', label: 'Новые', statuses: ['pending'] },
  { key: 'work', label: 'В работе', statuses: ['confirmed', 'processing', 'shipped'] },
  { key: 'delivered', label: 'Доставлены', statuses: ['delivered'] },
]

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

const AVATAR = ['bg-rose-500/80', 'bg-amber-500/80', 'bg-emerald-500/80', 'bg-sky-500/80', 'bg-violet-500/80', 'bg-fuchsia-500/80', 'bg-cyan-500/80', 'bg-orange-500/80']
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR[h % AVATAR.length]
}
const fmtRub = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽'
function timeAgo(iso: string): string {
  const d = new Date(iso)
  const s = (Date.now() - d.getTime()) / 1000
  if (s < 45) return 'только что'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.floor(h / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
function isToday(iso: string): boolean {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

// Подключаем манифест/тему и регистрируем SW только для этого приложения.
function usePwaSetup() {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const createdLink = !link
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
    const prevHref = link.href
    link.href = '/app.webmanifest'

    let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const createdTheme = !theme
    if (!theme) { theme = document.createElement('meta'); theme.name = 'theme-color'; document.head.appendChild(theme) }
    const prevTheme = theme.content
    theme.content = '#020617'

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app-sw.js').catch(() => {})

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
    if (reg) { await reg.showNotification(title, { body, icon: '/app-icon.svg', badge: '/app-icon.svg', tag: 'takesmart-order', data: { url: '/app' } }); return }
  } catch { /* fallback */ }
  try { new Notification(title, { body, icon: '/app-icon.svg' }) } catch { /* ignore */ }
}

const SAFE_TOP = { paddingTop: 'max(env(safe-area-inset-top), 0px)' }
const SAFE_BOTTOM = { paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }

// ── Экран входа ───────────────────────────────────────────────────────────────
function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const ok = await login(username.trim(), password)
    setBusy(false)
    if (!ok) setErr('Неверный логин или пароль')
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-slate-950 px-6">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-yellow-400/20 blur-3xl" />
      <div className="relative mb-9 flex flex-col items-center">
        <img src="/app-icon.svg" alt="" className="h-20 w-20 rounded-3xl shadow-2xl shadow-yellow-400/10 ring-1 ring-white/10" />
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">TakeSmart</h1>
        <p className="mt-1 text-sm text-slate-400">Заказы · вход для сотрудников</p>
      </div>
      <form onSubmit={submit} className="relative w-full max-w-xs space-y-3">
        <input
          value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Логин"
          autoCapitalize="none" autoCorrect="off"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/60 focus:bg-white/10"
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/60 focus:bg-white/10"
        />
        {err && <p className="px-1 text-sm text-rose-400">{err}</p>}
        <button
          type="submit" disabled={busy || !username || !password}
          className="w-full rounded-2xl bg-yellow-400 px-4 py-3.5 font-semibold text-gray-950 shadow-lg shadow-yellow-400/20 transition active:scale-[0.98] hover:bg-yellow-300 disabled:opacity-40"
        >
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

// ── Карточка заказа ───────────────────────────────────────────────────────────
function OrderCard({ o, fresh }: { o: AppOrder; fresh: boolean }) {
  const cfg = STATUS[o.status]
  const initial = (o.customer_name || '?').trim().charAt(0).toUpperCase()
  return (
    <div
      className={`rounded-2xl border bg-white/[0.04] p-4 transition-all duration-500 ${
        fresh ? 'border-yellow-400/50 bg-yellow-400/[0.07] shadow-lg shadow-yellow-400/10' : 'border-white/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-bold tracking-tight text-yellow-400">{o.order_number}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {fresh && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />}
          {timeAgo(o.created_at)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(o.customer_name || '?')}`}>
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{o.customer_name}</div>
          <div className="truncate text-xs text-slate-500">
            {o.shipping_city || '—'}{o.customer_phone ? ` · ${o.customer_phone}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-white">{fmtRub(o.total_amount)}</div>
          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg?.pill || 'bg-slate-500/15 text-slate-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cfg?.dot || 'bg-slate-400'}`} />
            {cfg?.label || o.status}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Кнопка/баннер уведомлений ─────────────────────────────────────────────────
function useNotifyPermission() {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported')
  const request = useCallback(async () => {
    if (!supported) return
    const p = await Notification.requestPermission()
    setPerm(p)
    if (p === 'granted') {
      try { await navigator.serviceWorker?.ready } catch { /* ignore */ }
      await showOrderNotification('Уведомления включены', 'Будем сообщать о новых заказах.')
    }
  }, [supported])
  return { perm, request }
}

// ── Лента заказов ─────────────────────────────────────────────────────────────
function OrdersFeed() {
  const { logout } = useAuth()
  const { perm, request } = useNotifyPermission()
  const [orders, setOrders] = useState<AppOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [filter, setFilter] = useState('all')
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const seenIds = useRef<Set<string> | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders?limit=50`, { headers: getAuthHeaders() })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const items: AppOrder[] = (Array.isArray(data) ? data : data.items ?? [])
        .slice()
        .sort((a: AppOrder, b: AppOrder) => +new Date(b.created_at) - +new Date(a.created_at))

      if (seenIds.current) {
        const fresh = items.filter((o) => !seenIds.current!.has(o.id))
        if (fresh.length) {
          setFreshIds((prev) => { const n = new Set(prev); fresh.forEach((o) => n.add(o.id)); return n })
          const ids = fresh.map((o) => o.id)
          window.setTimeout(() => setFreshIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n }), 8000)
          if (fresh.length === 1) void showOrderNotification(`Новый заказ ${fresh[0].order_number}`, `${fresh[0].customer_name} · ${fmtRub(fresh[0].total_amount)}`)
          else void showOrderNotification(`Новых заказов: ${fresh.length}`, 'Откройте приложение, чтобы посмотреть.')
        }
      }
      seenIds.current = new Set(items.map((o) => o.id))
      setOrders(items); setError(''); setUpdatedAt(new Date())
    } catch {
      setError('Не удалось обновить. Проверьте связь.')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [logout])

  useEffect(() => {
    load()
    const t = window.setInterval(() => load(), 20000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length }
    for (const f of FILTERS) if (f.statuses) c[f.key] = orders.filter((o) => f.statuses!.includes(o.status as StatusKey)).length
    return c
  }, [orders])

  const todayOrders = useMemo(() => orders.filter((o) => isToday(o.created_at)), [orders])
  const todayRevenue = useMemo(() => todayOrders.reduce((s, o) => s + (o.total_amount || 0), 0), [todayOrders])
  const newCount = counts['pending'] ?? 0

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)
    if (!f || !f.statuses) return orders
    return orders.filter((o) => f.statuses!.includes(o.status as StatusKey))
  }, [orders, filter])

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white" style={SAFE_BOTTOM}>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl" style={SAFE_TOP}>
        {refreshing && (
          <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r from-transparent via-yellow-400 to-transparent" />
        )}
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/app-icon.svg" alt="" className="h-9 w-9 rounded-xl ring-1 ring-white/10" />
            <div>
              <div className="text-[15px] font-bold leading-tight">Заказы</div>
              <div className="text-[11px] leading-tight text-slate-500">
                {updatedAt ? `обновлено ${updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'загрузка…'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {perm === 'granted' && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">🔔</span>}
            <button onClick={() => load(true)} aria-label="Обновить" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95">
              <span className={refreshing ? 'inline-block animate-spin' : ''}>↻</span>
            </button>
            <button onClick={logout} aria-label="Выйти" className="flex h-9 items-center rounded-xl bg-white/5 px-3 text-xs text-slate-300 transition hover:bg-white/10 active:scale-95">Выйти</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pt-4">
        {/* Stat hero */}
        <div className="grid grid-cols-2 gap-3">
          <div className="relative overflow-hidden rounded-3xl border border-yellow-400/20 bg-gradient-to-br from-yellow-400/15 to-amber-500/5 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-yellow-200/70">Новые</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-4xl font-extrabold leading-none text-white">{newCount}</span>
              {newCount > 0 && <span className="mb-1 h-2 w-2 animate-pulse rounded-full bg-yellow-400" />}
            </div>
            <div className="mt-1 text-xs text-slate-400">ждут обработки</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Сегодня</div>
            <div className="mt-1 text-4xl font-extrabold leading-none text-white">{todayOrders.length}</div>
            <div className="mt-1 truncate text-xs text-slate-400">на {fmtRub(todayRevenue)}</div>
          </div>
        </div>

        {/* Notifications onboarding */}
        {perm === 'default' && !bannerDismissed && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-yellow-400/15 text-xl">🔔</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Включите уведомления</div>
              <div className="text-xs text-slate-400">Чтобы не пропустить новый заказ</div>
            </div>
            <button onClick={request} className="flex-shrink-0 rounded-xl bg-yellow-400 px-3 py-2 text-xs font-semibold text-gray-950 transition active:scale-95 hover:bg-yellow-300">Включить</button>
            <button onClick={() => setBannerDismissed(true)} aria-label="Скрыть" className="flex-shrink-0 text-slate-500 hover:text-slate-300">✕</button>
          </div>
        )}
        {perm === 'denied' && (
          <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-xs text-rose-300">
            🔕 Уведомления заблокированы. Включите их для сайта в настройках браузера/системы.
          </div>
        )}

        {/* Filter chips */}
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const active = filter === f.key
            const n = counts[f.key]
            return (
              <button
                key={f.key} onClick={() => setFilter(f.key)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition active:scale-95 ${
                  active ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {f.label}
                {n !== undefined && <span className={`text-xs ${active ? 'text-gray-950/60' : 'text-slate-500'}`}>{n}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="mx-auto max-w-xl space-y-3 px-4 pb-8 pt-3">
        {error && <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-sm text-rose-300">{error}</div>}

        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-white/[0.04]" />)
        ) : visible.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-14 text-center">
            <div className="mb-3 text-5xl">📭</div>
            <div className="font-semibold text-white">{filter === 'all' ? 'Заказов пока нет' : 'Нет заказов в этом фильтре'}</div>
          </div>
        ) : (
          visible.map((o) => <OrderCard key={o.id} o={o} fresh={freshIds.has(o.id)} />)
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
