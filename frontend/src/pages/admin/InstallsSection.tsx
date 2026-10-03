import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { API_BASE_URL } from '../../lib/config'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { resolveApp } from '../../lib/appCatalog'
import { DEFAULT_INSTALLS_CONFIG, withPoolMeta, type CatalogApp, type InstallAccount, type InstallOrder, type InstallsConfig, type OrderStats } from '../../lib/installs'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY, SegmentedTabs } from './AdminShell'
import { timeAgo } from './format'
import { CatalogTab, NewOrderTab, OrderCard, OrdersTab } from './InstallOrders'
import { AppIcon, BTN_ROW, Badge, CARD, Cmd, INPUT, Modal, PhoneGlyph, Toggle } from './installsUi'
import { readError, type Api, type AuthFetch } from './installsApi'

// ─────────────────────────────────────────────────────────────────────────────
// «Приложения на iPhone». Раздел из четырёх вкладок:
//   «Новый заказ», «Заказы», «Каталог» — схема «аккаунт салона» (InstallOrders.tsx):
//     приложения скачиваются на телефон покупателя из истории покупок Apple ID салона;
//   «По кабелю» — консоль помощника на Mac (ниже в этом файле): iPhone подключён
//     кабелем, помощник раз в секунду шлёт своё состояние и забирает команды.
//     Apple ID, введённый в консоли, проходит через сервер только как команда
//     и нигде не сохраняется.
// ─────────────────────────────────────────────────────────────────────────────

const STATIONS_POLL_MS = 2000
const CONSOLE_POLL_MS = 1000
const BREW_CMD = 'brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller'

interface Device { udid: string | null; model: string | null; ios_version: string | null; name: string | null; paired: boolean | null }
interface Purchase { bundle_id: string; name: string; id: number | null; version: string | null; icon?: string | null; genre?: string | null }
interface SessionApp { bundle_id: string; name: string; status: string; version: string | null; error: string | null; progress?: string | null }
interface HistoryItem { t: string; device: string | null; status: string; apps: { name: string; status: string; version: string | null }[] }
interface StationState { device?: Device | null; apple?: { logged_in?: boolean; email?: string | null; name?: string | null; purchases_count?: number | null } | null; busy?: boolean; host_name?: string | null; console?: HelperConsole }
interface HelperConsole {
  login?: { status: 'idle' | 'working' | 'need_code' | 'ok' | 'error'; message: string | null; pending?: boolean }
  session?: { id: string | null; apps: SessionApp[]; status: string; started: string; finished?: boolean } | null
  installed?: Record<string, { name: string; version: string; owner?: string | null; dsid?: string | null }>
  owners?: { owner: string | null; dsid: string | null; count: number; apps: string[] }[]
  tools_missing?: string[]
  auto_logout?: boolean
  simulate?: boolean
  purchases_loading?: boolean
  notice?: { t: number; message: string; tone: string } | null
  last_error?: string | null
  history?: HistoryItem[]
  events?: { t: string; msg: string }[]
}
interface Station { id: string; name: string; version: string | null; last_seen_at: string | null; state: StationState; is_active: boolean; online: boolean; created_at: string }
interface ConsoleData { station: Station; console: HelperConsole; purchases: Purchase[] | null; purchases_version: number; pending_commands: number }
interface JobApp { bundle_id: string; name: string; status: string; version: string | null; error: string | null }
interface Session { id: string; station_id: string | null; status: string; apps: JobApp[]; device_model: string | null; ios_version: string | null; note: string | null; log: { t: string; msg: string }[]; created_at: string; finished_at: string | null }
interface Stats { installed_today: number; installed_month: number; sessions_today: number; sessions_month: number; stations_online: number }
type CommandType = 'login' | 'code' | 'resend_code' | 'reset_login' | 'logout' | 'refresh_purchases' | 'install' | 'cancel' | 'dismiss_session' | 'settings'

const APP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'В очереди', cls: 'bg-white/10 text-slate-300' },
  downloading: { label: 'Скачиваем', cls: 'bg-sky-500/15 text-sky-300' },
  installing: { label: 'Ставим на iPhone', cls: 'bg-sky-500/15 text-sky-300' },
  installed: { label: 'Установлено', cls: 'bg-emerald-500/15 text-emerald-300' },
  not_owned: { label: 'Нет в покупках', cls: 'bg-yellow-400/15 text-yellow-300' },
  failed: { label: 'Ошибка', cls: 'bg-red-500/15 text-red-300' },
  skipped: { label: 'Пропущено', cls: 'bg-white/10 text-slate-400' },
}
const SESSION_STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: 'Идёт', cls: 'bg-sky-500/15 text-sky-300' },
  done: { label: 'Готово', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Сбой', cls: 'bg-red-500/15 text-red-300' },
  cancelled: { label: 'Отменено', cls: 'bg-white/10 text-slate-400' },
}

function backendOrigin(): string {
  try { return API_BASE_URL ? new URL(API_BASE_URL, window.location.origin).origin : window.location.origin } catch { return window.location.origin }
}
function setupCommand(token: string): string {
  return `curl -fsSL ${window.location.origin}/station/takesmart_station.py -o ~/takesmart_station.py && python3 ~/takesmart_station.py --autostart --backend ${backendOrigin()} --token ${token}`
}
// ── Раздел ───────────────────────────────────────────────────────────────────
type View = 'new' | 'orders' | 'catalog' | 'cable'
const VIEWS: readonly View[] = ['new', 'orders', 'catalog', 'cable']
const ORDERS_POLL_MS = 5000

export function InstallsSection({ authFetch }: { authFetch: AuthFetch }) {
  const api = useCallback<Api>((path, init) => authFetch(`${API_BASE_URL}/api/installs${path}`, init), [authFetch])
  const [params, setParams] = useSearchParams()
  const [accounts, setAccounts] = useState<InstallAccount[] | null>(null)
  const [catalog, setCatalog] = useState<CatalogApp[]>([])
  const [config, setConfig] = useState<InstallsConfig | null>(null)
  const [orders, setOrders] = useState<InstallOrder[] | null>(null)
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [cableOrder, setCableOrder] = useState<InstallOrder | null>(null)
  const announced = useRef<Set<string>>(new Set())
  const firstOrdersLoad = useRef(true)

  const reload = useCallback(async () => {
    try {
      const [a, c, s] = await Promise.all([api('/accounts'), api('/catalog'), api('/settings')])
      if (a.ok) setAccounts(await a.json())
      if (c.ok) setCatalog(withPoolMeta(await c.json()))
      if (s.ok) setConfig(await s.json())
      if (!a.ok || !s.ok) toast('Раздел загрузился не полностью — обновите страницу', 'error')
    } catch { toast('Нет связи с сервером', 'error') }
    // Раздел не должен зависнуть на «Загружаем…»: «По кабелю» работает и без заказов
    setAccounts(prev => prev ?? [])
    setConfig(prev => prev ?? DEFAULT_INSTALLS_CONFIG)
  }, [api])
  const loadOrders = useCallback(async () => {
    try {
      const [o, st] = await Promise.all([api('/orders?brief=true&limit=300'), api('/orders/stats')])
      if (st.ok) setStats(await st.json())
      if (!o.ok) return
      const list: InstallOrder[] = await o.json()
      setOrders(list)
      // Сигнал сотруднику: покупатель просит код или пришла заявка с сайта. Один раз на событие.
      for (const order of list) {
        const key = order.code_waiting ? `code:${order.id}:${order.code_requested_at}` : order.status === 'new' ? `new:${order.id}` : null
        if (!key || announced.current.has(key)) continue
        announced.current.add(key)
        if (!firstOrdersLoad.current || order.code_waiting) {
          toast(order.code_waiting ? `Заказ №${order.number}: покупатель ждёт код подтверждения` : `Новая заявка с сайта: заказ №${order.number}`, 'info', 8000)
        }
      }
      firstOrdersLoad.current = false
    } catch { /* сеть */ }
  }, [api])
  useEffect(() => {
    const first = window.setTimeout(() => { reload(); loadOrders() }, 0)
    const id = window.setInterval(() => { if (!document.hidden) loadOrders() }, ORDERS_POLL_MS)
    return () => { window.clearTimeout(first); window.clearInterval(id) }
  }, [reload, loadOrders])

  const hasCatalog = catalog.some(c => c.is_active)
  const openOrderId = params.get('order')
  const viewParam = params.get('view') as View | null
  // По умолчанию — «Новый заказ»; пока каталог не настроен — «Каталог», там объяснение и первые шаги
  const view: View | null = openOrderId ? 'orders' : viewParam && VIEWS.includes(viewParam) ? viewParam : accounts === null ? null : hasCatalog ? 'new' : 'catalog'
  const patchParams = useCallback((patch: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
      return next
    }, { replace: true })
  }, [setParams])
  const go = useCallback((v: View) => patchParams({ view: v, order: null }), [patchParams])
  const openOrder = useCallback((id: string | null) => patchParams({ view: 'orders', order: id }), [patchParams])

  const openCount = (orders || []).filter(o => o.status === 'new' || o.status === 'ready' || o.status === 'active').length
  const needAttention = (orders || []).some(o => o.code_waiting || o.status === 'new')

  return (
    <div data-installs-root data-view={view || 'loading'}>
      {view === null ? (
        <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Загружаем раздел…</div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs<View>
          items={[
            { id: 'new', label: 'Новый заказ' },
            { id: 'orders', label: needAttention ? 'Заказы •' : 'Заказы', count: openCount || undefined },
            { id: 'catalog', label: 'Каталог', count: catalog.filter(c => c.is_active).length || undefined },
            { id: 'cable', label: 'По кабелю' },
          ]}
          value={view}
          onChange={go}
        />
      </div>

      {view === 'cable' ? (
        <CableConsole api={api} order={cableOrder} onLeaveOrder={() => setCableOrder(null)} onOrderChanged={loadOrders} />
      ) : accounts === null || config === null ? (
        <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Загружаем раздел…</div>
      ) : view === 'new' ? (
        <NewOrderTab api={api} accounts={accounts} catalog={catalog} config={config} goCatalog={() => go('catalog')}
          onCreated={order => { loadOrders(); openOrder(order.id) }} />
      ) : view === 'orders' ? (
        <OrdersTab orders={orders} stats={stats} onOpen={openOrder} goNew={() => go('new')} />
      ) : (
        <CatalogTab api={api} accounts={accounts} catalog={catalog} config={config} reload={reload} goCable={() => go('cable')} />
      )}
      </>
      )}

      {openOrderId && (
        <OrderCard key={openOrderId} api={api} orderId={openOrderId} onClose={() => openOrder(null)} onChanged={loadOrders}
          onCable={order => { setCableOrder(order); go('cable') }} />
      )}
    </div>
  )
}

// ── Консоль «По кабелю» ──────────────────────────────────────────────────────
function CableConsole({ api, order, onLeaveOrder, onOrderChanged }: { api: Api; order: InstallOrder | null; onLeaveOrder: () => void; onOrderChanged: () => void }) {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [openSession, setOpenSession] = useState<Session | null>(null)
  const [setupModal, setSetupModal] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  const loadStations = useCallback(async () => {
    try { const r = await api('/stations'); if (r.ok) setStations(await r.json()) } catch { /* сеть */ }
  }, [api])
  const loadHistory = useCallback(async () => {
    try {
      const [s, ss] = await Promise.all([api('/stats').then(x => x.ok ? x.json() : null), api('/sessions?limit=100').then(x => x.ok ? x.json() : [])])
      if (s) setStats(s)
      setSessions(ss)
    } catch { /* покажем прошлое состояние */ }
  }, [api])
  useEffect(() => {
    loadStations(); loadHistory()
    const a = window.setInterval(loadStations, STATIONS_POLL_MS)
    const b = window.setInterval(loadHistory, 5000)
    return () => { window.clearInterval(a); window.clearInterval(b) }
  }, [loadStations, loadHistory])

  const online = useMemo(() => (stations || []).filter(s => s.online), [stations])
  const active = online.find(s => s.id === chosen) || online[0] || null

  const removeStation = async (s: Station) => {
    if (!(await confirmDialog({ title: `Отвязать помощник «${s.name}»?`, message: 'Его токен перестанет работать. Чтобы подключить Mac снова, получите новую команду настройки.', confirmLabel: 'Отвязать' }))) return
    const res = await api(`/stations/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Помощник отвязан', 'success'); loadStations()
  }
  const removeSession = async (s: Session) => {
    if (!(await confirmDialog({ title: 'Удалить запись из истории?', message: `${s.device_model || 'iPhone'} · ${new Date(s.created_at).toLocaleString('ru-RU')}`, confirmLabel: 'Удалить' }))) return
    const res = await api(`/sessions/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Удалено', 'success'); setOpenSession(null); loadHistory()
  }
  const stationName = (id: string | null) => (stations || []).find(s => s.id === id)?.name || '—'
  const status = stations === null ? 'checking' : active ? 'online' : 'offline'

  return (
    <div data-installs-section data-helper-status={status}>
      {order && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-yellow-400/40 bg-yellow-400/[0.06] px-4 py-3 text-sm" data-cable-order={order.number}>
          <span className="font-medium text-white">Ставим по заказу №{order.number}</span>
          <span className="min-w-0 flex-1 text-slate-300">{order.apps.map(a => a.name).join(', ')}</span>
          <button type="button" onClick={onLeaveOrder} className={BTN_ROW}>Без заказа</button>
        </div>
      )}
      {status === 'checking' ? (
        <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Ищем помощника…</div>
      ) : status === 'offline' ? (
        <HelperOffline stations={stations || []} onSetup={() => setSetupModal(true)} />
      ) : active ? (
        <>
          {online.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              На связи несколько Mac:
              {online.map(s => <button key={s.id} type="button" onClick={() => setChosen(s.id)} className={`rounded-full px-3 py-1 text-sm ${s.id === active.id ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>{s.name}</button>)}
            </div>
          )}
          <Console api={api} station={active} order={order} onOrderChanged={onOrderChanged} />
        </>
      ) : null}

      <details className="mt-8 group" open={sessions.length > 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
          <AdminIcon name="clock" className="h-4 w-4" />История установок{stats ? <span className="font-normal normal-case tracking-normal text-slate-500">· сегодня {stats.installed_today}, за месяц {stats.installed_month}</span> : null}
          <span className="ml-auto text-xs text-slate-600 group-open:hidden">показать</span>
        </summary>
        <div className="mt-3">
          {sessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">Пока ни одной установки. Запись появится сама после первой установки.</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="hidden w-full text-sm md:table">
                <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="p-3">Когда</th><th className="p-3">iPhone</th><th className="p-3">Приложения</th><th className="p-3">Итог</th></tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const ok = s.apps.filter(a => a.status === 'installed').length
                    return (
                      <tr key={s.id} data-install-session={s.id} onClick={() => setOpenSession(s)} className="cursor-pointer border-t border-white/[0.06] transition hover:bg-white/[0.04]">
                        <td className="p-3 text-slate-300">{new Date(s.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}<div className="text-[11px] text-slate-500">{timeAgo(s.created_at)}</div></td>
                        <td className="p-3 text-white">{s.device_model || 'iPhone'}{s.ios_version ? <div className="text-xs text-slate-500">iOS {s.ios_version}</div> : null}</td>
                        <td className="p-3"><div className="flex flex-wrap gap-1">{s.apps.map(a => <span key={a.bundle_id} className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'installed' ? 'bg-emerald-500/15 text-emerald-300' : a.status === 'not_owned' ? 'bg-yellow-400/15 text-yellow-300' : 'bg-white/10 text-slate-300'}`}>{resolveApp(a).name}{a.version ? ` ${a.version}` : ''}</span>)}</div></td>
                        <td className="p-3"><Badge map={SESSION_STATUS} value={s.status} /><div className="mt-1 text-xs text-slate-500">{ok} из {s.apps.length}{(stations || []).length > 1 ? ` · ${stationName(s.station_id)}` : ''}</div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="divide-y divide-white/[0.06] md:hidden">
                {sessions.map(s => (
                  <button key={s.id} type="button" onClick={() => setOpenSession(s)} className="block w-full p-4 text-left">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-white">{s.device_model || 'iPhone'}</span><Badge map={SESSION_STATUS} value={s.status} /></div>
                    <div className="mt-0.5 text-xs text-slate-400">{new Date(s.created_at).toLocaleString('ru-RU')}</div>
                    <div className="mt-2 flex flex-wrap gap-1">{s.apps.map(a => <span key={a.bundle_id} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{resolveApp(a).name}</span>)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>

      <details className="mt-6 group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
          <AdminIcon name="zap" className="h-4 w-4" />Помощник на Mac
          <span className="font-normal normal-case tracking-normal text-slate-500">· {online.length ? `на связи: ${online.map(s => s.name).join(', ')}` : 'не на связи'}</span>
          <span className="ml-auto text-xs text-slate-600 group-open:hidden">показать</span>
        </summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className={CARD}>
            <div className="text-sm font-semibold text-white">Настроить ещё один Mac</div>
            <SetupSteps onSetup={() => setSetupModal(true)} />
          </div>
          <div className={CARD}>
            <div className="text-sm font-semibold text-white">Подключённые Mac</div>
            {(stations || []).length === 0 ? <p className="mt-3 text-sm text-slate-500">Пока ни одного.</p> : (
              <ul className="mt-3 space-y-2">
                {(stations || []).map(s => (
                  <li key={s.id} data-station={s.id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <span className="min-w-0 flex-1 truncate text-white">{s.name}<span className="ml-2 text-xs text-slate-500">{s.online ? 'на связи' : s.last_seen_at ? `был на связи ${timeAgo(s.last_seen_at)}` : 'ещё не выходил на связь'}{s.version ? ` · v${s.version}` : ''}</span></span>
                    <button type="button" onClick={() => removeStation(s)} aria-label={`Отвязать ${s.name}`} className={`${BTN_ROW} text-red-300`}><AdminIcon name="trash" className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>

      {openSession && (
        <Modal title={`${openSession.device_model || 'iPhone'} · ${new Date(openSession.created_at).toLocaleString('ru-RU')}`} onClose={() => setOpenSession(null)}>
          <div className="text-sm text-slate-300">{openSession.ios_version ? `iOS ${openSession.ios_version} · ` : ''}<Badge map={SESSION_STATUS} value={openSession.status} />{(stations || []).length > 1 ? <span className="text-slate-500"> · {stationName(openSession.station_id)}</span> : null}</div>
          <ul className="mt-3 space-y-1.5">
            {openSession.apps.map(a => {
              const r = resolveApp(a)
              return (
                <li key={a.bundle_id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                  <AppIcon app={r} size={32} />
                  <span className="min-w-0 flex-1"><span className="text-white">{r.name}</span>{a.version ? <span className="ml-1 text-xs text-slate-500">{a.version}</span> : null}<div className="truncate text-[11px] text-slate-500">{a.bundle_id}</div>{a.error ? <div className="text-xs text-red-300/90">{a.error}</div> : null}</span>
                  <Badge map={APP_STATUS} value={a.status} />
                </li>
              )
            })}
          </ul>
          {openSession.log.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-slate-400">
              {openSession.log.map((l, i) => <div key={i}>{new Date(l.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {l.msg}</div>)}
            </div>
          )}
          <div className="mt-4 flex justify-end"><button type="button" onClick={() => removeSession(openSession)} className={`${BTN_ROW} text-red-300`}>Удалить запись</button></div>
        </Modal>
      )}
      {setupModal && <SetupModal api={api} onClose={() => setSetupModal(false)} onCreated={loadStations} />}
    </div>
  )
}

// ── Помощник не на связи: что сделать ────────────────────────────────────────
function SetupSteps({ onSetup }: { onSetup: () => void }) {
  return (
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-slate-300">
      <li>Один раз поставить утилиты (Терминал на Mac):<div className="mt-1"><Cmd text={BREW_CMD} /></div></li>
      <li>Получить команду настройки и выполнить её в Терминале — она скачает помощник, привяжет его к админке и включит автозапуск при входе в macOS.<div className="mt-2"><button type="button" onClick={onSetup} className={BTN_PRIMARY} data-setup-btn><AdminIcon name="zap" className="h-4 w-4" />Получить команду для Mac</button></div></li>
      <li>Вернуться сюда: как только помощник выйдет на связь, раздел покажет подключённый iPhone.</li>
    </ol>
  )
}

function HelperOffline({ stations, onSetup }: { stations: Station[]; onSetup: () => void }) {
  const known = stations.filter(s => s.last_seen_at)
  return (
    <div data-helper-offline className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className={`${CARD} border-yellow-400/25 bg-yellow-400/[0.04]`}>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-400/15 text-yellow-300"><PhoneGlyph className="h-6 w-6" /></span>
          <div>
            <div className="text-lg font-semibold text-white">Помощник на Mac не на связи</div>
            <div className="text-sm text-slate-400">Он видит iPhone по кабелю и ставит приложения. Как только он выйдет на связь, здесь появится консоль.</div>
          </div>
        </div>
        {known.length > 0 ? (
          <div className="mt-4 rounded-xl bg-black/30 p-3 text-sm text-slate-300">
            {known.map(s => <div key={s.id}>{s.name}: был на связи {timeAgo(s.last_seen_at)}</div>)}
            <div className="mt-2 text-xs text-slate-500">Помощник стартует сам при входе в macOS и сам обновляется. Если Mac включён, а связи нет — в Терминале: <code className="rounded bg-black/40 px-1.5 py-0.5 text-yellow-100">python3 ~/takesmart_station.py --autostart</code></div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl bg-black/30 p-3 text-sm text-slate-300">Ни один Mac ещё не подключён. Настройка занимает пару минут — шаги справа.</div>
        )}
      </div>
      <div className={CARD}>
        <div className="text-sm font-semibold text-white">Настройка Mac</div>
        <SetupSteps onSetup={onSetup} />
      </div>
    </div>
  )
}

function SetupModal({ api, onClose, onCreated }: { api: Api; onClose: () => void; onCreated: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const res = await api('/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Помощник' }) })
        if (!res.ok) { setError(await readError(res)); return }
        setToken((await res.json()).token); onCreated()
      } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сети') }
    })()
  }, [api, onCreated])
  return (
    <Modal title="Команда для Mac" onClose={onClose}>
      {error ? <p className="text-sm text-red-300">{error}</p> : !token ? <p className="text-sm text-slate-400">Готовим команду…</p> : (
        <div className="space-y-3 text-sm text-slate-300">
          <p>Выполните в Терминале на том Mac, к которому будут подключать iPhone. Команда показывается <b className="text-white">только сейчас</b> — внутри неё ключ этого Mac.</p>
          <div data-setup-command><Cmd text={setupCommand(token)} /></div>
          <p className="text-xs text-slate-500">Помощник скачается, привяжется к админке и будет запускаться сам при входе в macOS. Дальше он обновляется сам с сайта. Имя Mac появится в списке само.</p>
          <div className="flex justify-end"><button type="button" onClick={onClose} className={BTN_PRIMARY}>Готово</button></div>
        </div>
      )}
    </Modal>
  )
}

// ── Консоль: iPhone → Apple ID → приложения ──────────────────────────────────
function useConsole(api: Api, stationId: string) {
  const [data, setData] = useState<ConsoleData | null>(null)
  const purchasesRef = useRef<{ version: number; list: Purchase[] }>({ version: -1, list: [] })
  const refresh = useCallback(async () => {
    try {
      const known = purchasesRef.current
      const r = await api(`/stations/${stationId}/console${known.version >= 0 ? `?pv=${known.version}` : ''}`)
      if (!r.ok) return
      const d: ConsoleData = await r.json()
      if (d.purchases !== null && d.purchases !== undefined) purchasesRef.current = { version: d.purchases_version, list: d.purchases }
      else if (d.purchases_version !== known.version) purchasesRef.current = { version: -1, list: known.list }  // версия ушла вперёд — дозапросим
      setData({ ...d, purchases: purchasesRef.current.list })
    } catch { /* сеть */ }
  }, [api, stationId])
  useEffect(() => {
    setData(null); refresh()
    const id = window.setInterval(refresh, CONSOLE_POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])
  const send = useCallback(async (type: CommandType, payload: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const r = await api(`/stations/${stationId}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload }) })
      if (!r.ok) { toast(await readError(r), 'error'); return false }
      return true
    } catch { toast('Нет связи с сервером', 'error'); return false }
  }, [api, stationId])
  return { data, refresh, send }
}

function Console({ api, station, order, onOrderChanged }: { api: Api; station: Station; order: InstallOrder | null; onOrderChanged: () => void }) {
  const { data, send } = useConsole(api, station.id)
  const lastNotice = useRef<number>(0)
  const c = data?.console || {}
  // Что стояло в консоли в момент, когда к ней привязали заказ: ту установку в заказ не засчитываем
  const baseline = useRef<{ orderId: string; sid: string | null } | null>(null)
  const marked = useRef<string | null>(null)
  const sessionKey = c.session ? c.session.id || c.session.started : null
  const sessionFinished = Boolean(c.session?.finished)
  useEffect(() => {
    if (!order) { baseline.current = null; return }
    if (!data || baseline.current?.orderId === order.id) return
    baseline.current = { orderId: order.id, sid: sessionKey }
  }, [order, data, sessionKey])
  useEffect(() => {
    const s = c.session
    if (!order || !s || !sessionFinished || !sessionKey) return
    if (baseline.current?.orderId !== order.id || baseline.current.sid === sessionKey) return
    const mark = `${order.id}:${sessionKey}`
    if (marked.current === mark) return
    marked.current = mark
    const done = new Set(s.apps.filter(a => a.status === 'installed').map(a => a.bundle_id))
    const targets = order.apps.filter(a => done.has(a.bundle_id))
    if (!targets.length) return
    ;(async () => {
      let n = 0
      for (const a of targets) {
        try {
          const r = await api(`/orders/${order.id}/apps/${a.key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'installed' }) })
          if (r.ok) n++
        } catch { /* сеть: отметят вручную в карточке заказа */ }
      }
      if (n) { toast(`В заказе №${order.number} отмечено установленным: ${n}`, 'success'); onOrderChanged() }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, sessionKey, sessionFinished])
  const preselect = useMemo(() => (order ? { key: order.id, number: order.number, apps: order.apps.map(a => ({ bundle_id: a.bundle_id, name: a.name })) } : null), [order])
  useEffect(() => {
    const n = c.notice
    if (n && n.t !== lastNotice.current) { lastNotice.current = n.t; toast(n.message, n.tone === 'error' ? 'error' : 'info') }
  }, [c.notice])

  const device = station.state?.device || null
  const phoneReady = Boolean(device?.paired)
  const loggedIn = Boolean(station.state?.apple?.logged_in)
  const session = c.session || null
  const steps = [
    { n: 1, label: phoneReady ? `${device?.model || 'iPhone'} подключён` : device ? 'Подтвердите доверие на iPhone' : 'Подключите iPhone кабелем', done: phoneReady },
    { n: 2, label: loggedIn ? 'Apple ID введён' : 'Введите Apple ID', done: loggedIn },
    { n: 3, label: session ? (session.finished ? 'Установка завершена' : 'Идёт установка') : 'Выберите приложения и установите', done: false },
  ]
  return (
    <div data-console data-station-id={station.id}>
      <ol className="mb-5 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => {
          const isActive = !s.done && steps.slice(0, i).every(x => x.done)
          return (
            <li key={s.n} data-step={s.n} data-done={s.done ? '1' : '0'} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${s.done ? 'border-emerald-400/30 bg-emerald-400/[0.06]' : isActive ? 'border-yellow-400/40 bg-yellow-400/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? 'bg-emerald-400 text-slate-950' : isActive ? 'bg-yellow-400 text-slate-950' : 'bg-white/10 text-slate-400'}`}>{s.done ? <AdminIcon name="check" className="h-4 w-4" /> : s.n}</span>
              <span className={`text-sm font-medium ${s.done ? 'text-emerald-200' : isActive ? 'text-white' : 'text-slate-400'}`}>{s.label}</span>
            </li>
          )
        })}
      </ol>

      {(c.tools_missing || []).length > 0 && (
        <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/[0.06] p-4 text-sm text-red-200">
          На Mac «{station.name}» не найдены утилиты: {(c.tools_missing || []).join(', ')}. Поставьте их в Терминале и перезапустите помощник:
          <div className="mt-2"><Cmd text={BREW_CMD} /></div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <DeviceCard device={device} installedCount={Object.keys(c.installed || {}).length} owners={c.owners || []} currentEmail={station.state?.apple?.email || null} />
          <AppleIdCard station={station} c={c} purchasesCount={data?.purchases?.length ?? null} send={send} />
        </div>
        <div className="min-w-0">
          {session ? <InstallProgress session={session} device={device} send={send} /> : loggedIn ? <AppPicker c={c} purchases={data?.purchases || []} phoneReady={phoneReady} send={send} currentEmail={station.state?.apple?.email || null} preselect={preselect} /> : <PickerPlaceholder history={c.history || []} />}
        </div>
      </div>
    </div>
  )
}

function DeviceCard({ device: d, installedCount, owners, currentEmail }: { device: Device | null; installedCount: number; owners: NonNullable<HelperConsole['owners']>; currentEmail: string | null }) {
  return (
    <div className={CARD} data-device-card>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">iPhone</div>
      {!d ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] text-slate-400"><PhoneGlyph className="h-6 w-6" /></span>
            <div className="text-lg font-semibold text-slate-300">Не подключён</div>
          </div>
          <p className="mt-2 text-sm text-slate-400">Подключите iPhone покупателя кабелем к Mac и разблокируйте его. На экране телефона появится «Доверять этому компьютеру?» — нажмите «Доверять».</p>
        </>
      ) : !d.paired ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-400/15 text-yellow-300"><PhoneGlyph className="h-6 w-6" /></span>
            <div className="text-lg font-semibold text-yellow-200">Нажмите «Доверять» на iPhone</div>
          </div>
          <p className="mt-2 text-sm text-slate-400">Телефон виден, но ещё не доверяет этому Mac. Разблокируйте его и подтвердите доверие кодом-паролем.</p>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300"><PhoneGlyph className="h-6 w-6" /></span>
            <div><div className="text-lg font-semibold text-white">{d.model || 'iPhone'}</div><div className="text-sm text-slate-400">iOS {d.ios_version || '?'}{d.name ? ` · ${d.name}` : ''}</div></div>
          </div>
          <div className="mt-3 text-sm text-slate-400">На телефоне {installedCount} приложений</div>
          {owners.length > 0 && (
            <div className="mt-2 space-y-1 text-xs text-slate-400" data-owners>
              <div className="text-slate-500">Скачаны с Apple ID:</div>
              {owners.map((o, i) => {
                const foreign = Boolean(currentEmail && o.owner && o.owner !== currentEmail)
                return (
                  <div key={i} className={foreign ? 'text-yellow-200' : ''}>
                    <span className="font-medium">{o.owner || (o.dsid ? `аккаунт ${o.dsid}` : 'неизвестно')}</span> · {o.count} шт.{foreign ? ' · это другой Apple ID' : currentEmail && o.owner === currentEmail ? ' · тот, что введён' : ''}
                    {foreign && o.apps.length > 0 && <div className="text-slate-500">{o.apps.slice(0, 6).join(', ')}{o.apps.length > 6 ? '…' : ''}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AppleIdCard({ station, c, purchasesCount, send }: { station: Station; c: HelperConsole; purchasesCount: number | null; send: (t: CommandType, p?: Record<string, unknown>) => Promise<boolean> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const l = c.login || { status: 'idle' as const, message: null }
  const working = l.status === 'working' || sending
  const codeStep = l.status === 'need_code' || (l.status === 'working' && l.pending)
  const apple = station.state?.apple || {}
  useEffect(() => { if (!sending) return; const t = window.setTimeout(() => setSending(false), 2500); return () => window.clearTimeout(t) }, [sending])

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setSending(true)
    if (await send('login', { email: email.trim(), password })) setPassword('')
    else setSending(false)
  }
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setSending(true)
    if (await send('code', { code: code.trim() })) setCode('')
    else setSending(false)
  }

  return (
    <div className={CARD} data-apple-card>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Apple ID</div>
      {apple.logged_in ? (
        <>
          <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-white"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />{apple.name || 'Вход выполнен'}</div>
          {apple.email && <div className="text-sm text-slate-400">{apple.email}</div>}
          <div className="mt-2 text-sm text-slate-400">{c.purchases_loading ? 'Читаем историю покупок…' : purchasesCount !== null ? `В истории покупок: ${purchasesCount}` : ''}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => send('logout')} className={BTN_SECONDARY}>Выйти из Apple ID</button>
            <button type="button" onClick={() => send('refresh_purchases')} className={BTN_ROW}>Обновить список</button>
          </div>
          <div className="mt-3" data-auto-logout={c.auto_logout === false ? '0' : '1'}>
            <Toggle checked={c.auto_logout !== false} onChange={v => send('settings', { auto_logout: v })} label="Выходить из Apple ID после установки"
              hint={c.auto_logout === false ? 'Помощник остаётся в аккаунте — удобно для Apple ID салона. Скачанные файлы удаляются всегда.' : 'Для Apple ID покупателя оставьте включённым. Для аккаунта салона выключите — не придётся входить заново.'} />
          </div>
        </>
      ) : codeStep ? (
        <form onSubmit={sendCode} className="mt-2">
          <p className="text-sm text-slate-300">Apple прислала 6‑значный код. Он приходит <b className="text-white">не на почту</b>: всплывает на устройствах, где выполнен вход в этот Apple ID (iPhone, iPad, Mac), или приходит по SMS на доверенный номер.</p>
          <input id="helper-code" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Код подтверждения" className={`${INPUT} mt-3`} autoFocus />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={working || !code.trim()} className={BTN_PRIMARY}>{working ? 'Проверяем код…' : 'Подтвердить код'}</button>
            <button type="button" disabled={working} onClick={() => { setSending(true); send('resend_code').then(okk => { if (!okk) setSending(false) }) }} className={BTN_SECONDARY} data-resend-code>Отправить код ещё раз</button>
            <button type="button" onClick={() => send('reset_login')} className="text-sm text-slate-400 hover:text-white">Другой Apple ID</button>
          </div>
          {l.message && l.status !== 'working' && <p className="mt-2 text-xs text-yellow-200">{l.message}</p>}
          <p className="mt-2 text-xs text-slate-500">Код нигде не появился? Чаще всего это ошибка в почте или пароле: Apple в таком случае всё равно спрашивает код, но не присылает его. Нажмите «Другой Apple ID» и введите данные заново. Если данные точно верные — «Отправить код ещё раз» и проверьте уведомления на разблокированном телефоне.</p>
        </form>
      ) : (
        <form onSubmit={login} className="mt-2">
          <p className="text-sm text-slate-400">Apple ID, в истории покупок которого есть нужные приложения: аккаунт салона или самого покупателя. Пароль и код передаются помощнику на Mac и уходят в Apple — у нас не сохраняются.</p>
          <input id="helper-email" value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="off" placeholder="Apple ID (почта)" className={`${INPUT} mt-3`} />
          <input id="helper-password" value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="off" placeholder="Пароль" className={`${INPUT} mt-2`} />
          <button type="submit" disabled={working || !email.trim() || !password} className={`${BTN_PRIMARY} mt-3`}>{working ? 'Связываемся с Apple…' : 'Войти'}</button>
          {l.message && l.status === 'error' && <p className="mt-2 text-sm text-red-300">{l.message}</p>}
        </form>
      )}
    </div>
  )
}

function PickerPlaceholder({ history }: { history: HistoryItem[] }) {
  const last = history[0]
  return (
    <div className={`${CARD} flex min-h-[260px] flex-col`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Что поставить</div>
      <div className="mt-2 text-lg font-semibold text-slate-300">Сначала Apple ID</div>
      <p className="mt-1 max-w-xl text-sm text-slate-400">После входа здесь появится всё, что когда-либо было на этом аккаунте: банки, госуслуги, соцсети, авиакомпании. Отмечаете нужное — и «Установить».</p>
      {last && (
        <div className="mt-auto rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-sm" data-last-result>
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Последняя установка · {last.t}{last.device ? ` · ${last.device}` : ''}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {last.apps.map((a, i) => <span key={i} className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'installed' ? 'bg-emerald-500/15 text-emerald-200' : a.status === 'not_owned' ? 'bg-yellow-400/15 text-yellow-200' : 'bg-white/10 text-slate-300'}`}>{a.name}{a.version ? ` ${a.version}` : ''} — {(APP_STATUS[a.status]?.label || a.status).toLowerCase()}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

type Preselect = { key: string; number: number; apps: { bundle_id: string; name: string }[] } | null

function AppPicker({ c, purchases, phoneReady, send, currentEmail, preselect }: { c: HelperConsole; purchases: Purchase[]; phoneReady: boolean; send: (t: CommandType, p?: Record<string, unknown>) => Promise<boolean>; currentEmail: string | null; preselect: Preselect }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'bank'>('all')
  const [hideInstalled, setHideInstalled] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [manual, setManual] = useState('')
  const [starting, setStarting] = useState(false)
  const installed = c.installed || {}
  useEffect(() => { if (!starting) return; const t = window.setTimeout(() => setStarting(false), 4000); return () => window.clearTimeout(t) }, [starting])
  // Пришли из карточки заказа — его приложения отмечаются сами, как только прочитана история покупок
  const [appliedKey, setAppliedKey] = useState<string | null>(null)
  if (preselect && purchases.length && appliedKey !== preselect.key) {
    setAppliedKey(preselect.key)
    const have = new Set(purchases.map(p => p.bundle_id))
    setSelected(new Set(preselect.apps.map(a => a.bundle_id).filter(b => have.has(b))))
  }
  const missingFromOrder = useMemo(() => {
    if (!preselect || !purchases.length) return []
    const have = new Set(purchases.map(p => p.bundle_id))
    return preselect.apps.filter(a => !have.has(a.bundle_id))
  }, [preselect, purchases])

  const items = useMemo(() => purchases.map(p => ({ p, r: resolveApp(p), have: installed[p.bundle_id] })), [purchases, installed])
  const foreignBanks = useMemo(() => Object.entries(installed)
    .filter(([bundle, info]) => resolveApp({ name: info.name, bundle_id: bundle }).bank && Boolean(info.owner || info.dsid) && (!currentEmail || info.owner !== currentEmail))
    .map(([, info]) => info), [installed, currentEmail])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(({ p, r, have }) => {
      if (needle && !`${r.name} ${p.name} ${p.bundle_id}`.toLowerCase().includes(needle)) return false
      if (filter === 'bank' && !r.bank) return false
      if (hideInstalled && have) return false
      return true
    })
  }, [items, q, filter, hideInstalled])

  const toggle = (bundle: string) => setSelected(prev => { const n = new Set(prev); if (n.has(bundle)) n.delete(bundle); else n.add(bundle); return n })
  const install = async () => {
    const apps = purchases.filter(p => selected.has(p.bundle_id)).map(p => ({ bundle_id: p.bundle_id, name: resolveApp(p).name, id: p.id }))
    if (!apps.length) return
    setStarting(true)
    if (await send('install', { apps })) setSelected(new Set()); else setStarting(false)
  }
  const installManual = async () => {
    const v = manual.trim()
    if (!v) return
    const isId = /^\d+$/.test(v)
    setStarting(true)
    if (await send('install', { apps: [isId ? { id: Number(v), name: `App Store #${v}` } : { bundle_id: v, name: v }] })) setManual(''); else setStarting(false)
  }
  const canInstall = phoneReady && selected.size > 0 && !starting

  return (
    <div className={`${CARD} flex flex-col`} data-app-picker>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">История покупок аккаунта <span className="font-normal normal-case tracking-normal text-slate-500">· {visible.length} из {purchases.length}</span></div>
        <button type="button" onClick={install} disabled={!canInstall} data-install-btn className={`${BTN_PRIMARY} ml-auto`}>
          <AdminIcon name="check" className="h-4 w-4" />{starting ? 'Запускаем…' : selected.size ? `Установить (${selected.size})` : 'Установить'}
        </button>
      </div>
      {!phoneReady && selected.size > 0 && <p className="mt-2 text-xs text-yellow-200">Подключите iPhone, чтобы установить выбранное.</p>}
      {missingFromOrder.length > 0 && <p className="mt-2 text-xs text-yellow-200" data-order-missing>В истории покупок этого Apple ID нет приложений из заказа №{preselect?.number}: {missingFromOrder.map(a => a.name).join(', ')}. Войдите в аккаунт салона, с которого оформлен заказ.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Поиск: Сбер, Т-Банк, ВК…" data-app-search className={`${INPUT} sm:max-w-xs`} />
        {([['all', 'Все'], ['bank', 'Банки']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} data-filter={k} className={`rounded-full px-3 py-1.5 text-sm transition ${filter === k ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>{label}</button>
        ))}
        <button type="button" onClick={() => setHideInstalled(v => !v)} className={`rounded-full px-3 py-1.5 text-sm transition ${hideInstalled ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>Скрыть уже установленные</button>
      </div>

      <div className="mt-3 max-h-[62vh] overflow-auto pr-1">
        {purchases.length === 0 && c.purchases_loading ? (
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/[0.05]" />)}</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
            {purchases.length === 0 ? (c.purchases_loading ? 'Читаем историю покупок…' : 'В истории покупок этого Apple ID пусто для iPhone') : filter === 'bank' && !q.trim() ? (
              <>В истории покупок этого Apple ID банков нет.<br /><span className="text-slate-600">Вернуть банк можно только с того Apple ID, на котором он когда-то стоял: Apple убрала эти приложения из App Store, и взять их больше неоткуда. Спросите покупателя про старый Apple ID.</span>
                {foreignBanks.length > 0 && <div className="mt-2 text-yellow-200">На телефоне уже стоят {foreignBanks.map(b => b.name).join(', ')} — скачаны с другого Apple ID ({foreignBanks[0].owner || 'аккаунт ' + foreignBanks[0].dsid}). Войдите под ним.</div>}</>
            ) : 'Ничего не найдено'}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {visible.map(({ p, r, have }) => {
              const on = selected.has(p.bundle_id)
              return (
                <button key={p.bundle_id} type="button" onClick={() => toggle(p.bundle_id)} aria-pressed={on} data-app-tile={p.bundle_id} data-selected={on ? '1' : '0'}
                  className={`relative flex w-full min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-yellow-400/70 bg-yellow-400/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'}`}>
                  <AppIcon app={r} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">{r.name}</span>
                    <span className="block truncate text-xs text-slate-500">{have ? <span className="text-slate-300">уже стоит {have.version}</span> : p.version ? `версия ${p.version}` : p.bundle_id}</span>
                  </span>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${on ? 'border-yellow-400 bg-yellow-400 text-slate-950' : 'border-white/20 text-transparent'}`}><AdminIcon name="check" className="h-3.5 w-3.5" /></span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-slate-500">Не видно в списке? Поставить по App Store ID или Bundle ID</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="например 492224193 или ru.sberbankmobile" data-manual-id className={`${INPUT} sm:max-w-sm`} />
          <button type="button" onClick={installManual} disabled={!phoneReady || !manual.trim() || starting} data-manual-btn className={BTN_SECONDARY}>Поставить</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Сработает, только если приложение есть в истории покупок этого Apple ID или ещё доступно в App Store.</p>
      </details>
    </div>
  )
}

function InstallProgress({ session: s, device, send }: { session: NonNullable<HelperConsole['session']>; device: Device | null; send: (t: CommandType, p?: Record<string, unknown>) => Promise<boolean> }) {
  const running = s.status === 'running' && !s.finished
  const done = s.apps.filter(a => a.status === 'installed').length
  const failed = s.apps.filter(a => a.status === 'failed' || a.status === 'not_owned').length
  const title = running ? `Ставим на ${device?.model || 'iPhone'}…` : done === s.apps.length ? `Готово: установлено ${done} из ${s.apps.length}` : done > 0 ? `Установлено ${done} из ${s.apps.length}` : 'Не установлено'
  return (
    <div className={`${CARD} ${!running && failed ? 'border-red-400/30' : ''}`} data-install-progress data-finished={s.finished ? '1' : '0'}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Установка</div>
      <div className="mt-1 flex items-center gap-3">
        {running && <span className="h-3 w-3 animate-pulse rounded-full bg-sky-400" />}
        <div className={`text-lg font-semibold ${!running && failed && !done ? 'text-red-200' : 'text-white'}`}>{title}</div>
      </div>
      {!running && failed > 0 && <p className="mt-2 text-sm text-slate-300">Причина у каждого приложения подписана ниже. Вход в Apple ID сохранён — можно выбрать другое приложение или повторить.</p>}
      <ul className="mt-4 space-y-2">
        {s.apps.map(a => {
          const r = resolveApp(a)
          return (
            <li key={a.bundle_id} data-progress-app={a.bundle_id} data-status={a.status} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
              <AppIcon app={r} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{r.name}{a.version ? <span className="ml-1 text-xs text-slate-500">{a.version}</span> : null}</span>{a.error ? <span className="block text-xs text-red-300/90">{a.error}</span> : a.status === 'downloading' && a.progress ? <span className="block text-xs text-sky-300/80">скачано {a.progress}</span> : null}</span>
              <Badge map={APP_STATUS} value={a.status} />
            </li>
          )
        })}
      </ul>
      {running ? (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={() => send('cancel')} className={BTN_SECONDARY}>Остановить после текущего</button>
          <span className="text-xs text-slate-500">Не отключайте iPhone до конца установки.</span>
        </div>
      ) : (
        <>
          {done > 0 && <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-slate-400">Если приложения куплены не с Apple ID покупателя: при первом запуске iPhone попросит пароль того Apple ID, с которого они куплены. Введите его, а потом проверьте в App Store, что в профиле снова аккаунт покупателя.</p>}
          <div className="mt-4"><button type="button" onClick={() => send('dismiss_session')} data-dismiss-session className={BTN_PRIMARY}>Готово</button></div>
        </>
      )}
    </div>
  )
}
