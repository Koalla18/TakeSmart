import { useEffect, useRef, useState, useCallback, useMemo, type FormEvent } from 'react'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { PricesPanel } from './PricesPanel'

// ─────────────────────────────────────────────────────────────────────────────
// «TakeSmart — Заказы»: отдельное премиальное мини-приложение (PWA) для владельца
// и избранных. Лента заказов + детальный экран с составом, данными клиента и
// быстрыми действиями (звонок, WhatsApp, карта, смена статуса) — богаче админки.
// Фоновый Web Push — Ф2 (нужен бэкенд).
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
const FLOW: StatusKey[] = ['pending', 'confirmed', 'processing', 'shipped', 'delivered']
const ALL_STATUSES: StatusKey[] = [...FLOW, 'cancelled', 'refunded']

const PAYMENT: Record<string, string> = {
  pending: 'Ожидает оплаты', unpaid: 'Не оплачен', paid: 'Оплачен', failed: 'Ошибка оплаты', refunded: 'Возвращён',
}

const FILTERS: { key: string; label: string; statuses?: StatusKey[] }[] = [
  { key: 'all', label: 'Все' },
  { key: 'pending', label: 'Новые', statuses: ['pending'] },
  { key: 'work', label: 'В работе', statuses: ['confirmed', 'processing', 'shipped'] },
  { key: 'delivered', label: 'Доставлены', statuses: ['delivered'] },
]

interface OrderItem { id: string; product_id: string; product_name: string; product_sku: string | null; unit_price: number; total_price: number; quantity: number }
interface AppOrder {
  id: string; order_number: string; customer_name: string; customer_email?: string | null; customer_phone?: string | null
  customer_note?: string | null; admin_note?: string | null
  shipping_address?: string | null; shipping_city?: string | null; shipping_postal_code?: string | null
  status: string; payment_status?: string; total_amount: number; items_count?: number; created_at: string
}
interface OrderDetail extends AppOrder { items: OrderItem[] }

const AVATAR = ['bg-rose-500/80', 'bg-amber-500/80', 'bg-emerald-500/80', 'bg-sky-500/80', 'bg-violet-500/80', 'bg-fuchsia-500/80', 'bg-cyan-500/80', 'bg-orange-500/80']
function avatarColor(name: string): string { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return AVATAR[h % AVATAR.length] }
const fmtRub = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽'
function timeAgo(iso: string): string {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000
  if (s < 45) return 'только что'
  const m = Math.floor(s / 60); if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60); if (h < 24) return `${h} ч назад`
  const days = Math.floor(h / 24); if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
function isToday(iso: string): boolean { const d = new Date(iso), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() }
// Ключ дня (локальный) и человеческая подпись — для группировки ленты по дням.
function dayKey(iso: string): string { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function dayLabel(iso: string): string {
  const d = new Date(iso), n = new Date()
  const dk = dayKey(iso)
  if (dk === dayKey(n.toISOString())) return 'Сегодня'
  const y = new Date(n); y.setDate(n.getDate() - 1)
  if (dk === dayKey(y.toISOString())) return 'Вчера'
  const sameYear = d.getFullYear() === n.getFullYear()
  return d.toLocaleDateString('ru-RU', sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' })
}

function usePwaSetup() {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const createdLink = !link
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
    const prevHref = link.href; link.href = '/app.webmanifest'
    let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const createdTheme = !theme
    if (!theme) { theme = document.createElement('meta'); theme.name = 'theme-color'; document.head.appendChild(theme) }
    const prevTheme = theme.content; theme.content = '#020617'
    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    const createdApple = !apple
    if (!apple) { apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; document.head.appendChild(apple) }
    const prevApple = apple.href; apple.href = '/app-icon-180.png'
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app-sw.js').catch(() => {})
    return () => { if (link) link.href = createdLink ? '' : prevHref; if (theme) theme.content = createdTheme ? '' : prevTheme; if (apple) apple.href = createdApple ? '' : prevApple }
  }, [])
}
async function showOrderNotification(title: string, body: string, tag = 'takesmart-order') {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const opts = { body, icon: '/app-icon-192.png', badge: '/app-icon-192.png', tag, renotify: true, data: { url: '/app' } } as NotificationOptions
  try { const reg = await navigator.serviceWorker?.ready; if (reg) { await reg.showNotification(title, opts); return } } catch { /* */ }
  try { new Notification(title, { body, icon: '/app-icon-192.png', tag }) } catch { /* */ }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Подписка на Web Push: берём VAPID-ключ с бэкенда, подписываемся, отправляем подписку.
async function subscribeToPush(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const res = await fetch(`${API_BASE_URL}/api/push/vapid-public-key`)
      if (!res.ok) return false
      const { public_key } = await res.json()
      if (!public_key) return false
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) as unknown as BufferSource })
    }
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return false
    try { const tk = localStorage.getItem('takesmart_admin_token'); if (tk) await idbPutToken(tk) } catch { /* */ }
    const r = await fetch(`${API_BASE_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, user_agent: navigator.userAgent.slice(0, 280) }),
    })
    return r.ok
  } catch { return false }
}

// Снять подписку (и удалить её с сервера). Нужно в обычной вкладке браузера,
// чтобы не было ДУБЛЕЙ уведомлений (вкладка + установленное приложение).
async function unsubscribePush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const ep = (sub.toJSON() as { endpoint?: string }).endpoint
    if (ep) {
      try {
        await fetch(`${API_BASE_URL}/api/push/unsubscribe`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: ep }),
        })
      } catch { /* */ }
    }
    try { await sub.unsubscribe() } catch { /* */ }
  } catch { /* */ }
}

// Держим подписку только в установленном приложении (иначе дубли уведомлений:
// вкладка Safari + приложение). В обычной вкладке — снимаем.
function syncPush(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (isStandalone()) void subscribeToPush()
  else void unsubscribePush()
}

// ── Звук уведомления ────────────────────────────────────────────────────────────
// Реальные аудиофайлы (public/sounds) играем через WebAudio: AudioContext
// разблокируется по жесту (клик), после чего звук работает и из таймера опроса.
// ВАЖНО: при ЗАКРЫТОМ приложении звук уведомления играет сама система (iOS/macOS) —
// выбор ниже влияет на звук, только пока приложение открыто.
const SOUNDS: { id: string; label: string; file: string }[] = [
  { id: 'notify', label: 'Уведомление', file: '/sounds/plyus_org-z_uk-u_edomleniya-4.mp3' },
  { id: 'vk', label: 'ВКонтакте', file: '/sounds/u_edomlenie-vkontakte.mp3' },
  { id: 'ding', label: 'Динь', file: '/sounds/u_edomlenie-9.mp3' },
  { id: 'signal', label: 'Сигнал', file: '/sounds/3380422.mp3' },
  { id: 'chord', label: 'Аккорд', file: '/sounds/chord.mp3' },
  { id: 'note', label: 'Нота', file: '/sounds/note.mp3' },
]
const DEFAULT_SOUND_ID = 'notify'
function getSoundId(): string {
  try {
    const v = localStorage.getItem('takesmart_app_sound_id')
    if (v && SOUNDS.some((s) => s.id === v)) return v
  } catch { /* */ }
  return DEFAULT_SOUND_ID
}
function soundFile(id: string): string { return (SOUNDS.find((s) => s.id === id) || SOUNDS[0]).file }

let _audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    if (!_audioCtx) _audioCtx = new Ctx()
    return _audioCtx
  } catch { return null }
}
const _buffers = new Map<string, AudioBuffer>()
async function loadSound(id: string): Promise<AudioBuffer | null> {
  if (_buffers.has(id)) return _buffers.get(id)!
  const ctx = getAudioCtx(); if (!ctx) return null
  try {
    const res = await fetch(soundFile(id)); const arr = await res.arrayBuffer()
    const buf = await ctx.decodeAudioData(arr)
    _buffers.set(id, buf); return buf
  } catch { return null }
}
function unlockAudio() {
  const c = getAudioCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {})
  void loadSound(getSoundId())
}
// Проиграть звук (буфер через WebAudio, фолбэк — HTMLAudio) + вибрация.
async function playSound(id: string, vibrate = true) {
  const ctx = getAudioCtx()
  let played = false
  if (ctx) {
    try {
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      const buf = await loadSound(id)
      if (buf) {
        const src = ctx.createBufferSource(); const g = ctx.createGain()
        g.gain.value = 0.9; src.buffer = buf; src.connect(g); g.connect(ctx.destination); src.start()
        played = true
      }
    } catch { /* */ }
  }
  if (!played) { try { const a = new Audio(soundFile(id)); a.volume = 1; void a.play().catch(() => {}) } catch { /* */ } }
  if (vibrate) { try { navigator.vibrate?.([180, 80, 180]) } catch { /* */ } }
}
function playAlert() { void playSound(getSoundId(), true) }

// Установлено ли как приложение (Home Screen / Dock) — от этого зависит доставка
// уведомлений при ЗАКРЫТОМ приложении (особенно на iOS).
function isStandalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches === true
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true
  } catch { return false }
}

// Кладём токен в IndexedDB, чтобы service worker мог переподписаться в фоне
// (событие pushsubscriptionchange) даже без открытого приложения.
function idbPutToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('takesmart-app', 1)
      req.onupgradeneeded = () => { try { req.result.createObjectStore('kv') } catch { /* */ } }
      req.onsuccess = () => {
        try {
          const db = req.result
          const tx = db.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(token, 'authToken')
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => { try { db.close() } catch { /* */ } ; resolve() }
        } catch { resolve() }
      }
      req.onerror = () => resolve()
    } catch { resolve() }
  })
}

const SAFE_TOP = { paddingTop: 'max(env(safe-area-inset-top), 0px)' }
const SAFE_BOTTOM = { paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }

// ── Кнопка «копировать» ────────────────────────────────────────────────────────
function CopyBtn({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400) } catch { /* */ } }}
      className={className || 'inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition active:scale-95 hover:bg-white/10'}
    >
      {done ? '✓ Скопировано' : children}
    </button>
  )
}

// ── Экран входа ───────────────────────────────────────────────────────────────
function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const ok = await login(username.trim(), password); setBusy(false)
    if (!ok) setErr('Неверный логин или пароль')
  }
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-slate-950 px-6">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-yellow-400/20 blur-3xl" />
      <div className="relative mb-9 flex flex-col items-center">
        <img src="/app-icon-192.png" alt="" className="h-20 w-20 rounded-3xl shadow-2xl shadow-yellow-400/10 ring-1 ring-white/10" />
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">TakeSmart</h1>
        <p className="mt-1 text-sm text-slate-400">Заказы · вход для сотрудников</p>
      </div>
      <form onSubmit={submit} className="relative w-full max-w-xs space-y-3">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Логин" aria-label="Логин" autoComplete="username" autoCapitalize="none" autoCorrect="off"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/60 focus:bg-white/10" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" aria-label="Пароль" autoComplete="current-password"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/60 focus:bg-white/10" />
        {err && <p className="px-1 text-sm text-rose-400">{err}</p>}
        <button type="submit" disabled={busy || !username || !password}
          className="w-full rounded-2xl bg-yellow-400 px-4 py-3.5 font-semibold text-gray-950 shadow-lg shadow-yellow-400/20 transition active:scale-[0.98] hover:bg-yellow-300 disabled:opacity-40">
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

// ── Карточка заказа в ленте ─────────────────────────────────────────────────────
function OrderCard({ o, fresh, onOpen, onConfirm }: { o: AppOrder; fresh: boolean; onOpen: () => void; onConfirm?: () => void }) {
  const cfg = STATUS[o.status]
  const initial = (o.customer_name || '?').trim().charAt(0).toUpperCase()
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      aria-label={`Заказ ${o.order_number}, ${o.customer_name || 'клиент'}, ${fmtRub(o.total_amount)}, ${cfg?.label || o.status}`}
      className={`w-full cursor-pointer rounded-2xl border bg-white/[0.04] p-4 text-left transition-all duration-500 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${fresh ? 'border-yellow-400/50 bg-yellow-400/[0.07] shadow-lg shadow-yellow-400/10' : 'border-white/10 hover:border-white/20'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-bold tracking-tight text-yellow-400">{o.order_number}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {fresh && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />}{timeAgo(o.created_at)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(o.customer_name || '?')}`}>{initial}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{o.customer_name}</div>
          <div className="truncate text-xs text-slate-500">{o.shipping_city || '—'}{o.customer_phone ? ` · ${o.customer_phone}` : ''}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-white">{fmtRub(o.total_amount)}</div>
          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg?.pill || 'bg-slate-500/15 text-slate-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cfg?.dot || 'bg-slate-400'}`} />{cfg?.label || o.status}
          </span>
        </div>
      </div>
      {o.status === 'pending' && onConfirm && (
        <button onClick={(e) => { e.stopPropagation(); onConfirm() }} className="mt-3 w-full rounded-xl bg-emerald-500/15 py-2 text-sm font-semibold text-emerald-300 transition active:scale-[0.98] hover:bg-emerald-500/25">✓ Подтвердить</button>
      )}
    </div>
  )
}

// ── Детальный экран заказа (слайд-овер) ──────────────────────────────────────────
function OrderDetailSheet({ orderId, onClose, onStatusChange, onDeleted }: { orderId: string; onClose: () => void; onStatusChange: (id: string, s: string) => void; onDeleted: (id: string) => void }) {
  const { logout } = useAuth()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [images, setImages] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => { setShow(true); document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  const close = useCallback(() => { setShow(false); window.setTimeout(onClose, 250) }, [onClose])
  // Закрытие по Esc (доступность модального окна)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE_URL}/api/orders/${orderId}`, { headers: getAuthHeaders() })
      .then((r) => { if (r.status === 401) { logout(); throw new Error('401') } return r.ok ? r.json() : Promise.reject() })
      .then((d: OrderDetail) => {
        if (cancelled) return
        setOrder(d)
        for (const it of d.items || []) {
          if (!it.product_id) continue
          fetch(`${API_BASE_URL}/api/products/${it.product_id}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((p) => { if (p?.main_image_url && !cancelled) setImages((prev) => ({ ...prev, [it.product_id]: p.main_image_url })) })
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orderId, logout])

  const setStatus = async (s: string) => {
    if (!order || s === order.status || saving) return
    setSaving(true)
    try {
      const r = await fetch(`${API_BASE_URL}/api/orders/${order.id}/status`, { method: 'PATCH', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }) })
      if (r.ok) { setOrder({ ...order, status: s }); onStatusChange(order.id, s) }
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!order || deleting) return
    if (!window.confirm(`Удалить заказ ${order.order_number}? Это действие нельзя отменить.`)) return
    setDeleting(true)
    try {
      const r = await fetch(`${API_BASE_URL}/api/orders/${order.id}`, { method: 'DELETE', headers: getAuthHeaders() })
      if (r.status === 204 || r.ok) { onDeleted(order.id); close() }
      else if (r.status === 401) { logout() }
      else if (r.status === 409) { const d = await r.json().catch(() => ({} as { detail?: string })); alert(d.detail || 'Нельзя удалить заказ в этом статусе. Сначала отмените его (статус «Отменён»).') }
      else alert(`Не удалось удалить заказ (HTTP ${r.status}).`)
    } catch { alert('Ошибка сети при удалении.') }
    finally { setDeleting(false) }
  }

  const phone = order?.customer_phone || ''
  const fullAddress = order ? [order.shipping_postal_code, order.shipping_city, order.shipping_address].filter(Boolean).join(', ') : ''
  const flowIdx = order ? FLOW.indexOf(order.status as StatusKey) : -1

  return (
    <div className="fixed inset-0 z-50">
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
      <div role="dialog" aria-modal="true" aria-label={`Заказ ${order?.order_number || ''}`} className={`absolute inset-x-0 bottom-0 top-0 flex flex-col bg-slate-950 transition-transform duration-300 ease-out sm:left-1/2 sm:top-6 sm:bottom-6 sm:w-[440px] sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:border-white/10 ${show ? 'translate-y-0' : 'translate-y-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3" style={SAFE_TOP}>
          <button onClick={close} aria-label="Закрыть" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-lg text-slate-300 transition hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70">✕</button>
          <span className="font-mono text-sm font-bold text-yellow-400">{order?.order_number || '…'}</span>
          <span className="w-9" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4" style={SAFE_BOTTOM}>
          {loading && !order ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
          ) : !order ? (
            <div className="py-20 text-center text-slate-400">Не удалось загрузить заказ</div>
          ) : (
            <div className="space-y-5">
              {/* Status stepper */}
              <div>
                <div className="flex items-center">
                  {FLOW.map((s, i) => (
                    <div key={s} className="flex flex-1 items-center last:flex-none">
                      <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${i <= flowIdx ? 'bg-yellow-400 text-gray-950' : 'bg-white/10 text-slate-500'}`}>{i < flowIdx ? '✓' : i + 1}</span>
                      {i < FLOW.length - 1 && <span className={`h-0.5 flex-1 ${i < flowIdx ? 'bg-yellow-400' : 'bg-white/10'}`} />}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{fmtDateTime(order.created_at)}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[order.status]?.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS[order.status]?.dot}`} />{STATUS[order.status]?.label || order.status}
                  </span>
                </div>
              </div>

              {/* Customer */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white ${avatarColor(order.customer_name || '?')}`}>{(order.customer_name || '?').charAt(0).toUpperCase()}</span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white">{order.customer_name}</div>
                    <div className="text-xs text-slate-500">Клиент</div>
                  </div>
                </div>
                {phone && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5">
                    <span className="text-base">📞</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{phone}</span>
                    <a href={`tel:${phone}`} className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition active:scale-95 hover:bg-emerald-500/30">Позвонить</a>
                    <CopyBtn text={phone}>Копировать</CopyBtn>
                  </div>
                )}
                {order.customer_email && (
                  <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5">
                    <span className="text-base">✉️</span>
                    <a href={`mailto:${order.customer_email}`} className="min-w-0 flex-1 truncate text-sm text-sky-300 transition hover:underline">{order.customer_email}</a>
                    <CopyBtn text={order.customer_email}>Копировать</CopyBtn>
                  </div>
                )}
              </section>

              {/* Delivery */}
              {(order.shipping_address || order.shipping_city) && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Доставка</div>
                  <div className="text-sm text-white">{fullAddress}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <CopyBtn text={fullAddress}>📋 Скопировать адрес</CopyBtn>
                    <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition active:scale-95 hover:bg-white/10">🗺 На карте</a>
                  </div>
                </section>
              )}

              {/* Items */}
              <section>
                <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Состав · {order.items?.length || 0}</div>
                <div className="space-y-2">
                  {(order.items || []).map((it) => (
                    <div key={it.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      {images[it.product_id] ? (
                        <img src={images[it.product_id]} alt="" loading="lazy" className="h-12 w-12 flex-shrink-0 rounded-xl bg-white/5 object-contain" />
                      ) : (
                        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white/5 text-xl">📦</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm font-medium text-white">{it.product_name}</div>
                        <div className="text-xs text-slate-500">{it.quantity} × {fmtRub(it.unit_price)}{it.product_sku ? ` · ${it.product_sku}` : ''}</div>
                      </div>
                      <div className="text-sm font-semibold text-white">{fmtRub(it.total_price)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-2xl border border-yellow-400/20 bg-yellow-400/[0.07] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">Итого</span>
                    <span className="text-lg font-extrabold text-yellow-400">{fmtRub(order.total_amount)}</span>
                  </div>
                  {order.payment_status && (
                    <div className="mt-1 text-xs text-slate-400">Оплата: {PAYMENT[order.payment_status] || order.payment_status}</div>
                  )}
                </div>
              </section>

              {/* Notes */}
              {order.customer_note && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Комментарий клиента</div>
                  <div className="whitespace-pre-line text-sm text-slate-200">{order.customer_note}</div>
                </section>
              )}

              {/* Change status */}
              <section>
                <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Сменить статус {saving && '· сохраняю…'}</div>
                <div className="flex flex-wrap gap-2">
                  {ALL_STATUSES.map((s) => {
                    const active = order.status === s
                    return (
                      <button key={s} onClick={() => setStatus(s)} disabled={saving || active}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition active:scale-95 disabled:opacity-100 ${active ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS[s]?.dot}`} />{STATUS[s]?.label}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* Удаление заказа */}
              <section className="border-t border-white/10 pt-4">
                <button onClick={remove} disabled={deleting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 py-3 text-sm font-semibold text-rose-300 transition active:scale-[0.98] hover:bg-rose-500/20 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60">
                  {deleting ? 'Удаляю…' : '🗑 Удалить заказ'}
                </button>
                <p className="mt-2 px-1 text-[11px] text-slate-500">Заказы в обработке/отправленные/доставленные удалить нельзя — сначала отмените.</p>
              </section>
            </div>
          )}
        </div>

        {/* Sticky bottom actions */}
        {order && phone && (
          <div className="border-t border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur" style={SAFE_BOTTOM}>
            <div className="flex gap-2">
              <a href={`tel:${phone}`} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-yellow-400 px-4 py-3 font-semibold text-gray-950 transition active:scale-[0.98] hover:bg-yellow-300">📞 Позвонить</a>
              <CopyBtn text={phone} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3 font-semibold text-white transition active:scale-[0.98] hover:bg-white/15">📋 Скопировать</CopyBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function useNotifyPermission() {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported')
  const request = useCallback(async () => {
    if (!supported) { alert('Этот браузер не поддерживает уведомления.'); return }
    unlockAudio()
    const p = await Notification.requestPermission(); setPerm(p)
    if (p !== 'granted') {
      alert('Уведомления не разрешены.\n\nНа iPhone: открой сайт в Safari → «Поделиться» → «На экран Домой», затем запусти приложение С ИКОНКИ и включи уведомления (в обычной вкладке Safari iOS их не даёт).')
      return
    }
    // Подписку создаём ТОЛЬКО в установленном приложении — иначе вкладка Safari
    // и приложение дают ДВА уведомления на один заказ.
    if (!isStandalone()) {
      await unsubscribePush()
      playAlert()
      alert('Уведомления нужно включать в УСТАНОВЛЕННОМ приложении (иначе будут дубли):\n• iPhone: Safari → «Поделиться» → «На экран Домой», запусти С ИКОНКИ.\n• Mac: Safari → меню «Файл» → «Добавить в Dock».\nОткрой его и нажми «Включить» уже там.')
      return
    }
    const ok = await subscribeToPush()
    playAlert()
    if (ok) {
      await showOrderNotification('Уведомления включены', 'Будем присылать «У вас новый заказ!» — даже когда приложение закрыто.')
    } else {
      alert('Разрешение получено, но подписка не оформилась. Попробуй ещё раз нажать «Включить».')
    }
  }, [supported])
  return { perm, request }
}

// ── Лента ───────────────────────────────────────────────────────────────────────
interface PushResult { sent?: number; total?: number; pruned?: number; errors?: { status: number | null; detail?: string }[] }
// Человеческое объяснение кода ошибки push-сервиса (Apple/Mozilla/FCM).
function pushStatusHint(status: number | null): string {
  if (status === 403 || status === 401) return 'push-сервис отклонил подпись (403). Скорее всего, на сервере НЕ совпадают VAPID-ключи (public ≠ private) — нужно перегенерировать пару и заново задать оба ключа.'
  if (status === 400) return 'неверный запрос (400) — проблема с подпиской или ключами.'
  if (status === 410 || status === 404) return 'подписка устарела — нажми «Включить» заново.'
  if (status === 413) return 'уведомление слишком большое (413).'
  if (status === 429) return 'слишком часто (429) — попробуй позже.'
  if (typeof status === 'number' && status >= 500) return `push-сервис временно недоступен (${status}).`
  if (status === null) return 'нет ответа от push-сервиса (сетевая ошибка/таймаут).'
  return `код ${status}.`
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const seenIds = useRef<Set<string> | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem('takesmart_app_sound') !== '0' } catch { return true } })
  const soundOnRef = useRef(soundOn)
  useEffect(() => { soundOnRef.current = soundOn; try { localStorage.setItem('takesmart_app_sound', soundOn ? '1' : '0') } catch { /* */ } }, [soundOn])
  const [soundId, setSoundId] = useState<string>(() => getSoundId())
  useEffect(() => { try { localStorage.setItem('takesmart_app_sound_id', soundId) } catch { /* */ } ; void loadSound(soundId) }, [soundId])

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders?limit=50`, { headers: getAuthHeaders() })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const items: AppOrder[] = (Array.isArray(data) ? data : data.items ?? []).slice().sort((a: AppOrder, b: AppOrder) => +new Date(b.created_at) - +new Date(a.created_at))
      if (seenIds.current) {
        const fresh = items.filter((o) => !seenIds.current!.has(o.id))
        if (fresh.length) {
          if (soundOnRef.current) playAlert()
          setFreshIds((prev) => { const n = new Set(prev); fresh.forEach((o) => n.add(o.id)); return n })
          const ids = fresh.map((o) => o.id)
          window.setTimeout(() => setFreshIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n }), 8000)
          if (fresh.length === 1) void showOrderNotification(`Новый заказ ${fresh[0].order_number}`, `${fresh[0].customer_name} · ${fmtRub(fresh[0].total_amount)}`, fresh[0].order_number)
          else void showOrderNotification(`Новых заказов: ${fresh.length}`, 'Откройте приложение, чтобы посмотреть.')
        }
      }
      seenIds.current = new Set(items.map((o) => o.id))
      setOrders(items); setError(''); setUpdatedAt(new Date())
    } catch { setError('Не удалось обновить. Проверьте связь.') }
    finally { setLoading(false); setRefreshing(false) }
  }, [logout])

  useEffect(() => {
    load()
    const t = window.setInterval(() => load(), 20000)
    const onVis = () => { if (document.visibilityState === 'visible') { load(); syncPush() } }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  // Подписка живёт ТОЛЬКО в установленном приложении; в обычной вкладке Safari её
  // снимаем — иначе на один заказ приходят ДВА уведомления (вкладка + приложение).
  useEffect(() => { syncPush() }, [])

  const patchStatus = useCallback((id: string, s: string) => setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: s } : o))), [])

  const quickConfirm = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/orders/${id}/status`, { method: 'PATCH', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) })
      if (r.ok) setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'confirmed' } : o)))
    } catch { /* */ }
  }, [])

  const testPush = useCallback(async () => {
    unlockAudio()
    try {
      const r = await fetch(`${API_BASE_URL}/api/push/test`, { method: 'POST', headers: getAuthHeaders() })
      if (!r.ok) { alert(`Не удалось отправить тест (HTTP ${r.status}).`); return }
      const d = await r.json().catch(() => ({} as PushResult))
      const sent = d.sent ?? 0, total = d.total ?? 0, errors = d.errors ?? []
      if (total === 0) {
        alert('Нет активных подписок на этом устройстве.\n\nНажми «Включить» — на iPhone/Mac это нужно делать ВНУТРИ установленного приложения (с «Домой» / из Dock), не во вкладке браузера.')
        return
      }
      if (sent > 0) {
        alert(`Отправлено на ${sent} из ${total} устройств(а) ✅\n\nЕсли при ЗАКРЫТОМ приложении уведомление не появляется — проблема не на нашем сервере, а в системе: macOS должна быть Sonoma 14+ (на старее закрытому веб-приложению пуши не приходят); проверь Системные настройки → Уведомления для приложения и режим «Не беспокоить».`)
        return
      }
      const e = errors[0]
      alert(`Не доставлено (0 из ${total}).\n\nПричина: ${e ? pushStatusHint(e.status) : 'неизвестна'}${e?.detail ? `\n\nОтвет сервиса: ${e.detail}` : ''}`)
    } catch { alert('Ошибка сети при отправке теста.') }
  }, [])

  // Фоновый тест: сервер пришлёт пуш через ~10 секунд — чтобы проверить доставку
  // при ЗАКРЫТОМ приложении (закрой приложение сразу после нажатия).
  const testPushBackground = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/push/test?delay=10`, { method: 'POST', headers: getAuthHeaders() })
      if (!r.ok) { alert(`Не удалось запланировать тест (HTTP ${r.status}).`); return }
      const d = await r.json().catch(() => ({} as { total?: number }))
      if (typeof d.total === 'number' && d.total === 0) {
        alert('Нет активных подписок. Сначала нажми «Включить» (на iPhone/Mac — внутри установленного приложения).')
        return
      }
      alert('Тест запланирован через 10 секунд.\n\nСейчас ЗАКРОЙ приложение полностью — уведомление должно прийти при закрытом приложении.')
    } catch { alert('Ошибка сети при отправке теста.') }
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length }
    for (const f of FILTERS) if (f.statuses) c[f.key] = orders.filter((o) => f.statuses!.includes(o.status as StatusKey)).length
    return c
  }, [orders])
  const todayOrders = useMemo(() => orders.filter((o) => isToday(o.created_at)), [orders])
  const todayRevenue = useMemo(() => todayOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0), [todayOrders])
  const newCount = counts['pending'] ?? 0

  // Бейдж с числом новых заказов на иконке приложения (Dock/Домой) и в заголовке —
  // сразу видно, что есть необработанные заказы, даже не открывая ленту.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    try { if (newCount > 0) nav.setAppBadge?.(newCount); else nav.clearAppBadge?.() } catch { /* */ }
    document.title = newCount > 0 ? `(${newCount}) Заказы` : 'Заказы'
  }, [newCount])
  useEffect(() => () => {
    try { (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.() } catch { /* */ }
    document.title = 'TakeSmart'
  }, [])

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)
    let list = !f || !f.statuses ? orders : orders.filter((o) => f.statuses!.includes(o.status as StatusKey))
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((o) => [o.order_number, o.customer_name, o.customer_phone, o.shipping_city].some((v) => String(v ?? '').toLowerCase().includes(q)))
    return list
  }, [orders, filter, query])

  // Группируем отсортированную ленту по дням (Сегодня / Вчера / дата) — для разделителей.
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: AppOrder[] }[] = []
    for (const o of visible) {
      const key = dayKey(o.created_at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(o)
      else out.push({ key, label: dayLabel(o.created_at), items: [o] })
    }
    return out
  }, [visible])

  const removeOrder = useCallback((id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id))
    if (seenIds.current) seenIds.current.delete(id)
  }, [])

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white" style={SAFE_BOTTOM}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl" style={SAFE_TOP}>
        {refreshing && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r from-transparent via-yellow-400 to-transparent" />}
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/app-icon-192.png" alt="" className="h-9 w-9 rounded-xl ring-1 ring-white/10" />
            <div>
              <div className="text-[15px] font-bold leading-tight">Заказы</div>
              <div className="text-[11px] leading-tight text-slate-500">{updatedAt ? `обновлено ${updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'загрузка…'}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {perm === 'granted' && <span title="Уведомления включены" aria-label="Уведомления включены" className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">🔔</span>}
            <button onClick={() => load(true)} aria-label="Обновить" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70"><span className={refreshing ? 'inline-block animate-spin' : ''}>↻</span></button>
            <button onClick={() => setSettingsOpen((v) => !v)} aria-label="Настройки" aria-expanded={settingsOpen} className={`flex h-9 w-9 items-center justify-center rounded-xl transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 ${settingsOpen ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>⚙</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pt-4">
        {settingsOpen && (
          <div className="mb-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Настройки</div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white">Звук нового заказа</span>
              <button onClick={() => { unlockAudio(); setSoundOn((v) => !v) }} aria-label="Звук" className={`relative h-6 w-11 rounded-full transition ${soundOn ? 'bg-yellow-400' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${soundOn ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
            {soundOn && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-slate-500">Мелодия (нажми — прослушать). При закрытом приложении звук ставит сама система.</div>
                {SOUNDS.map((s) => {
                  const active = soundId === s.id
                  return (
                    <button key={s.id} onClick={() => { unlockAudio(); setSoundId(s.id); void playSound(s.id, false) }}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition active:scale-[0.99] ${active ? 'bg-yellow-400/15 text-yellow-100 ring-1 ring-inset ring-yellow-400/30' : 'bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'}`}>
                      <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs ${active ? 'bg-yellow-400 text-gray-950' : 'bg-white/10 text-slate-300'}`}>{active ? '✓' : '▶'}</span>
                      <span className="flex-1 text-left">{s.label}</span>
                      {active && <span className="text-[11px] text-yellow-200/70">выбрано</span>}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-sm text-white">Уведомления</span>
              {perm === 'granted'
                ? <div className="flex gap-1.5">
                    <button onClick={testPush} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/15">Тест</button>
                    <button onClick={testPushBackground} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/15">В фоне</button>
                  </div>
                : perm === 'denied'
                  ? <span className="text-xs text-rose-300">заблокированы</span>
                  : <button onClick={request} className="rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-gray-950 transition hover:bg-yellow-300">Включить</button>}
            </div>
            {perm === 'granted' && !isStandalone() && (
              <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-yellow-100/90">
                ⚠️ Чтобы уведомления приходили при <b>закрытом</b> приложении — установите его: iPhone «Поделиться → На экран Домой», Mac «Файл → Добавить в Dock», и запускайте с иконки.
              </div>
            )}
            <button onClick={logout} className="w-full rounded-xl bg-white/5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10">Выйти</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="relative overflow-hidden rounded-3xl border border-yellow-400/20 bg-gradient-to-br from-yellow-400/15 to-amber-500/5 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-yellow-200/70">Новые</div>
            <div className="mt-1 flex items-end gap-2"><span className="text-4xl font-extrabold leading-none text-white">{newCount}</span>{newCount > 0 && <span className="mb-1 h-2 w-2 animate-pulse rounded-full bg-yellow-400" />}</div>
            <div className="mt-1 text-xs text-slate-400">ждут обработки</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Сегодня</div>
            <div className="mt-1 text-4xl font-extrabold leading-none text-white">{todayOrders.length}</div>
            <div className="mt-1 truncate text-xs text-slate-400">на {fmtRub(todayRevenue)}</div>
          </div>
        </div>

        {perm === 'default' && !bannerDismissed && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-yellow-400/15 text-xl">🔔</span>
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">Включите уведомления</div><div className="text-xs text-slate-400">Чтобы не пропустить новый заказ</div></div>
            <button onClick={request} className="flex-shrink-0 rounded-xl bg-yellow-400 px-3 py-2 text-xs font-semibold text-gray-950 transition active:scale-95 hover:bg-yellow-300">Включить</button>
            <button onClick={() => setBannerDismissed(true)} aria-label="Скрыть" className="flex-shrink-0 text-slate-500 hover:text-slate-300">✕</button>
          </div>
        )}
        {perm === 'denied' && <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-xs text-rose-300">🔕 Уведомления заблокированы. Включите их в настройках браузера/системы.</div>}

        <div className="mt-4">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Поиск: номер, имя, телефон, город"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/50" />
        </div>

        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const active = filter === f.key; const n = counts[f.key]
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition active:scale-95 ${active ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                {f.label}{n !== undefined && <span className={`text-xs ${active ? 'text-gray-950/60' : 'text-slate-500'}`}>{n}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mx-auto max-w-xl space-y-6 px-4 pb-8 pt-3">
        {error && <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-sm text-rose-300">{error}</div>}
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
        ) : visible.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-14 text-center"><div className="mb-3 text-5xl">📭</div><div className="font-semibold text-white">{filter === 'all' ? 'Заказов пока нет' : 'Нет заказов в этом фильтре'}</div></div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{g.label}</h2>
                <span className="text-[11px] font-medium text-slate-600">{g.items.length}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              {g.items.map((o) => <OrderCard key={o.id} o={o} fresh={freshIds.has(o.id)} onOpen={() => setSelectedId(o.id)} onConfirm={() => quickConfirm(o.id)} />)}
            </section>
          ))
        )}
      </div>

      {selectedId && <OrderDetailSheet orderId={selectedId} onClose={() => setSelectedId(null)} onStatusChange={patchStatus} onDeleted={removeOrder} />}
    </div>
  )
}

// ── Нижний таб-бар PWA: «Заказы» + «Цены» ───────────────────────────────────────
type AppTab = 'orders' | 'prices'
const TAB_KEY = 'takesmart_app_tab'

function AppTabBar({ tab, onTab, pricesBadge }: { tab: AppTab; onTab: (t: AppTab) => void; pricesBadge: number }) {
  const tabs: { key: AppTab; icon: string; label: string }[] = [
    { key: 'orders', icon: '📦', label: 'Заказы' },
    { key: 'prices', icon: '🏷', label: 'Цены' },
  ]
  return (
    <nav aria-label="Разделы приложения" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/90 backdrop-blur-xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto grid max-w-xl grid-cols-2">
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => onTab(t.key)} aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 ${active ? 'text-yellow-400' : 'text-slate-500 hover:text-slate-300'}`}>
              <span className="relative text-xl leading-none">
                {t.icon}
                {t.key === 'prices' && pricesBadge > 0 && (
                  <span aria-label={`Несохранённых правок: ${pricesBadge}`} className="absolute -right-4 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-yellow-400 px-1 text-[10px] font-bold text-gray-950">
                    {pricesBadge > 99 ? '99+' : pricesBadge}
                  </span>
                )}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function OrdersAppPage() {
  const { isAuthenticated } = useAuth()
  usePwaSetup()
  const [tab, setTab] = useState<AppTab>(() => { try { return localStorage.getItem(TAB_KEY) === 'prices' ? 'prices' : 'orders' } catch { return 'orders' } })
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab) } catch { /* */ } }, [tab])
  // Панель цен маунтим при первом заходе и дальше не размонтируем: корзина правок и
  // загруженный каталог живут при переключении вкладок. Лента заказов смонтирована
  // ВСЕГДА (скрыта через display:none) — опрос заказов, звук и пуш-подписка
  // работают независимо от активной вкладки.
  const [pricesMounted, setPricesMounted] = useState(tab === 'prices')
  useEffect(() => { if (tab === 'prices') setPricesMounted(true) }, [tab])
  const [pricesDirty, setPricesDirty] = useState(0)

  if (!isAuthenticated) return <LoginScreen />
  return (
    <div className="min-h-[100dvh] bg-slate-950">
      <div className={tab === 'orders' ? 'pb-[calc(64px+env(safe-area-inset-bottom))]' : 'hidden'}><OrdersFeed /></div>
      {pricesMounted && (
        <div className={tab === 'prices' ? 'pb-[calc(64px+env(safe-area-inset-bottom))]' : 'hidden'}>
          <PricesPanel onDirtyChange={setPricesDirty} />
        </div>
      )}
      <AppTabBar tab={tab} onTab={setTab} pricesBadge={pricesDirty} />
    </div>
  )
}
