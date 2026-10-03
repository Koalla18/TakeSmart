import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { resolveApp } from '../../lib/appCatalog'
import {
  ORDER_STATUS, clock, errorText, orderPrice, orderUrl, rub,
  type CatalogApp, type InstallAccount, type InstallOrder, type InstallsConfig, type OrderMode, type OrderStats,
} from '../../lib/installs'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { pluralRu, timeAgo } from './format'
import { AppIcon, BTN_ROW, CARD, INPUT, LABEL, Modal, QrCode, Toggle } from './installsUi'
import { call, copyText, type Api } from './installsApi'

// ─────────────────────────────────────────────────────────────────────────────
// «Приложения на iPhone», схема «аккаунт салона».
// Приложения, которых больше нет в App Store, лежат в истории покупок Apple ID
// салона. Сотрудник оформляет заказ, на телефоне покупателя в «Контент и покупки»
// вводится этот Apple ID, приложения скачиваются из истории покупок, после чего
// покупатель возвращает свой аккаунт. Страница заказа /i/<ключ> ведёт по шагам.
// Пароль Apple ID салона здесь нигде не вводится и не хранится.
// ─────────────────────────────────────────────────────────────────────────────

const MODE_LABEL: Record<OrderMode, string> = { staff: 'В салоне', self: 'Удалённо' }
const appsWord = (n: number) => pluralRu(n, 'приложение', 'приложения', 'приложений')
const viewOf = (a: { name: string; title?: string | null; bundle_id: string; icon_url?: string | null; genre?: string | null }) =>
  resolveApp({ name: a.title || a.name, bundle_id: a.bundle_id, icon: a.icon_url, genre: a.genre })

function StatusBadge({ order }: { order: Pick<InstallOrder, 'status'> }) {
  const m = ORDER_STATUS[order.status]
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.dark}`}>{m.label}</span>
}

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-sm transition ${active ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>{children}</button>
  )
}

/** Текущее время, обновляется раз в секунду: таймеры тикают между опросами сервера. */
function useNow(): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

// ═════════════════════════════════════════════════════════════════════════════
// Новый заказ
// ═════════════════════════════════════════════════════════════════════════════

export function NewOrderTab({ api, accounts, catalog, config, onCreated, goCatalog }: {
  api: Api; accounts: InstallAccount[]; catalog: CatalogApp[]; config: InstallsConfig
  onCreated: (order: InstallOrder) => void; goCatalog: () => void
}) {
  const liveAccounts = useMemo(() => accounts.filter(a => a.is_active && catalog.some(c => c.account_id === a.id && c.is_active)), [accounts, catalog])
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = liveAccounts.find(a => a.id === accountId) || liveAccounts[0] || null
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'bank'>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<OrderMode>('staff')
  const [paid, setPaid] = useState(true)
  const [priceText, setPriceText] = useState('')
  const [saving, setSaving] = useState(false)

  const apps = useMemo(() => (account ? catalog.filter(c => c.account_id === account.id && c.is_active).map(c => ({ c, r: viewOf(c) })) : []), [catalog, account])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return apps.filter(({ c, r }) => (!needle || `${r.name} ${c.name} ${c.bundle_id}`.toLowerCase().includes(needle)) && (filter === 'all' || r.bank))
  }, [apps, q, filter])
  // Выбранное из другого аккаунта или скрытое из каталога в заказ не попадает
  const chosen = useMemo(() => picked.map(id => apps.find(a => a.c.id === id)).filter((a): a is NonNullable<typeof a> => Boolean(a)), [picked, apps])

  const auto = orderPrice(config, chosen.length)
  const custom = priceText.trim() === '' ? null : Number(priceText.replace(/\s/g, ''))
  const priceBad = custom !== null && (!Number.isFinite(custom) || custom < 0 || !Number.isInteger(custom))
  const total = custom !== null && !priceBad ? custom : auto
  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const remove = (id: string) => setPicked(prev => prev.filter(x => x !== id))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chosen.length || priceBad || saving) return
    setSaving(true)
    const order = await call<InstallOrder>(api, '/orders', {
      method: 'POST',
      body: { app_ids: chosen.map(a => a.c.id), mode, customer_name: name.trim() || null, customer_phone: phone.trim() || null, note: note.trim() || null, paid, ...(custom !== null ? { price: custom } : {}) },
    })
    setSaving(false)
    if (!order) return
    setPicked([]); setName(''); setPhone(''); setNote(''); setPriceText(''); setQ('')
    toast(`Заказ №${order.number} оформлен`, 'success')
    onCreated(order)
  }

  if (!liveAccounts.length) {
    return (
      <div className={`${CARD} mx-auto max-w-2xl text-center`} data-new-order-empty>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-400/15 text-yellow-300"><AdminIcon name="layers" className="h-6 w-6" /></span>
        <div className="mt-3 text-lg font-semibold text-white">Каталог пока пуст</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">Добавьте Apple ID салона и отметьте, какие приложения из его истории покупок вы ставите покупателям. После этого здесь появятся плитки приложений.</p>
        <button type="button" onClick={goCatalog} className={`${BTN_PRIMARY} mt-4`} data-go-catalog>Настроить каталог</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[1fr_360px]" data-new-order>
      <div className={`${CARD} min-w-0`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className={LABEL}>Что поставить <span className="font-normal normal-case tracking-normal text-slate-500">· {visible.length} из {apps.length}</span></div>
          {liveAccounts.length > 1 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              Аккаунт:
              {liveAccounts.map(a => <Chip key={a.id} active={a.id === account?.id} onClick={() => setAccountId(a.id)}>{a.label}</Chip>)}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Поиск: Сбер, Т-Банк, ВТБ…" data-order-search className={`${INPUT} sm:max-w-xs`} />
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Все</Chip>
          <Chip active={filter === 'bank'} onClick={() => setFilter('bank')}>Банки</Chip>
        </div>
        <div className="mt-3 max-h-[64vh] overflow-auto pr-1">
          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">Ничего не найдено. Нужного приложения нет в каталоге? Добавьте его во вкладке «Каталог».</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {visible.map(({ c, r }) => {
                const on = picked.includes(c.id)
                return (
                  <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={on} data-catalog-tile={c.bundle_id} data-selected={on ? '1' : '0'}
                    className={`flex w-full min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-yellow-400/70 bg-yellow-400/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'}`}>
                    <AppIcon app={r} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-white">{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">{c.version ? `версия ${c.version}` : c.bundle_id}</span>
                    </span>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${on ? 'border-yellow-400 bg-yellow-400 text-slate-950' : 'border-white/20 text-transparent'}`}><AdminIcon name="check" className="h-3.5 w-3.5" /></span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className={`${CARD} h-fit lg:sticky lg:top-4`} data-order-summary>
        <div className={LABEL}>Заказ</div>
        {chosen.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Отметьте приложения слева. {rub(config.price)} за приложение, от {config.bulk_min} шт. — по {rub(config.bulk_price)}.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {chosen.map(({ c, r }) => (
              <li key={c.id} className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-2.5 py-1.5 text-sm">
                <AppIcon app={r} size={28} />
                <span className="min-w-0 flex-1 truncate text-white">{r.name}</span>
                <button type="button" onClick={() => remove(c.id)} aria-label={`Убрать ${r.name}`} className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-white"><AdminIcon name="x" className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-sm text-slate-400">{chosen.length ? `${chosen.length} × ${rub(chosen.length >= config.bulk_min ? config.bulk_price : config.price)}` : 'Итого'}</span>
          <span className="text-2xl font-bold tabular-nums text-white" data-order-total>{rub(total)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1">
          {(['staff', 'self'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} data-mode={m}
              className={`rounded-lg px-2 py-2 text-sm font-medium transition ${mode === m ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-slate-200'}`}>{MODE_LABEL[m]}</button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{mode === 'staff'
          ? 'Телефон покупателя у вас в руках: вы вводите Apple ID салона и ставите приложения.'
          : 'Покупатель делает всё сам по ссылке. Пароль вы сообщаете ему сами, код передаёте через карточку заказа.'}</p>
        <div className="mt-3 space-y-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя покупателя (необязательно)" maxLength={120} className={INPUT} data-order-name />
          <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="Телефон (необязательно)" maxLength={32} className={INPUT} data-order-phone />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Пометка для себя" maxLength={300} className={INPUT} />
          <div className="flex items-center gap-2">
            <input value={priceText} onChange={e => setPriceText(e.target.value)} inputMode="numeric" placeholder={`Своя сумма (по умолчанию ${auto.toLocaleString('ru-RU')})`} className={`${INPUT} ${priceBad ? 'border-red-400/60' : ''}`} data-order-price />
          </div>
          {priceBad && <p className="text-xs text-red-300">Сумма — целое число рублей</p>}
        </div>
        <div className="mt-3"><Toggle checked={paid} onChange={setPaid} label="Оплата получена" hint="Выключите, если покупатель заплатит позже" /></div>
        <button type="submit" disabled={!chosen.length || priceBad || saving} className={`${BTN_PRIMARY} mt-4 w-full justify-center`} data-create-order>
          <AdminIcon name="check" className="h-4 w-4" />{saving ? 'Оформляем…' : chosen.length ? `Оформить · ${chosen.length} ${appsWord(chosen.length)}` : 'Оформить заказ'}
        </button>
        {account && <p className="mt-2 text-xs text-slate-500">Аккаунт: {account.label} · {account.apple_id}</p>}
      </div>
    </form>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Заказы
// ═════════════════════════════════════════════════════════════════════════════

export function OrdersTab({ orders, stats, onOpen, goNew }: {
  orders: InstallOrder[] | null; stats: OrderStats | null; onOpen: (id: string) => void; goNew: () => void
}) {
  const [scope, setScope] = useState<'open' | 'all'>('open')
  const [q, setQ] = useState('')
  const openCount = (orders || []).filter(o => o.status === 'new' || o.status === 'ready' || o.status === 'active').length
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (orders || []).filter(o => {
      if (scope === 'open' && !['new', 'ready', 'active'].includes(o.status)) return false
      if (!needle) return true
      return `${o.number} ${o.customer_name || ''} ${o.customer_phone || ''} ${o.apps.map(a => a.name).join(' ')}`.toLowerCase().includes(needle)
    })
  }, [orders, scope, q])

  return (
    <div data-orders-tab>
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            ['Сегодня', `${stats.orders_today} ${pluralRu(stats.orders_today, 'заказ', 'заказа', 'заказов')}`, rub(stats.revenue_today)],
            ['За месяц', `${stats.orders_month} ${pluralRu(stats.orders_month, 'заказ', 'заказа', 'заказов')}`, rub(stats.revenue_month)],
            ['Установлено за месяц', `${stats.apps_month}`, appsWord(stats.apps_month)],
            ['Сейчас', `${stats.active} в работе`, stats.waiting ? `${stats.waiting} ${pluralRu(stats.waiting, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} подтверждения` : 'новых заявок нет'],
          ] as const).map(([label, main, sub]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="mt-0.5 text-lg font-semibold text-white">{main}</div>
              <div className="text-xs text-slate-400">{sub}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip active={scope === 'open'} onClick={() => setScope('open')} testId="scope-open">Открытые · {openCount}</Chip>
        <Chip active={scope === 'all'} onClick={() => setScope('all')} testId="scope-all">Все · {(orders || []).length}</Chip>
        <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Номер, имя, телефон, приложение" className={`${INPUT} sm:ml-auto sm:max-w-xs`} />
      </div>
      {orders === null ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-white/[0.05]" />)}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
          {orders.length === 0 ? 'Заказов пока нет.' : scope === 'open' ? 'Открытых заказов нет.' : 'Ничего не найдено.'}
          <div className="mt-3"><button type="button" onClick={goNew} className={BTN_SECONDARY}><AdminIcon name="plus" className="h-4 w-4" />Новый заказ</button></div>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map(o => {
            const done = o.apps.filter(a => a.status === 'installed').length
            return (
              <li key={o.id}>
                <button type="button" onClick={() => onOpen(o.id)} data-order-row={o.number} data-status={o.status}
                  className={`flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 text-left transition hover:bg-white/[0.06] ${o.code_waiting ? 'border-yellow-400/60 bg-yellow-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}>
                  <span className="w-16 shrink-0 text-lg font-semibold tabular-nums text-white">№{o.number}</span>
                  <span className="flex shrink-0 -space-x-1.5">
                    {o.apps.slice(0, 5).map(a => <span key={a.key} className="rounded-[9px] ring-2 ring-slate-900"><AppIcon app={viewOf(a)} size={30} /></span>)}
                    {o.apps.length > 5 && <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-white/10 text-xs text-slate-300 ring-2 ring-slate-900">+{o.apps.length - 5}</span>}
                  </span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-sm text-white">{o.apps.map(a => a.name).join(', ')}</span>
                    <span className="block truncate text-xs text-slate-500">{[o.customer_name, o.customer_phone].filter(Boolean).join(' · ') || 'без имени'} · {MODE_LABEL[o.mode]}{o.source === 'site' ? ' · с сайта' : ''} · {timeAgo(o.created_at)}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {o.code_waiting && <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-semibold text-slate-950" data-code-waiting><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-950" />Ждёт код</span>}
                    <StatusBadge order={o} />
                    {o.status === 'active' && o.seconds_left !== null && <span className="text-xs tabular-nums text-slate-400">{clock(o.seconds_left)}</span>}
                  </span>
                  <span className="w-24 shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums text-white">{rub(o.price)}</span>
                    <span className={`block text-xs ${o.paid_at ? 'text-slate-500' : 'text-yellow-300'}`}>{o.paid_at ? `${done} из ${o.apps.length}` : 'не оплачен'}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Карточка заказа ──────────────────────────────────────────────────────────

export function OrderCard({ api, orderId, onClose, onCable, onChanged }: {
  api: Api; orderId: string; onClose: () => void; onCable: (order: InstallOrder) => void; onChanged: () => void
}) {
  const [order, setOrderState] = useState<InstallOrder | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [missing, setMissing] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const wasWaiting = useRef(false)
  const now = useNow()
  const setOrder = useCallback((o: InstallOrder) => { setOrderState(o); setLoadedAt(Date.now()) }, [])

  // Покупатель сам меняет заказ со своей страницы (начал, завершил, попросил код) — обновляем и список
  const lastSeen = useRef<string | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await api(`/orders/${orderId}`)
      if (r.status === 404) { setMissing(true); return }
      if (!r.ok) return
      const o: InstallOrder = await r.json()
      const sig = `${o.status}|${o.code_waiting}|${o.apps.map(a => a.status).join(',')}`
      if (lastSeen.current !== null && lastSeen.current !== sig) onChanged()
      lastSeen.current = sig
      setOrder(o)
    } catch { /* сеть: покажем прошлое состояние */ }
  }, [api, orderId, setOrder, onChanged])
  useEffect(() => {
    const first = window.setTimeout(load, 0)
    const id = window.setInterval(load, 2000)
    return () => { window.clearTimeout(first); window.clearInterval(id) }
  }, [load])
  // Покупатель попросил код — ставим курсор в поле, чтобы сразу вводить
  useEffect(() => {
    const waiting = Boolean(order?.code_waiting)
    if (waiting && !wasWaiting.current) codeInput.current?.focus()
    wasWaiting.current = waiting
  }, [order?.code_waiting])
  const elapsed = Math.max(0, (now - loadedAt) / 1000)
  const left = order?.seconds_left != null ? Math.max(0, Math.round(order.seconds_left - elapsed)) : null

  const act = async (action: string, extra: Record<string, unknown> = {}, okMsg?: string) => {
    setBusy(action)
    const next = await call<InstallOrder>(api, `/orders/${orderId}/action`, { method: 'POST', body: { action, ...extra } })
    setBusy(null)
    if (next) { setOrder(next); onChanged(); if (okMsg) toast(okMsg, 'success') }
  }
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) { toast('Код подтверждения — 6 цифр', 'error'); return }
    setBusy('code')
    const next = await call<InstallOrder>(api, `/orders/${orderId}/code`, { method: 'POST', body: { code: digits } })
    setBusy(null)
    if (next) { setOrder(next); setCode(''); onChanged(); toast('Код передан покупателю', 'success') }
  }
  const markApp = async (key: string, installed: boolean) => {
    const next = await call<InstallOrder>(api, `/orders/${orderId}/apps/${key}`, { method: 'PATCH', body: { status: installed ? 'installed' : 'pending' } })
    if (next) { setOrder(next); onChanged() }
  }
  const remove = async () => {
    if (!order || !(await confirmDialog({ title: `Удалить заказ №${order.number}?`, message: 'Заказ исчезнет из списка и из сводки. Ссылка покупателя перестанет открываться.', confirmLabel: 'Удалить', danger: true }))) return
    if (await call(api, `/orders/${orderId}`, { method: 'DELETE' })) { toast('Заказ удалён', 'success'); onChanged(); onClose() }
  }
  const cancel = async () => {
    if (!order || !(await confirmDialog({ title: `Отменить заказ №${order.number}?`, message: 'Покупатель увидит на своей странице, что заказ отменён.', confirmLabel: 'Отменить заказ', danger: true }))) return
    act('cancel', {}, 'Заказ отменён')
  }

  if (missing) return <Modal title="Заказ не найден" onClose={onClose}><p className="text-sm text-slate-400">Возможно, его удалили.</p></Modal>
  if (!order) return <Modal title="Заказ" onClose={onClose}><div className="h-40 animate-pulse rounded-xl bg-white/[0.05]" /></Modal>

  const url = orderUrl(order.token)
  const installed = order.apps.filter(a => a.status === 'installed').length
  const open = order.status === 'new' || order.status === 'ready' || order.status === 'active'
  const codeAge = order.code_delivered_at && now ? Math.max(0, Math.round((now - new Date(order.code_delivered_at).getTime()) / 1000)) : null

  return (
    <Modal title={`Заказ №${order.number}`} onClose={onClose} wide>
      <div data-order-card={order.number} data-status={order.status}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <StatusBadge order={order} />
          {order.status === 'active' && left !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${left < 300 ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-slate-300'}`} data-order-timer>осталось {clock(left)}</span>}
          <span className="font-semibold text-white">{rub(order.price)}</span>
          <span className={order.paid_at ? 'text-emerald-300' : 'text-yellow-300'}>{order.paid_at ? 'оплачен' : 'не оплачен'}</span>
          <span className="text-slate-500">· {[order.customer_name, order.customer_phone].filter(Boolean).join(' · ') || 'без имени'}</span>
          <span className="text-slate-500">· {order.source === 'site' ? 'заявка с сайта' : `оформил ${order.created_by || 'сотрудник'}`} {timeAgo(order.created_at)}</span>
        </div>
        {order.note && <p className="mt-1 text-sm text-slate-400">Пометка: {order.note}</p>}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className={LABEL}>Страница заказа для покупателя</div>
              <div className="mt-3 flex items-start gap-4">
                <QrCode value={url} size={132} />
                <div className="min-w-0 text-sm text-slate-300">
                  Наведите камеру iPhone покупателя на код — в Safari откроется страница с шагами и списком приложений.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => copyText(url, 'Ссылка скопирована')} className={BTN_ROW} data-copy-link>Скопировать ссылку</button>
                    <a href={url} target="_blank" rel="noreferrer" className={BTN_ROW}>Открыть</a>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1">
                {(['staff', 'self'] as const).map(m => (
                  <button key={m} type="button" disabled={!open} onClick={() => order.mode !== m && act('set_mode', { mode: m })} aria-pressed={order.mode === m}
                    className={`rounded-lg px-2 py-1.5 text-sm font-medium transition disabled:opacity-50 ${order.mode === m ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-slate-200'}`}>{MODE_LABEL[m]}</button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className={LABEL}>Apple ID салона</div>
              {order.apple_id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-mono text-[15px] text-white" data-order-apple-id>{order.apple_id}</span>
                  <button type="button" onClick={() => copyText(order.apple_id || '', 'Apple ID скопирован')} className={BTN_ROW}>Скопировать</button>
                </div>
              ) : <p className="mt-2 text-sm text-yellow-200">Аккаунт этого заказа удалён ({order.account_label || 'без названия'}).</p>}
              <p className="mt-2 text-xs text-slate-500">Пароль вводите сами. На сайте и на сервере его нет — странице заказа он неизвестен.</p>
            </div>
          </div>

          <div className="space-y-4">
            <form onSubmit={sendCode} className={`rounded-2xl border p-4 ${order.code_waiting ? 'border-yellow-400/60 bg-yellow-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`} data-code-box data-waiting={order.code_waiting ? '1' : '0'}>
              <div className={LABEL}>Код подтверждения</div>
              {order.status !== 'active' ? (
                <p className="mt-2 text-sm text-slate-400">Код передаётся покупателю, пока идёт установка. {order.status === 'ready' || order.status === 'new' ? 'Нажмите «Начать установку».' : order.status === 'expired' ? 'Время вышло — продлите заказ.' : ''}</p>
              ) : (
                <>
                  {order.code_waiting
                    ? <p className="mt-2 flex items-center gap-2 text-sm font-medium text-yellow-200"><span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />Покупатель ждёт код{order.code_requested_at ? ` · ${timeAgo(order.code_requested_at)}` : ''}</p>
                    : order.code_value
                      ? <p className="mt-2 text-sm text-emerald-300">Передан: <b className="font-mono tracking-widest">{order.code_value}</b>{codeAge !== null ? ` · ${codeAge} с назад` : ''}</p>
                      : <p className="mt-2 text-sm text-slate-400">Покупатель попросит код кнопкой на своей странице — здесь появится сигнал.</p>}
                  <div className="mt-3 flex gap-2">
                    <input ref={codeInput} value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="6 цифр" maxLength={8} className={`${INPUT} font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal`} data-code-input />
                    <button type="submit" disabled={busy === 'code' || code.replace(/\D/g, '').length !== 6} className={`${BTN_PRIMARY} shrink-0`} data-code-send>Передать</button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Где взять код: на устройстве салона, где выполнен вход в этот Apple ID, появится окно с кодом. Или «Настройки» → имя → «Вход и безопасность» → «Получить код проверки».</p>
                </>
              )}
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                Запросов кода: {order.code_requests} из {order.code_limit}
                {order.code_requests > 0 && open && <button type="button" onClick={() => act('reset_codes', {}, 'Счётчик сброшен')} className="text-slate-300 underline decoration-dotted hover:text-white">сбросить</button>}
              </div>
            </form>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className={LABEL}>Приложения <span className="font-normal normal-case tracking-normal text-slate-500">· установлено {installed} из {order.apps.length}</span></div>
              <ul className="mt-2 space-y-1.5">
                {order.apps.map(a => {
                  const on = a.status === 'installed'
                  return (
                    <li key={a.key}>
                      <button type="button" disabled={order.status === 'cancelled'} onClick={() => markApp(a.key, !on)} aria-pressed={on} data-order-app={a.bundle_id} data-installed={on ? '1' : '0'}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition disabled:opacity-60 ${on ? 'bg-emerald-500/[0.08]' : 'bg-white/[0.04] hover:bg-white/[0.07]'}`}>
                        <AppIcon app={viewOf(a)} size={32} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-white">{a.name}</span>{a.version ? <span className="block text-xs text-slate-500">версия {a.version}</span> : null}</span>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${on ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-white/20 text-transparent'}`}><AdminIcon name="check" className="h-3.5 w-3.5" /></span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2" data-order-actions>
          {(order.status === 'ready' || order.status === 'new') && <button type="button" disabled={busy !== null} onClick={() => act('start', {}, 'Установка начата')} className={BTN_PRIMARY} data-act="start"><AdminIcon name="zap" className="h-4 w-4" />Начать установку</button>}
          {order.status === 'active' && <button type="button" disabled={busy !== null} onClick={() => act('done', {}, 'Заказ закрыт')} className={BTN_PRIMARY} data-act="done"><AdminIcon name="check" className="h-4 w-4" />Завершить</button>}
          {!order.paid_at && order.status !== 'cancelled' && <button type="button" disabled={busy !== null} onClick={() => act('confirm_payment', {}, 'Оплата отмечена')} className={BTN_SECONDARY} data-act="confirm_payment">Оплата получена</button>}
          {(order.status === 'active' || order.status === 'expired') && <button type="button" disabled={busy !== null} onClick={() => act('extend', { minutes: 30 }, 'Продлено на 30 минут')} className={BTN_SECONDARY} data-act="extend">Продлить на 30 мин</button>}
          {order.status === 'expired' && <button type="button" disabled={busy !== null} onClick={() => act('done', {}, 'Заказ закрыт')} className={BTN_SECONDARY}>Завершить</button>}
          {open && <button type="button" onClick={() => onCable(order)} className={BTN_SECONDARY} data-act="cable">Поставить по кабелю</button>}
          {(order.status === 'done' || order.status === 'cancelled') && <button type="button" disabled={busy !== null} onClick={() => act('reopen', {}, 'Заказ открыт заново')} className={BTN_SECONDARY} data-act="reopen">Открыть заново</button>}
          <span className="ml-auto flex gap-2">
            {open && <button type="button" onClick={cancel} className={`${BTN_ROW} text-red-300`} data-act="cancel">Отменить</button>}
            {!open && <button type="button" onClick={remove} className={`${BTN_ROW} text-red-300`} data-act="delete">Удалить</button>}
          </span>
        </div>
        {order.rating !== null && <p className="mt-3 text-sm text-slate-300">Оценка покупателя: {'★'.repeat(order.rating)}{'☆'.repeat(5 - order.rating)}{order.feedback ? ` — «${order.feedback}»` : ''}</p>}

        {order.events.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-slate-500">Журнал заказа · {order.events.length}</summary>
            <div className="mt-2 max-h-44 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-slate-400">
              {order.events.map((ev, i) => <div key={i}>{new Date(ev.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {ev.who === 'customer' ? 'покупатель' : ev.who === 'admin' ? 'сотрудник' : 'система'} · {ev.msg}</div>)}
            </div>
          </details>
        )}
      </div>
    </Modal>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Каталог и аккаунты
// ═════════════════════════════════════════════════════════════════════════════

interface StationLite { id: string; name: string; online: boolean; state: { apple?: { logged_in?: boolean; email?: string | null; purchases_count?: number | null } | null } }
type CatalogFilter = 'all' | 'shown' | 'hidden' | 'removed' | 'bank'
const PAGE = 120

function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 2)}***@${domain}` : email
}

export function CatalogTab({ api, accounts, catalog, config, reload, goCable }: {
  api: Api; accounts: InstallAccount[]; catalog: CatalogApp[]; config: InstallsConfig; reload: () => Promise<void>; goCable: () => void
}) {
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = accounts.find(a => a.id === accountId) || accounts[0] || null
  const [stations, setStations] = useState<StationLite[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [shown, setShown] = useState(PAGE)
  const [editing, setEditing] = useState<CatalogApp | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => { try { const r = await api('/stations'); if (r.ok && alive) setStations(await r.json()) } catch { /* сеть */ } }
    load()
    const id = window.setInterval(load, 3000)
    return () => { alive = false; window.clearInterval(id) }
  }, [api])

  const station = stations.find(s => s.online && s.state?.apple?.logged_in) || null
  const rows = useMemo(() => (account ? catalog.filter(c => c.account_id === account.id).map(c => ({ c, r: viewOf(c) })) : []), [catalog, account])
  const counts = useMemo(() => ({
    all: rows.length, shown: rows.filter(x => x.c.is_active).length, hidden: rows.filter(x => !x.c.is_active).length,
    removed: rows.filter(x => x.c.in_store === false).length, bank: rows.filter(x => x.r.bank).length,
  }), [rows])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(({ c, r }) => {
      if (needle && !`${r.name} ${c.name} ${c.bundle_id}`.toLowerCase().includes(needle)) return false
      if (filter === 'shown') return c.is_active
      if (filter === 'hidden') return !c.is_active
      if (filter === 'removed') return c.in_store === false
      if (filter === 'bank') return r.bank
      return true
    })
  }, [rows, q, filter])
  const hiddenInView = visible.filter(x => !x.c.is_active)
  const shownInView = visible.filter(x => x.c.is_active)

  const checkStore = async (silent = false) => {
    if (!account) return
    setBusy('check')
    const res = await call<{ checked: number; in_store: number; removed: number; failed: number }>(api, '/catalog/check-store', { method: 'POST', body: { account_id: account.id } })
    setBusy(null)
    if (!res) return
    await reload()
    if (!silent || res.failed) toast(`Сверили с App Store: ${res.in_store} есть, ${res.removed} нет${res.failed ? `, ${res.failed} проверить не удалось` : ''}`, res.failed ? 'info' : 'success')
  }
  const runImport = async (force = false) => {
    if (!account || !station) return
    setBusy('import')
    try {
      const res = await api(`/accounts/${account.id}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: station.id, force }) })
      if (res.status === 409) {
        const d = await res.clone().json().catch(() => null)
        if (d?.detail?.code === 'account_mismatch') {
          setBusy(null)
          if (await confirmDialog({ title: 'На помощнике другой Apple ID', message: `${d.detail.message}\n\nЗаполнить каталог из его истории покупок всё равно?`, confirmLabel: 'Заполнить' })) runImport(true)
          return
        }
      }
      if (!res.ok) { toast(await errorText(res), 'error'); setBusy(null); return }
      const out: { total: number; created: number; updated: number } = await res.json()
      toast(`История покупок прочитана: ${out.total}. Новых в каталоге: ${out.created}`, 'success')
      await reload()
      setBusy(null)
      await checkStore(true)
      setFilter(out.created ? 'removed' : 'all'); setShown(PAGE)
    } catch { toast('Нет связи с сервером', 'error'); setBusy(null) }
  }
  const bulk = async (ids: string[], isActive: boolean) => {
    if (!ids.length) return
    setBusy('bulk')
    const res = await call<{ changed: number }>(api, '/catalog/bulk', { method: 'POST', body: { ids, is_active: isActive } })
    setBusy(null)
    if (res) { await reload(); toast(isActive ? `В каталоге теперь ещё ${res.changed}` : `Скрыто: ${res.changed}`, 'success') }
  }
  const setActive = async (app: CatalogApp, isActive: boolean) => { if (await call(api, `/catalog/${app.id}`, { method: 'PATCH', body: { is_active: isActive } })) reload() }
  const removeApp = async (app: CatalogApp) => {
    if (!(await confirmDialog({ title: `Убрать «${app.title || app.name}» из каталога?`, message: 'Запись удалится из списка. При следующем чтении истории покупок приложение появится снова — скрытым.', confirmLabel: 'Убрать', danger: true }))) return
    if (await call(api, `/catalog/${app.id}`, { method: 'DELETE' })) { toast('Убрано', 'success'); reload() }
  }
  const removeAccount = async (a: InstallAccount) => {
    if (!(await confirmDialog({ title: `Удалить аккаунт «${a.label}»?`, message: `Вместе с ним удалится его каталог (${a.apps_total}). Закрытые заказы останутся в истории.`, confirmLabel: 'Удалить', danger: true }))) return
    if (await call(api, `/accounts/${a.id}`, { method: 'DELETE' })) { toast('Аккаунт удалён', 'success'); setAccountId(null); reload() }
  }
  const toggleAccount = async (a: InstallAccount) => { if (await call(api, `/accounts/${a.id}`, { method: 'PATCH', body: { is_active: !a.is_active } })) reload() }

  const stationMatches = Boolean(account && station && (station.state.apple?.email || '').toLowerCase() === maskEmail(account.apple_id).toLowerCase())

  return (
    <div className="space-y-6" data-catalog-tab>
      <Memo open={accounts.length === 0} />

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Apple ID салона</h3>
          <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_ROW} ml-auto`} data-add-account><span className="inline-flex items-center gap-1.5"><AdminIcon name="plus" className="h-4 w-4" />Добавить аккаунт</span></button>
        </div>
        {accounts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
            Пока ни одного. Нужен Apple ID, в истории покупок которого есть приложения, пропавшие из App Store: банки, авиакомпании, маркетплейсы.
            <div className="mt-3"><button type="button" onClick={() => setAddOpen(true)} className={BTN_PRIMARY}>Добавить Apple ID салона</button></div>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {accounts.map(a => (
              <li key={a.id} data-account={a.apple_id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${a.id === account?.id ? 'border-yellow-400/50 bg-yellow-400/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
                <button type="button" onClick={() => { setAccountId(a.id); setShown(PAGE) }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium text-white">{a.label}{!a.is_active && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-slate-400">выключен</span>}</span>
                  <span className="block truncate text-sm text-slate-400">{a.apple_id}</span>
                  <span className="block text-xs text-slate-500">в каталоге {a.apps_active} из {a.apps_total}</span>
                </button>
                <button type="button" onClick={() => toggleAccount(a)} className={BTN_ROW}>{a.is_active ? 'Выключить' : 'Включить'}</button>
                <button type="button" onClick={() => removeAccount(a)} aria-label={`Удалить ${a.label}`} className={`${BTN_ROW} text-red-300`}><AdminIcon name="trash" className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {account && (
        <section data-catalog-of={account.apple_id}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Каталог · {account.label}</h3>
            <span className="text-xs text-slate-500">в каталоге {counts.shown} из {counts.all}</span>
          </div>

          <div className={`${CARD} mb-3`} data-import-box>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 basis-64 text-sm">
                <div className="font-medium text-white">Заполнить из истории покупок</div>
                {station ? (
                  <div className={stationMatches ? 'text-slate-400' : 'text-yellow-200'}>
                    Помощник «{station.name}»: введён {station.state.apple?.email || 'Apple ID'}{typeof station.state.apple?.purchases_count === 'number' ? ` · покупок: ${station.state.apple.purchases_count}` : ''}
                    {!stationMatches && <span className="block text-xs">Это не {maskEmail(account.apple_id)}. Войдите на помощнике в аккаунт салона.</span>}
                  </div>
                ) : (
                  <div className="text-slate-400">Историю покупок читает помощник на Mac. Откройте вкладку «По кабелю» и войдите там в Apple ID салона — после этого вернитесь сюда.</div>
                )}
              </div>
              {station
                ? <button type="button" disabled={busy !== null} onClick={() => runImport(false)} className={BTN_PRIMARY} data-import-btn><AdminIcon name="refresh" className="h-4 w-4" />{busy === 'import' ? 'Читаем…' : busy === 'check' ? 'Сверяем с App Store…' : 'Заполнить каталог'}</button>
                : <button type="button" onClick={goCable} className={BTN_SECONDARY}>Открыть «По кабелю»</button>}
              {rows.length > 0 && <button type="button" disabled={busy !== null} onClick={() => checkStore(false)} className={BTN_SECONDARY} data-check-store>{busy === 'check' ? 'Сверяем…' : 'Сверить с App Store'}</button>}
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} type="search" placeholder="Поиск по названию или bundle" className={`${INPUT} sm:max-w-xs`} data-catalog-search />
                {([['all', 'Все'], ['shown', 'В каталоге'], ['hidden', 'Скрытые'], ['removed', 'Нет в App Store'], ['bank', 'Банки']] as const).map(([k, label]) => (
                  <Chip key={k} active={filter === k} onClick={() => { setFilter(k); setShown(PAGE) }} testId={`catalog-filter-${k}`}>{label} · {counts[k]}</Chip>
                ))}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                Найдено {visible.length}.
                {hiddenInView.length > 0 && <button type="button" disabled={busy !== null} onClick={() => bulk(hiddenInView.map(x => x.c.id), true)} className={BTN_ROW} data-bulk-show>Показать в каталоге все {hiddenInView.length}</button>}
                {shownInView.length > 0 && filter !== 'all' && <button type="button" disabled={busy !== null} onClick={() => bulk(shownInView.map(x => x.c.id), false)} className={BTN_ROW} data-bulk-hide>Скрыть все {shownInView.length}</button>}
              </div>
              <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
                {visible.slice(0, shown).map(({ c, r }) => (
                  <li key={c.id} data-catalog-row={c.bundle_id} data-active={c.is_active ? '1' : '0'} className="flex items-center gap-3 px-3 py-2">
                    <AppIcon app={r} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{r.name}{c.title && c.title !== c.name ? <span className="ml-2 text-xs text-slate-500">в покупках: {c.name}</span> : null}</span>
                      <span className="block truncate text-xs text-slate-500">{c.bundle_id}{c.version ? ` · ${c.version}` : ''}{c.store_id ? ` · id ${c.store_id}` : ''}</span>
                    </span>
                    {c.in_store === false && <span className="hidden shrink-0 rounded-full bg-yellow-400/15 px-2 py-0.5 text-xs text-yellow-300 sm:inline">нет в App Store</span>}
                    {c.in_store === true && <span className="hidden shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400 sm:inline">есть в App Store</span>}
                    <button type="button" onClick={() => setEditing(c)} aria-label={`Изменить ${r.name}`} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><AdminIcon name="edit" className="h-4 w-4" /></button>
                    <button type="button" role="switch" aria-checked={c.is_active} aria-label={`${r.name}: показывать в каталоге`} onClick={() => setActive(c, !c.is_active)} data-row-toggle
                      className={`relative h-6 w-11 shrink-0 rounded-full transition ${c.is_active ? 'bg-yellow-400' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${c.is_active ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </li>
                ))}
              </ul>
              {visible.length > shown && <div className="mt-2 text-center"><button type="button" onClick={() => setShown(n => n + PAGE)} className={BTN_SECONDARY}>Показать ещё {Math.min(PAGE, visible.length - shown)}</button></div>}
            </>
          )}
          <ManualAdd api={api} account={account} onAdded={reload} />
        </section>
      )}

      <SettingsForm api={api} config={config} onSaved={reload} />

      {addOpen && <AddAccountModal api={api} onClose={() => setAddOpen(false)} onAdded={async a => { setAddOpen(false); await reload(); setAccountId(a.id); setShown(PAGE) }} />}
      {editing && <EditAppModal api={api} app={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} onDelete={async () => { const app = editing; setEditing(null); await removeApp(app) }} />}
    </div>
  )
}

function Memo({ open }: { open: boolean }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/[0.03]" open={open} data-memo>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-white">
        <AdminIcon name="alert" className="h-4 w-4 text-yellow-300" />Как это работает и что важно знать
        <span className="ml-auto text-xs font-normal text-slate-500 group-open:hidden">показать</span>
      </summary>
      <div className="grid gap-4 border-t border-white/10 px-5 py-4 text-sm text-slate-300 md:grid-cols-2">
        <ul className="list-disc space-y-2 pl-5">
          <li>Приложение, которого больше нет в App Store, можно скачать заново только с того Apple ID, который успел его получить. Поэтому нужен Apple ID салона с такими приложениями в истории покупок.</li>
          <li>На телефоне покупателя этот Apple ID вводится только в «Контент и покупки». Из iCloud покупатель не выходит: фото, контакты и пароли остаются на месте.</li>
          <li>Приложения скачиваются в App Store: значок профиля → «Приложения и история покупок» → «Мои приложения» → «Не на этом iPhone».</li>
          <li>Пароль Apple ID салона вводит сотрудник. На сайте он не хранится и странице заказа неизвестен.</li>
        </ul>
        <ul className="list-disc space-y-2 pl-5">
          <li>После возврата своего аккаунта приложение работает дальше, но через App Store не обновляется: обновление — это повторная установка у вас.</li>
          <li>С одним Apple ID для покупок можно связать до 10 устройств. Телефоны покупателей попадают в этот список — удаляйте их: на Mac в приложении «Музыка» → «Учётная запись» → «Настройки учётной записи» → «Управление устройствами». <a href="https://support.apple.com/ru-ru/118412" target="_blank" rel="noreferrer" className="text-yellow-300 underline decoration-dotted">Статья Apple</a></li>
          <li>По правилам Apple устройство меняет привязку к аккаунту раз в 90 дней. Возможно, после установки покупатель какое-то время не сможет заново скачивать свои старые покупки. Проверьте это на своём телефоне до первого покупателя.</li>
          <li>Apple разрешает аккаунт только для личного использования. Массовая установка — на ваш риск: аккаунт могут ограничить. Не держите на нём покупки, подписки и iCloud.</li>
        </ul>
      </div>
    </details>
  )
}

function AddAccountModal({ api, onClose, onAdded }: { api: Api; onClose: () => void; onAdded: (a: InstallAccount) => void }) {
  const [label, setLabel] = useState('Салон')
  const [appleId, setAppleId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const a = await call<InstallAccount>(api, '/accounts', { method: 'POST', body: { label: label.trim(), apple_id: appleId.trim(), note: note.trim() || null } })
    setSaving(false)
    if (a) { toast('Аккаунт добавлен', 'success'); onAdded(a) }
  }
  return (
    <Modal title="Apple ID салона" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" data-account-form>
        <p className="text-sm text-slate-400">Только почта аккаунта — чтобы сотрудники и страница заказа знали, какой Apple ID вводить. Пароль сюда не вносится.</p>
        <input value={appleId} onChange={e => setAppleId(e.target.value)} type="email" required autoFocus autoComplete="off" placeholder="Apple ID (почта)" className={INPUT} data-account-email />
        <input value={label} onChange={e => setLabel(e.target.value)} required minLength={2} maxLength={80} placeholder="Как называть у себя: Салон, Банки…" className={INPUT} data-account-label />
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Пометка: у кого доверенное устройство" className={INPUT} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
          <button type="submit" disabled={saving || !appleId.trim() || label.trim().length < 2} className={BTN_PRIMARY} data-account-save>{saving ? 'Сохраняем…' : 'Добавить'}</button>
        </div>
      </form>
    </Modal>
  )
}

function EditAppModal({ api, app, onClose, onSaved, onDelete }: { api: Api; app: CatalogApp; onClose: () => void; onSaved: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(app.title || '')
  const [icon, setIcon] = useState(app.icon_url || '')
  const [storeId, setStoreId] = useState(app.store_id ? String(app.store_id) : '')
  const [saving, setSaving] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (storeId.trim() && !/^\d+$/.test(storeId.trim())) { toast('App Store ID — только цифры', 'error'); return }
    setSaving(true)
    const ok = await call(api, `/catalog/${app.id}`, { method: 'PATCH', body: { title: title.trim() || null, icon_url: icon.trim() || null, store_id: storeId.trim() ? Number(storeId.trim()) : null } })
    setSaving(false)
    if (ok) { toast('Сохранено', 'success'); onSaved() }
  }
  return (
    <Modal title={app.title || app.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-500">В истории покупок: {app.name} · {app.bundle_id}</p>
        <label className="block text-sm text-slate-300">Название в каталоге
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder={app.name} className={`${INPUT} mt-1`} />
        </label>
        <label className="block text-sm text-slate-300">Ссылка на иконку
          <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={500} placeholder="https://…" className={`${INPUT} mt-1`} />
        </label>
        <label className="block text-sm text-slate-300">App Store ID
          <input value={storeId} onChange={e => setStoreId(e.target.value)} inputMode="numeric" placeholder="например 492224193" className={`${INPUT} mt-1`} />
        </label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDelete} className={`${BTN_ROW} text-red-300`}>Убрать из списка</button>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
            <button type="submit" disabled={saving} className={BTN_PRIMARY}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
          </span>
        </div>
      </form>
    </Modal>
  )
}

function ManualAdd({ api, account, onAdded }: { api: Api; account: InstallAccount; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [bundle, setBundle] = useState('')
  const [storeId, setStoreId] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (storeId.trim() && !/^\d+$/.test(storeId.trim())) { toast('App Store ID — только цифры', 'error'); return }
    setSaving(true)
    const ok = await call(api, '/catalog', { method: 'POST', body: { account_id: account.id, name: name.trim(), bundle_id: bundle.trim(), store_id: storeId.trim() ? Number(storeId.trim()) : null } })
    setSaving(false)
    if (ok) { setName(''); setBundle(''); setStoreId(''); toast('Добавлено в каталог', 'success'); await onAdded() }
  }
  return (
    <details className="mt-3" data-manual-add>
      <summary className="cursor-pointer text-xs text-slate-500">Добавить приложение вручную</summary>
      <form onSubmit={submit} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_160px_auto]">
        <input value={name} onChange={e => setName(e.target.value)} required maxLength={200} placeholder="Название как в покупках" className={INPUT} data-manual-name />
        <input value={bundle} onChange={e => setBundle(e.target.value)} required minLength={3} maxLength={200} placeholder="Bundle ID: ru.sberbankmobile" className={INPUT} data-manual-bundle />
        <input value={storeId} onChange={e => setStoreId(e.target.value)} inputMode="numeric" placeholder="App Store ID" className={INPUT} />
        <button type="submit" disabled={saving || !name.trim() || bundle.trim().length < 3} className={BTN_SECONDARY} data-manual-save>Добавить</button>
      </form>
      <p className="mt-1 text-xs text-slate-500">Пригодится, если помощник не подключён. Название пишите так, как оно стоит в списке покупок App Store: по нему приложение ищут на телефоне.</p>
    </details>
  )
}

function SettingsForm({ api, config, onSaved }: { api: Api; config: InstallsConfig; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<InstallsConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const form = draft ?? config
  const setForm = (fn: (f: InstallsConfig) => InstallsConfig) => setDraft(fn(form))
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(config)
  const num = (key: 'price' | 'bulk_price' | 'bulk_min' | 'window_minutes' | 'code_limit') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)) }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const ok = await call<InstallsConfig>(api, '/settings', { method: 'PUT', body: form })
    setSaving(false)
    if (ok) { await onSaved(); setDraft(null); toast('Настройки сохранены', 'success') }
  }
  const field = 'block text-sm text-slate-300'
  return (
    <section data-installs-settings>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Цены и правила</h3>
      <form onSubmit={submit} className={`${CARD} space-y-4`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className={field}>Цена за приложение, ₽<input value={form.price} onChange={num('price')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="price" /></label>
          <label className={field}>Цена от нескольких, ₽<input value={form.bulk_price} onChange={num('bulk_price')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="bulk_price" /></label>
          <label className={field}>Со скольких штук<input value={form.bulk_min} onChange={num('bulk_min')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="bulk_min" /></label>
          <label className={field}>Время на установку, мин<input value={form.window_minutes} onChange={num('window_minutes')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="window_minutes" /></label>
          <label className={field}>Запросов кода на заказ<input value={form.code_limit} onChange={num('code_limit')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="code_limit" /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={field}>Телефон для покупателя<input value={form.support_phone} onChange={e => setForm(f => ({ ...f, support_phone: e.target.value }))} maxLength={40} placeholder="+7 …" className={`${INPUT} mt-1`} data-cfg="support_phone" /></label>
          <label className={field}>Telegram для покупателя<input value={form.support_telegram} onChange={e => setForm(f => ({ ...f, support_telegram: e.target.value }))} maxLength={80} placeholder="@takesmart" className={`${INPUT} mt-1`} data-cfg="support_telegram" /></label>
        </div>
        <label className={field}>Как оплатить заявку с сайта
          <textarea value={form.payment_text} onChange={e => setForm(f => ({ ...f, payment_text: e.target.value }))} maxLength={600} rows={2} placeholder="Например: переводом по номеру +7 … (СБП), в комментарии укажите номер заказа" className={`${INPUT} mt-1`} data-cfg="payment_text" />
        </label>
        <Toggle checked={form.storefront_enabled} onChange={v => setForm(f => ({ ...f, storefront_enabled: v }))} testId="cfg-storefront"
          label="Принимать заявки с сайта (страница /apps)"
          hint="Покупатель сам выбирает приложения и оставляет заявку. Вы подтверждаете оплату, сообщаете ему пароль и передаёте код через карточку заказа. Пока выключено, страница /apps предлагает прийти в салон." />
        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-yellow-300">Есть несохранённые изменения</span>}
          <button type="submit" disabled={saving || !dirty} className={BTN_PRIMARY} data-cfg-save>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </form>
    </section>
  )
}
