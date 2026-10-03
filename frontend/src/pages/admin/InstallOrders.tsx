import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { resolveApp } from '../../lib/appCatalog'
import {
  APPS_DEFAULT_SUBTITLE, APPS_DEFAULT_TITLE, ORDER_STATUS, catalogVisible, catalogWinners, categoriesOf, clock, errorText, orderPrice, orderUrl, rub,
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
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts])
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = activeAccounts.find(a => a.id === accountId) || (activeAccounts.length === 1 ? activeAccounts[0] : null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Все')
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<OrderMode>('staff')
  const [paid, setPaid] = useState(true)
  const [priceText, setPriceText] = useState('')
  const [saving, setSaving] = useState(false)

  // Весь каталог: общий пул + приложения аккаунтов (одно приложение — одна плитка)
  const activeIds = useMemo(() => new Set(activeAccounts.map(a => a.id)), [activeAccounts])
  const apps = useMemo(() => catalogVisible(catalog, activeIds).map(c => ({ c, r: viewOf(c) })), [catalog, activeIds])
  const categories = useMemo(() => categoriesOf(apps.map(a => a.c)), [apps])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return apps.filter(({ c, r }) => (!needle || `${r.name} ${c.name} ${c.bundle_id}`.toLowerCase().includes(needle))
      && (cat === 'Все' || (c.category || 'Прочее') === cat))
  }, [apps, q, cat])
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
      body: {
        app_ids: chosen.map(a => a.c.id), mode, customer_name: name.trim() || null, customer_phone: phone.trim() || null,
        note: note.trim() || null, paid, ...(account ? { account_id: account.id } : {}), ...(custom !== null ? { price: custom } : {}),
      },
    })
    setSaving(false)
    if (!order) return
    setPicked([]); setName(''); setPhone(''); setNote(''); setPriceText(''); setQ('')
    toast(`Заказ №${order.number} оформлен`, 'success')
    onCreated(order)
  }

  if (!apps.length) {
    return (
      <div className={`${CARD} mx-auto max-w-2xl text-center`} data-new-order-empty>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-400/15 text-yellow-300"><AdminIcon name="layers" className="h-6 w-6" /></span>
        <div className="mt-3 text-lg font-semibold text-white">Каталог пока пуст</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">Включите приложения во вкладке «Каталог» — после этого здесь появятся плитки.</p>
        <button type="button" onClick={goCatalog} className={`${BTN_PRIMARY} mt-4`} data-go-catalog>Открыть каталог</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[1fr_360px]" data-new-order>
      <div className={`${CARD} min-w-0`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className={LABEL}>Что поставить <span className="font-normal normal-case tracking-normal text-slate-500">· {visible.length} из {apps.length}</span></div>
          {activeAccounts.length > 1 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              Apple ID:
              {activeAccounts.map(a => <Chip key={a.id} active={a.id === account?.id} onClick={() => setAccountId(a.id)}>{a.label}</Chip>)}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Поиск: Сбер, Т-Банк, ВТБ…" data-order-search className={`${INPUT} sm:max-w-xs`} />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {['Все', ...categories].map(c => <Chip key={c} active={cat === c} onClick={() => setCat(c)} testId={`order-cat-${c}`}>{c}</Chip>)}
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
                      <span className="block truncate text-xs text-slate-500">{c.category || 'Приложение'}{c.account_id ? ' · есть у Apple ID салона' : ''}</span>
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
          <input value={priceText} onChange={e => setPriceText(e.target.value)} inputMode="numeric" placeholder={`Своя сумма (по умолчанию ${auto.toLocaleString('ru-RU')})`} className={`${INPUT} ${priceBad ? 'border-red-400/60' : ''}`} data-order-price />
          {priceBad && <p className="text-xs text-red-300">Сумма — целое число рублей</p>}
        </div>
        <div className="mt-3"><Toggle checked={paid} onChange={setPaid} label="Оплата получена" hint="Выключите, если покупатель заплатит позже" /></div>
        <button type="submit" disabled={!chosen.length || priceBad || saving} className={`${BTN_PRIMARY} mt-4 w-full justify-center`} data-create-order>
          <AdminIcon name="check" className="h-4 w-4" />{saving ? 'Оформляем…' : chosen.length ? `Оформить · ${chosen.length} ${appsWord(chosen.length)}` : 'Оформить заказ'}
        </button>
        {account
          ? <p className="mt-2 text-xs text-slate-500">Apple ID салона: {account.label} · {account.apple_id}</p>
          : activeAccounts.length > 1
            ? <p className="mt-2 text-xs text-yellow-200">Выберите вверху, каким Apple ID салона ставить.</p>
            : <p className="mt-2 text-xs text-yellow-200" data-no-account>Apple ID салона не добавлен: заказ сохранится, а установка заработает, когда вы добавите его во вкладке «Каталог».</p>}
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
type CatalogFilter = 'all' | 'shown' | 'hidden' | 'removed' | 'owned'
const PAGE = 120

function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 2)}***@${domain}` : email
}

const SOURCE_LABEL: Record<string, string> = { seed: 'стандартный набор', manual: 'добавлено вручную', import: 'из истории покупок' }

export function CatalogTab({ api, accounts, catalog, reload, goSettings }: {
  api: Api; accounts: InstallAccount[]; catalog: CatalogApp[]; reload: () => Promise<void>; goSettings: () => void
}) {
  const activeIds = useMemo(() => new Set(accounts.filter(a => a.is_active).map(a => a.id)), [accounts])
  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [cat, setCat] = useState('Все')
  const [shown, setShown] = useState(PAGE)
  const [editing, setEditing] = useState<CatalogApp | null>(null)
  const [addAppOpen, setAddAppOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Одна строка на приложение — та запись, которая решает, показывается ли оно на сайте
  const rows = useMemo(() => catalogWinners(catalog, activeIds)
    .map(c => ({ c, r: viewOf(c) }))
    .sort((a, b) => a.c.sort - b.c.sort || a.r.name.localeCompare(b.r.name, 'ru')), [catalog, activeIds])
  const categories = useMemo(() => categoriesOf(rows.map(x => x.c)), [rows])
  const isShown = (c: CatalogApp) => c.is_active && (c.account_id === null || activeIds.has(c.account_id))
  const counts = useMemo(() => ({
    all: rows.length, shown: rows.filter(x => isShown(x.c)).length, hidden: rows.filter(x => !isShown(x.c)).length,
    removed: rows.filter(x => x.c.in_store === false).length, owned: rows.filter(x => x.c.account_id !== null).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, activeIds])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(({ c, r }) => {
      if (needle && !`${r.name} ${c.name} ${c.bundle_id}`.toLowerCase().includes(needle)) return false
      if (cat !== 'Все' && (c.category || 'Прочее') !== cat) return false
      if (filter === 'shown') return isShown(c)
      if (filter === 'hidden') return !isShown(c)
      if (filter === 'removed') return c.in_store === false
      if (filter === 'owned') return c.account_id !== null
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, filter, cat, activeIds])
  const hiddenInView = visible.filter(x => !x.c.is_active)
  const shownInView = visible.filter(x => x.c.is_active)

  const checkStore = async () => {
    setBusy('check')
    const res = await call<{ checked: number; in_store: number; removed: number; failed: number }>(api, '/catalog/check-store', { method: 'POST', body: {} })
    setBusy(null)
    if (!res) return
    await reload()
    toast(`Сверили с App Store: ${res.in_store} есть, ${res.removed} нет${res.failed ? `, ${res.failed} проверить не удалось` : ''}`, res.failed ? 'info' : 'success')
  }
  const bulk = async (ids: string[], isActive: boolean) => {
    if (!ids.length) return
    setBusy('bulk')
    const res = await call<{ changed: number }>(api, '/catalog/bulk', { method: 'POST', body: { ids, is_active: isActive } })
    setBusy(null)
    if (res) { await reload(); toast(isActive ? `Показывается ещё ${res.changed}` : `Скрыто: ${res.changed}`, 'success') }
  }
  const setActive = async (app: CatalogApp, isActive: boolean) => { if (await call(api, `/catalog/${app.id}`, { method: 'PATCH', body: { is_active: isActive } })) reload() }
  const removeApp = async (app: CatalogApp) => {
    const owned = app.account_id !== null
    if (!(await confirmDialog({
      title: `Удалить «${app.title || app.name}» из каталога?`,
      message: owned ? 'Запись Apple ID салона удалится. При следующем чтении его истории покупок приложение появится снова — скрытым.' : 'Приложение уйдёт из общего пула. Вернуть можно кнопкой «Добавить приложение».',
      confirmLabel: 'Удалить', danger: true,
    }))) return
    if (await call(api, `/catalog/${app.id}`, { method: 'DELETE' })) { toast('Удалено', 'success'); reload() }
  }
  const resetPaging = () => setShown(PAGE)

  return (
    <div className="space-y-8" data-catalog-tab>
      <section data-pool>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Каталог приложений</h3>
          <span className="text-xs text-slate-500" data-pool-counts>на сайте показывается {counts.shown} из {counts.all}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setAddAppOpen(true)} className={BTN_PRIMARY} data-add-app><AdminIcon name="plus" className="h-4 w-4" />Добавить приложение</button>
            <button type="button" disabled={busy !== null} onClick={checkStore} className={BTN_SECONDARY} data-check-store>{busy === 'check' ? 'Сверяем…' : 'Сверить с App Store'}</button>
          </span>
        </div>
        <p className="mb-3 max-w-3xl text-sm text-slate-400">Это общий пул: его видят покупатели на странице /apps и вы во вкладке «Новый заказ». Скачать приложение получится, только если оно есть в истории покупок Apple ID салона — такие отмечены зелёным. Apple ID, пароль менеджера и страница /apps — во вкладке <button type="button" onClick={goSettings} className="text-yellow-300 underline decoration-dotted" data-go-settings>«Настройки»</button>.</p>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => { setQ(e.target.value); resetPaging() }} type="search" placeholder="Поиск по названию или bundle" className={`${INPUT} sm:max-w-xs`} data-catalog-search />
          {([['all', 'Все'], ['shown', 'На сайте'], ['hidden', 'Скрытые'], ['owned', 'Есть у Apple ID салона'], ['removed', 'Нет в App Store']] as const).map(([k, label]) => (
            <Chip key={k} active={filter === k} onClick={() => { setFilter(k); resetPaging() }} testId={`catalog-filter-${k}`}>{label} · {counts[k]}</Chip>
          ))}
        </div>
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {['Все', ...categories].map(c => <Chip key={c} active={cat === c} onClick={() => { setCat(c); resetPaging() }} testId={`catalog-cat-${c}`}>{c}</Chip>)}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
          Найдено {visible.length}.
          {hiddenInView.length > 0 && <button type="button" disabled={busy !== null} onClick={() => bulk(hiddenInView.map(x => x.c.id), true)} className={BTN_ROW} data-bulk-show>Показать все {hiddenInView.length}</button>}
          {shownInView.length > 0 && <button type="button" disabled={busy !== null} onClick={() => bulk(shownInView.map(x => x.c.id), false)} className={BTN_ROW} data-bulk-hide>Скрыть все {shownInView.length}</button>}
        </div>
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">Ничего не найдено.</div>
        ) : (
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
            {visible.slice(0, shown).map(({ c, r }) => {
              const acc = c.account_id ? accountsById.get(c.account_id) : null
              return (
                <li key={c.id} data-catalog-row={c.bundle_id} data-active={c.is_active ? '1' : '0'} className="flex items-center gap-3 px-3 py-2">
                  <AppIcon app={r} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{r.name}{c.title && c.title !== c.name ? <span className="ml-2 text-xs text-slate-500">в покупках: {c.name}</span> : null}</span>
                    <span className="block truncate text-xs text-slate-500">{c.category || 'Без группы'} · {c.bundle_id}{c.store_id ? ` · id ${c.store_id}` : ''}</span>
                  </span>
                  <span className="hidden shrink-0 flex-wrap justify-end gap-1 md:flex">
                    {acc
                      ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300" data-owned>у Apple ID «{acc.label}»</span>
                      : <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">{SOURCE_LABEL[c.source] || 'общий пул'}</span>}
                    {c.in_store === false && <span className="rounded-full bg-yellow-400/15 px-2 py-0.5 text-xs text-yellow-300">нет в App Store</span>}
                    {c.in_store === true && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">есть в App Store</span>}
                  </span>
                  <button type="button" onClick={() => setEditing(c)} aria-label={`Изменить ${r.name}`} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><AdminIcon name="edit" className="h-4 w-4" /></button>
                  <button type="button" role="switch" aria-checked={c.is_active} aria-label={`${r.name}: показывать на сайте`} onClick={() => setActive(c, !c.is_active)} data-row-toggle
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${c.is_active ? 'bg-yellow-400' : 'bg-white/15'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${c.is_active ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {visible.length > shown && <div className="mt-2 text-center"><button type="button" onClick={() => setShown(n => n + PAGE)} className={BTN_SECONDARY}>Показать ещё {Math.min(PAGE, visible.length - shown)}</button></div>}
      </section>

      {addAppOpen && <AddAppModal api={api} categories={categories} onClose={() => setAddAppOpen(false)} onAdded={async () => { setAddAppOpen(false); await reload() }} />}
      {editing && <EditAppModal api={api} app={editing} categories={categories} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} onDelete={async () => { const app = editing; setEditing(null); await removeApp(app) }} />}
    </div>
  )
}

// ── Режим сотрудника: пароль менеджера для установки со страницы /apps ───────
function StaffCodeCard({ api, config, onSaved }: { api: Api; config: InstallsConfig; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim().length < 4) { toast('Пароль — минимум 4 символа', 'error'); return }
    setSaving(true)
    const ok = await call<InstallsConfig>(api, '/staff-code', { method: 'POST', body: { code: code.trim() } })
    setSaving(false)
    if (ok) { setCode(''); await onSaved(); toast('Пароль менеджера сохранён', 'success') }
  }
  const clear = async () => {
    if (!(await confirmDialog({ title: 'Убрать пароль менеджера?', message: 'Режим сотрудника на странице /apps выключится: ставить приложения оттуда будет нельзя.', confirmLabel: 'Убрать', danger: true }))) return
    if (await call(api, '/staff-code', { method: 'DELETE' })) { await onSaved(); toast('Пароль убран', 'success') }
  }
  return (
    <section data-staff-card data-set={config.staff_code_set ? '1' : '0'}>
      <div className={CARD}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 basis-72 text-sm text-slate-300">
            <div className="flex items-center gap-2 font-medium text-white">
              <span className={`h-2.5 w-2.5 rounded-full ${config.staff_code_set ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {config.staff_code_set ? 'Пароль менеджера задан' : 'Пароль менеджера не задан'}
            </div>
            <p className="mt-1">Менеджер открывает на телефоне покупателя страницу <a href="/apps" target="_blank" rel="noreferrer" className="text-yellow-300 underline decoration-dotted">/apps</a>, выбирает приложения, нажимает внизу «Я сотрудник TakeSmart» и вводит этот пароль — дальше страница сразу ведёт к установке. У покупателей пароля нет: они могут только посмотреть каталог или оставить заявку.</p>
            <p className="mt-1 text-xs text-slate-500">Это пароль для доступа к установке на нашем сайте, а не пароль Apple ID — его вводят на телефоне при входе, у нас он не хранится.</p>
          </div>
          <form onSubmit={save} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative">
              <input value={code} onChange={e => setCode(e.target.value)} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder={config.staff_code_set ? 'Новый пароль' : 'Придумайте пароль'} minLength={4} maxLength={40} className={`${INPUT} pr-10 sm:w-56`} data-staff-code-input />
              <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-white"><AdminIcon name="eye" className="h-4 w-4" /></button>
            </div>
            <button type="submit" disabled={saving || code.trim().length < 4} className={BTN_PRIMARY} data-staff-code-save>{saving ? 'Сохраняем…' : config.staff_code_set ? 'Сменить' : 'Сохранить'}</button>
            {config.staff_code_set && <button type="button" onClick={clear} className={`${BTN_ROW} text-red-300`} data-staff-code-clear>Убрать</button>}
          </form>
        </div>
      </div>
    </section>
  )
}

// ── Apple ID салона: с них на самом деле скачиваются приложения ──────────────
function AccountsSection({ api, accounts, catalog, reload, goCable }: { api: Api; accounts: InstallAccount[]; catalog: CatalogApp[]; reload: () => Promise<void>; goCable: () => void }) {
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = accounts.find(a => a.id === accountId) || accounts[0] || null
  const [stations, setStations] = useState<StationLite[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => { try { const r = await api('/stations'); if (r.ok && alive) setStations(await r.json()) } catch { /* сеть */ } }
    const first = window.setTimeout(load, 0)
    const id = window.setInterval(load, 3000)
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(id) }
  }, [api])

  const station = stations.find(s => s.online && s.state?.apple?.logged_in) || null
  const ownedCount = account ? catalog.filter(c => c.account_id === account.id).length : 0
  const stationMatches = Boolean(account && station && (station.state.apple?.email || '').toLowerCase() === maskEmail(account.apple_id).toLowerCase())

  const runImport = async (force = false) => {
    if (!account || !station) return
    setBusy(true)
    try {
      const res = await api(`/accounts/${account.id}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: station.id, force }) })
      if (res.status === 409) {
        const d = await res.clone().json().catch(() => null)
        if (d?.detail?.code === 'account_mismatch') {
          setBusy(false)
          if (await confirmDialog({ title: 'На помощнике другой Apple ID', message: `${d.detail.message}\n\nЗаполнить из его истории покупок всё равно?`, confirmLabel: 'Заполнить' })) runImport(true)
          return
        }
      }
      if (!res.ok) { toast(await errorText(res), 'error'); setBusy(false); return }
      const out: { total: number; created: number; updated: number } = await res.json()
      toast(`История покупок прочитана: ${out.total}. Новых приложений у аккаунта: ${out.created}`, 'success')
      await reload()
    } catch { toast('Нет связи с сервером', 'error') }
    setBusy(false)
  }
  const removeAccount = async (a: InstallAccount) => {
    if (!(await confirmDialog({ title: `Удалить Apple ID «${a.label}»?`, message: `Вместе с ним удалятся его записи в каталоге (${a.apps_total}). Общий пул и закрытые заказы останутся.`, confirmLabel: 'Удалить', danger: true }))) return
    if (await call(api, `/accounts/${a.id}`, { method: 'DELETE' })) { toast('Apple ID удалён', 'success'); setAccountId(null); reload() }
  }
  const toggleAccount = async (a: InstallAccount) => { if (await call(api, `/accounts/${a.id}`, { method: 'PATCH', body: { is_active: !a.is_active } })) reload() }

  return (
    <section data-accounts>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-72 text-sm text-slate-400">Аккаунт, с которого на самом деле скачиваются приложения: в его истории покупок должны быть банки и другие приложения из каталога.</p>
        <button type="button" onClick={() => setAddOpen(true)} className={BTN_ROW} data-add-account><span className="inline-flex items-center gap-1.5"><AdminIcon name="plus" className="h-4 w-4" />Добавить Apple ID</span></button>
      </div>
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400" data-no-accounts>
          Пока ни одного. Это аккаунт, с которого на самом деле скачиваются приложения: в его истории покупок должны быть банки и другие приложения из каталога.
          <div className="mt-3"><button type="button" onClick={() => setAddOpen(true)} className={BTN_PRIMARY}>Добавить Apple ID салона</button></div>
        </div>
      ) : (
        <>
          <ul className="grid gap-2 md:grid-cols-2">
            {accounts.map(a => (
              <li key={a.id} data-account={a.apple_id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${a.id === account?.id ? 'border-yellow-400/50 bg-yellow-400/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
                <button type="button" onClick={() => setAccountId(a.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium text-white">{a.label}{!a.is_active && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-slate-400">выключен</span>}</span>
                  <span className="block truncate text-sm text-slate-400">{a.apple_id}</span>
                  <span className="block text-xs text-slate-500">приложений в истории покупок: {a.apps_total}</span>
                </button>
                <button type="button" onClick={() => toggleAccount(a)} className={BTN_ROW}>{a.is_active ? 'Выключить' : 'Включить'}</button>
                <button type="button" onClick={() => removeAccount(a)} aria-label={`Удалить ${a.label}`} className={`${BTN_ROW} text-red-300`}><AdminIcon name="trash" className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          {account && (
            <div className={`${CARD} mt-3`} data-import-box>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-64 text-sm">
                  <div className="font-medium text-white">Проверить, какие приложения есть у «{account.label}»</div>
                  {station ? (
                    <div className={stationMatches ? 'text-slate-400' : 'text-yellow-200'}>
                      Помощник «{station.name}»: введён {station.state.apple?.email || 'Apple ID'}{typeof station.state.apple?.purchases_count === 'number' ? ` · покупок: ${station.state.apple.purchases_count}` : ''}
                      {!stationMatches && <span className="block text-xs">Это не {maskEmail(account.apple_id)}. Войдите на помощнике в этот Apple ID.</span>}
                    </div>
                  ) : (
                    <div className="text-slate-400">Историю покупок читает помощник на Mac: во вкладке «По кабелю» войдите в этот Apple ID и вернитесь сюда. После проверки приложения из каталога, которые у него есть, отметятся зелёным.</div>
                  )}
                  {ownedCount > 0 && <div className="mt-1 text-xs text-emerald-300">Уже известно приложений у этого Apple ID: {ownedCount}</div>}
                </div>
                {station
                  ? <button type="button" disabled={busy} onClick={() => runImport(false)} className={BTN_PRIMARY} data-import-btn><AdminIcon name="refresh" className="h-4 w-4" />{busy ? 'Читаем…' : 'Прочитать историю покупок'}</button>
                  : <button type="button" onClick={goCable} className={BTN_SECONDARY}>Открыть «По кабелю»</button>}
              </div>
            </div>
          )}
        </>
      )}
      {addOpen && <AddAccountModal api={api} onClose={() => setAddOpen(false)} onAdded={async a => { setAddOpen(false); await reload(); setAccountId(a.id) }} />}
    </section>
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

function CategoryField({ value, onChange, categories }: { value: string; onChange: (v: string) => void; categories: string[] }) {
  const options = Array.from(new Set([...categories.filter(c => c !== 'Прочее'), 'Банки', 'Маркетплейсы', 'Транспорт', 'Сервисы', 'Связь', 'Госуслуги']))
  return (
    <label className="block text-sm text-slate-300">Группа в каталоге
      <input value={value} onChange={e => onChange(e.target.value)} list="install-categories" maxLength={40} placeholder="Банки, Маркетплейсы…" className={`${INPUT} mt-1`} data-app-category />
      <datalist id="install-categories">{options.map(c => <option key={c} value={c} />)}</datalist>
    </label>
  )
}

function EditAppModal({ api, app, categories, onClose, onSaved, onDelete }: { api: Api; app: CatalogApp; categories: string[]; onClose: () => void; onSaved: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(app.title || '')
  const [icon, setIcon] = useState(app.icon_url || '')
  const [storeId, setStoreId] = useState(app.store_id ? String(app.store_id) : '')
  const [category, setCategory] = useState(app.category || '')
  const [isBank, setIsBank] = useState(app.is_bank)
  const [bundle, setBundle] = useState(app.bundle_id)
  const [saving, setSaving] = useState(false)
  const isPool = app.account_id === null
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (storeId.trim() && !/^\d+$/.test(storeId.trim())) { toast('App Store ID — только цифры', 'error'); return }
    if (isPool && bundle.trim().length < 3) { toast('Bundle ID — минимум 3 символа', 'error'); return }
    setSaving(true)
    const ok = await call(api, `/catalog/${app.id}`, {
      method: 'PATCH',
      body: {
        title: title.trim() || null, icon_url: icon.trim() || null, store_id: storeId.trim() ? Number(storeId.trim()) : null,
        category: category.trim() || null, is_bank: isBank, ...(isPool && bundle.trim() !== app.bundle_id ? { bundle_id: bundle.trim() } : {}),
      },
    })
    setSaving(false)
    if (ok) { toast('Сохранено', 'success'); onSaved() }
  }
  return (
    <Modal title={app.title || app.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-500">{app.account_id ? 'В истории покупок' : 'В общем пуле'}: {app.name} · {app.bundle_id}</p>
        <label className="block text-sm text-slate-300">Название в каталоге
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder={app.name} className={`${INPUT} mt-1`} />
        </label>
        <CategoryField value={category} onChange={setCategory} categories={categories} />
        <Toggle checked={isBank} onChange={setIsBank} label="Это банк" hint="Попадает в фильтр «Банки»" />
        <label className="block text-sm text-slate-300">Ссылка на иконку
          <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={500} placeholder="https://… или /app-icons/sber.png" className={`${INPUT} mt-1`} />
        </label>
        <label className="block text-sm text-slate-300">App Store ID
          <input value={storeId} onChange={e => setStoreId(e.target.value)} inputMode="numeric" placeholder="например 492224193" className={`${INPUT} mt-1`} />
        </label>
        {isPool && (
          <label className="block text-sm text-slate-300">Bundle ID
            <input value={bundle} onChange={e => setBundle(e.target.value)} minLength={3} maxLength={200} className={`${INPUT} mt-1 font-mono text-sm`} data-edit-bundle />
            <span className="mt-1 block text-xs text-slate-500">Должен совпадать с настоящим — иначе после чтения истории покупок приложение задвоится. Обычно исправляется само при чтении истории.</span>
          </label>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDelete} className={`${BTN_ROW} text-red-300`}>Удалить</button>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
            <button type="submit" disabled={saving} className={BTN_PRIMARY}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
          </span>
        </div>
      </form>
    </Modal>
  )
}

function AddAppModal({ api, categories, onClose, onAdded }: { api: Api; categories: string[]; onClose: () => void; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [bundle, setBundle] = useState('')
  const [storeId, setStoreId] = useState('')
  const [category, setCategory] = useState('')
  const [isBank, setIsBank] = useState(false)
  const [icon, setIcon] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (storeId.trim() && !/^\d+$/.test(storeId.trim())) { toast('App Store ID — только цифры', 'error'); return }
    setSaving(true)
    const ok = await call(api, '/catalog', {
      method: 'POST',
      body: { name: name.trim(), bundle_id: bundle.trim(), store_id: storeId.trim() ? Number(storeId.trim()) : null, category: category.trim() || null, is_bank: isBank, icon_url: icon.trim() || null },
    })
    setSaving(false)
    if (ok) { toast('Приложение добавлено в каталог', 'success'); await onAdded() }
  }
  return (
    <Modal title="Добавить приложение в каталог" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" data-add-app-form>
        <p className="text-sm text-slate-400">Приложение попадёт в общий пул и сразу появится на /apps и во вкладке «Новый заказ». Название пишите как в App Store — по нему его ищут на телефоне.</p>
        <label className="block text-sm text-slate-300">Название
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus maxLength={200} placeholder="Например, Сбербанк Онлайн" className={`${INPUT} mt-1`} data-new-app-name />
        </label>
        <label className="block text-sm text-slate-300">Bundle ID
          <input value={bundle} onChange={e => setBundle(e.target.value)} required minLength={3} maxLength={200} placeholder="ru.sberbankmobile" className={`${INPUT} mt-1`} data-new-app-bundle />
        </label>
        <CategoryField value={category} onChange={setCategory} categories={categories} />
        <Toggle checked={isBank} onChange={setIsBank} label="Это банк" hint="Попадает в фильтр «Банки»" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">App Store ID (необязательно)
            <input value={storeId} onChange={e => setStoreId(e.target.value)} inputMode="numeric" placeholder="492224193" className={`${INPUT} mt-1`} />
          </label>
          <label className="block text-sm text-slate-300">Иконка (необязательно)
            <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={500} placeholder="https://…" className={`${INPUT} mt-1`} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
          <button type="submit" disabled={saving || !name.trim() || bundle.trim().length < 3} className={BTN_PRIMARY} data-new-app-save>{saving ? 'Добавляем…' : 'Добавить'}</button>
        </div>
      </form>
    </Modal>
  )
}

const SETTINGS_SECTIONS = [
  ['set-staff', 'Доступ менеджера', 'zap'],
  ['set-page', 'Страница /apps', 'external'],
  ['set-prices', 'Цены', 'ruble'],
  ['set-install', 'Установка', 'clock'],
  ['set-contacts', 'Контакты и оплата', 'users'],
  ['set-accounts', 'Apple ID салона', 'layers'],
  ['set-memo', 'Как это работает', 'alert'],
] as const

function SettingsBlock({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6" data-settings-block={id}>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {hint && <p className="mt-0.5 max-w-3xl text-sm text-slate-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

export function SettingsTab({ api, accounts, catalog, config, reload, goCable }: {
  api: Api; accounts: InstallAccount[]; catalog: CatalogApp[]; config: InstallsConfig; reload: () => Promise<void>; goCable: () => void
}) {
  const [draft, setDraft] = useState<InstallsConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const qrBox = useRef<HTMLDivElement>(null)
  const form = draft ?? config
  const setForm = (fn: (f: InstallsConfig) => InstallsConfig) => setDraft(fn(form))
  const set = <K extends keyof InstallsConfig>(key: K, value: InstallsConfig[K]) => setForm(f => ({ ...f, [key]: value }))
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(config)
  const num = (key: 'price' | 'bulk_price' | 'bulk_min' | 'window_minutes' | 'code_limit') => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)))
  const appsUrl = `${window.location.origin}/apps`

  const save = async () => {
    setSaving(true)
    const ok = await call<InstallsConfig>(api, '/settings', { method: 'PUT', body: form })
    setSaving(false)
    if (ok) { await reload(); setDraft(null); toast('Настройки сохранены', 'success') }
  }
  const printQr = () => {
    const svg = qrBox.current?.innerHTML || ''
    const w = window.open('', '_blank', 'width=640,height=820')
    if (!w) { toast('Браузер не дал открыть окно печати', 'error'); return }
    const title = escapeHtml(form.page_title.trim() || 'Приложения на iPhone')
    w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;padding:48px 32px;color:#111}
      h1{font-size:30px;margin:0 0 8px}p{font-size:18px;margin:6px 0;color:#333}.qr svg{width:360px;height:360px;margin:28px auto}
      .url{font-size:14px;color:#777}</style></head><body>
      <h1>${title}</h1><p>Банки и сервисы, которых нет в App Store</p>
      <div class="qr">${svg}</div><p>Наведите камеру iPhone — откроется каталог</p><p class="url">${escapeHtml(appsUrl)}</p>
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  const field = 'block text-sm text-slate-300'
  const one = form.price, three = form.bulk_min <= 3 ? 3 * form.bulk_price : 3 * form.price

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]" data-installs-settings>
      <nav className="hidden lg:block" aria-label="Разделы настроек">
        <ul className="sticky top-4 space-y-0.5">
          {SETTINGS_SECTIONS.map(([id, label, icon]) => (
            <li key={id}><a href={`#${id}`} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-400 transition hover:bg-white/[0.05] hover:text-white"><AdminIcon name={icon} className="h-4 w-4 shrink-0" />{label}</a></li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-10 pb-24">
        <SettingsBlock id="set-staff" title="Доступ менеджера" hint="Пароль, по которому менеджер ставит приложения прямо со страницы /apps. У покупателей его нет.">
          <StaffCodeCard api={api} config={config} onSaved={reload} />
        </SettingsBlock>

        <SettingsBlock id="set-page" title="Страница /apps" hint="Что видят покупатели на сайте.">
          <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
            <div className={`${CARD} space-y-4`}>
              <Toggle checked={form.storefront_enabled} onChange={v => set('storefront_enabled', v)} testId="cfg-storefront"
                label="Показывать каталог на странице /apps"
                hint="Выключено — посетитель видит описание услуги и «приходите в салон», а каталог открывается только менеджеру по паролю." />
              <Toggle checked={form.requests_enabled} onChange={v => set('requests_enabled', v)} disabled={!form.storefront_enabled} testId="cfg-requests"
                label="Принимать заявки с сайта"
                hint={form.storefront_enabled ? 'Покупатель выбирает приложения и оставляет имя и телефон — заявка приходит во вкладку «Заказы». Выключите, чтобы каталог был только витриной.' : 'Сначала включите показ каталога.'} />
              <Toggle checked={form.show_price} onChange={v => set('show_price', v)} testId="cfg-show-price"
                label="Показывать цены" hint="Цена за приложение в шапке страницы и сумма при выборе." />
              <Toggle checked={form.menu_link} onChange={v => set('menu_link', v)} testId="cfg-menu-link"
                label="Пункт «Приложения» в меню сайта" hint="Ссылка на /apps появится в шапке (на экранах от 1280 px), в мобильном меню и в подвале." />
              <label className={field}>Заголовок страницы
                <input value={form.page_title} onChange={e => set('page_title', e.target.value)} maxLength={120} placeholder={APPS_DEFAULT_TITLE} className={`${INPUT} mt-1`} data-cfg="page_title" />
              </label>
              <label className={field}>Подзаголовок
                <textarea value={form.page_subtitle} onChange={e => set('page_subtitle', e.target.value)} maxLength={300} rows={2} placeholder={APPS_DEFAULT_SUBTITLE} className={`${INPUT} mt-1`} data-cfg="page_subtitle" />
              </label>
              <p className="text-xs text-slate-500">Пустые поля — стандартный текст (он виден серым).</p>
            </div>
            <div className={`${CARD} flex flex-col items-center text-center`} data-apps-qr>
              <div className={LABEL}>QR для стойки</div>
              <div ref={qrBox} className="mt-3"><QrCode value={appsUrl} size={170} /></div>
              <p className="mt-2 text-xs text-slate-500">Покупатель наводит камеру — открывается /apps.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={printQr} className={BTN_ROW} data-print-qr>Распечатать</button>
                <button type="button" onClick={() => copyText(appsUrl, 'Ссылка скопирована')} className={BTN_ROW}>Ссылка</button>
                <a href="/apps" target="_blank" rel="noreferrer" className={BTN_ROW} data-open-apps>Открыть</a>
              </div>
            </div>
          </div>
        </SettingsBlock>

        <SettingsBlock id="set-prices" title="Цены" hint="Цена за одно приложение и скидка, когда ставят сразу несколько.">
          <div className={`${CARD} space-y-3`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={field}>За приложение, ₽<input value={form.price} onChange={num('price')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="price" /></label>
              <label className={field}>От нескольких — за каждое, ₽<input value={form.bulk_price} onChange={num('bulk_price')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="bulk_price" /></label>
              <label className={field}>«Несколько» — это от, шт.<input value={form.bulk_min} onChange={num('bulk_min')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="bulk_min" /></label>
            </div>
            <p className="text-sm text-slate-400" data-price-preview>Пример: 1 приложение — {rub(one)}, 3 приложения — {rub(three)}.</p>
          </div>
        </SettingsBlock>

        <SettingsBlock id="set-install" title="Установка" hint="Правила для страницы заказа, по которой покупатель ставит приложения.">
          <div className={`${CARD} grid gap-3 sm:grid-cols-2`}>
            <label className={field}>Время на установку, мин<input value={form.window_minutes} onChange={num('window_minutes')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="window_minutes" />
              <span className="mt-1 block text-xs text-slate-500">Столько у покупателя после «Начать установку». Потом заказ закрывается, продлить можно из карточки.</span></label>
            <label className={field}>Запросов кода на заказ<input value={form.code_limit} onChange={num('code_limit')} inputMode="numeric" className={`${INPUT} mt-1`} data-cfg="code_limit" />
              <span className="mt-1 block text-xs text-slate-500">Сколько раз покупатель может нажать «Получить код». Счётчик сбрасывается в карточке заказа.</span></label>
          </div>
        </SettingsBlock>

        <SettingsBlock id="set-contacts" title="Контакты и оплата" hint="Показываются покупателю на /apps и на странице заказа.">
          <div className={`${CARD} space-y-3`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={field}>Телефон<input value={form.support_phone} onChange={e => set('support_phone', e.target.value)} maxLength={40} placeholder="+7 …" className={`${INPUT} mt-1`} data-cfg="support_phone" /></label>
              <label className={field}>Telegram<input value={form.support_telegram} onChange={e => set('support_telegram', e.target.value)} maxLength={80} placeholder="@takesmart" className={`${INPUT} mt-1`} data-cfg="support_telegram" /></label>
            </div>
            <label className={field}>Как оплатить заявку с сайта
              <textarea value={form.payment_text} onChange={e => set('payment_text', e.target.value)} maxLength={600} rows={2} placeholder="Например: переводом по номеру +7 … (СБП), в комментарии укажите номер заказа" className={`${INPUT} mt-1`} data-cfg="payment_text" />
            </label>
          </div>
        </SettingsBlock>

        <SettingsBlock id="set-accounts" title="Apple ID салона">
          <AccountsSection api={api} accounts={accounts} catalog={catalog} reload={reload} goCable={goCable} />
        </SettingsBlock>

        <SettingsBlock id="set-memo" title="Как это работает">
          <Memo open={false} />
        </SettingsBlock>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur lg:left-auto lg:right-6 lg:bottom-6 lg:w-auto lg:rounded-2xl lg:border" data-settings-bar>
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <span className="text-sm text-yellow-200">Есть несохранённые изменения</span>
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className={`${BTN_ROW} ml-auto`} data-cfg-reset>Отменить</button>
            <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY} data-cfg-save>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
