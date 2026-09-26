import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { timeAgo } from './format'
import { rankSearch } from '../../lib/searchRank'

// ─────────────────────────────────────────────────────────────────────────────
// Раздел «Приложения на iPhone»: заявки покупателей, станция (Mac в павильоне),
// каталог приложений и цены. Сотрудник выбирает заявку, отмечает приложения,
// жмёт «Отправить на станцию» — дальше станция ведёт установку и отчитывается
// сюда по шагам. Apple ID покупателя вводится только на самой станции.
// ─────────────────────────────────────────────────────────────────────────────

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface IphoneApp {
  id: string; name: string; bundle_id: string; app_store_id: number | null; category: string
  price: number | string; description: string | null; icon_url: string | null; is_active: boolean; sort_order: number
}
interface RequestApp { app_id: string; name: string; bundle_id: string; price: number }
export interface InstallRequest {
  id: string; request_number: string; customer_name: string; customer_phone: string
  device_model: string | null; ios_version: string | null; apps: RequestApp[]; comment: string | null
  source: 'site' | 'counter' | string; status: 'new' | 'in_progress' | 'done' | 'cancelled' | string
  staff_note: string | null; created_at: string; updated_at: string
}
interface JobApp { bundle_id: string; name: string; price: number; status: string; version: string | null; error: string | null }
interface InstallJob {
  id: string; request_id: string; station_id: string | null; status: string; apps: JobApp[]
  device_udid: string | null; device_model: string | null; ios_version: string | null
  log: { t: string; msg: string }[]; created_at: string; started_at: string | null; finished_at: string | null
}
interface StationState { device?: { udid?: string; model?: string; ios_version?: string; name?: string; paired?: boolean } | null; apple?: { logged_in?: boolean; purchases_count?: number | null } | null; busy?: boolean }
interface Station { id: string; name: string; version: string | null; last_seen_at: string | null; state: StationState; is_active: boolean; online: boolean; created_at: string }
interface Stats { new_requests: number; in_progress: number; done_total: number; installed_today: number; installed_month: number; revenue_month: number | string; stations_online: number }

const INPUT = 'w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-yellow-400/60 focus:bg-white/10 focus:outline-none'
const BTN_ROW = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20 disabled:opacity-50'
const CATEGORY_LABEL: Record<string, string> = { bank: 'Банк', messenger: 'Мессенджер', social: 'Соцсеть', service: 'Сервис', other: 'Другое' }
const REQUEST_STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'Новая', cls: 'bg-yellow-400/15 text-yellow-300' },
  in_progress: { label: 'В работе', cls: 'bg-sky-500/15 text-sky-300' },
  done: { label: 'Готово', cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Отменена', cls: 'bg-white/10 text-slate-400' },
}
const APP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'В очереди', cls: 'bg-white/10 text-slate-300' },
  downloading: { label: 'Скачиваем', cls: 'bg-sky-500/15 text-sky-300' },
  installing: { label: 'Ставим', cls: 'bg-sky-500/15 text-sky-300' },
  installed: { label: 'Установлено', cls: 'bg-emerald-500/15 text-emerald-300' },
  not_owned: { label: 'Нет в покупках', cls: 'bg-yellow-400/15 text-yellow-300' },
  failed: { label: 'Ошибка', cls: 'bg-red-500/15 text-red-300' },
  skipped: { label: 'Пропущено', cls: 'bg-white/10 text-slate-400' },
}
const JOB_STATUS: Record<string, string> = { queued: 'в очереди станции', running: 'идёт установка', done: 'завершено', failed: 'ошибка станции', cancelled: 'отменено' }

const fmtRub = (v: number | string) => `${Math.round(Number(v) || 0).toLocaleString('ru-RU')} ₽`
const phoneHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`

async function readError(res: Response): Promise<string> {
  try {
    const d = await res.json()
    return typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x: { msg?: string }) => x.msg).join('; ') : `Ошибка ${res.status}`
  } catch { return `Ошибка ${res.status}` }
}

function Badge({ map, value }: { map: Record<string, { label: string; cls: string }>; value: string }) {
  const m = map[value] || { label: value, cls: 'bg-white/10 text-slate-300' }
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-slate-900 p-5 shadow-2xl ring-1 ring-white/10 sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"><AdminIcon name="x" className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════

export function InstallsSection({ authFetch }: { authFetch: AuthFetch }) {
  const [view, setView] = useState<'requests' | 'apps' | 'stations'>('requests')
  const [stats, setStats] = useState<Stats | null>(null)
  const [requests, setRequests] = useState<InstallRequest[]>([])
  const [apps, setApps] = useState<IphoneApp[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'active' | 'new' | 'in_progress' | 'done' | 'cancelled' | 'all'>('active')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [appEdit, setAppEdit] = useState<IphoneApp | 'new' | null>(null)
  const [stationOpen, setStationOpen] = useState(false)

  const api = useCallback((path: string, init?: RequestInit) => authFetch(`${API_BASE_URL}/api/installs${path}`, init), [authFetch])

  const loadAll = useCallback(async () => {
    try {
      const [s, r, a, st] = await Promise.all([
        api('/stats').then(x => x.ok ? x.json() : null),
        api('/requests?limit=300').then(x => x.ok ? x.json() : []),
        api('/apps/all').then(x => x.ok ? x.json() : []),
        api('/stations').then(x => x.ok ? x.json() : []),
      ])
      if (s) setStats(s)
      setRequests(r); setApps(a); setStations(st)
    } catch { /* сеть — покажем прошлое состояние */ }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => {
    loadAll()
    const id = window.setInterval(loadAll, 6000)
    return () => window.clearInterval(id)
  }, [loadAll])

  const filtered = useMemo(() => {
    let list = requests
    if (statusFilter === 'active') list = list.filter(r => r.status === 'new' || r.status === 'in_progress')
    else if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (query.trim()) list = rankSearch(list, query, r => `${r.customer_name} ${r.customer_phone} ${r.request_number} ${r.device_model || ''} ${r.apps.map(a => a.name).join(' ')}`)
    return list
  }, [requests, statusFilter, query])

  const selected = requests.find(r => r.id === selectedId) || null
  const onlineStations = stations.filter(s => s.online)

  return (
    <div data-installs-section>
      {/* Сводка */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Новые заявки" value={String(stats?.new_requests ?? '—')} tone={stats?.new_requests ? 'yellow' : 'plain'} icon="orders" />
        <StatCard label="В работе" value={String(stats?.in_progress ?? '—')} icon="clock" />
        <StatCard label="Установлено сегодня" value={String(stats?.installed_today ?? '—')} hint={`за месяц ${stats?.installed_month ?? '—'}`} icon="check" />
        <StatCard label="Выручка за месяц" value={stats ? fmtRub(stats.revenue_month) : '—'} icon="ruble" />
        <StatCard label="Станций в сети" value={`${stats?.stations_online ?? 0} из ${stations.length}`} tone={onlineStations.length ? 'green' : 'red'} icon="zap" hint={onlineStations[0]?.state?.device?.model ? `Подключён ${onlineStations[0].state.device?.model}` : (onlineStations.length ? 'iPhone не подключён' : 'Запустите станцию на Mac')} />
      </div>

      {/* Переключатель + действия */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-white/[0.06] p-1" role="tablist">
          {([['requests', 'Заявки'], ['apps', 'Приложения'], ['stations', 'Станции']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${view === id ? 'bg-yellow-400 text-slate-950' : 'text-slate-300 hover:text-white'}`}>
              {label}{id === 'requests' && stats?.new_requests ? <span className="ml-1.5 rounded-full bg-slate-950/20 px-1.5 text-xs">{stats.new_requests}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {view === 'requests' && <button type="button" onClick={() => setNewOpen(true)} className={BTN_PRIMARY}><AdminIcon name="plus" className="h-4 w-4" />Новая заявка</button>}
          {view === 'apps' && <button type="button" onClick={() => setAppEdit('new')} className={BTN_PRIMARY}><AdminIcon name="plus" className="h-4 w-4" />Добавить приложение</button>}
          {view === 'stations' && <button type="button" onClick={() => setStationOpen(true)} className={BTN_PRIMARY}><AdminIcon name="plus" className="h-4 w-4" />Добавить станцию</button>}
        </div>
      </div>

      {view === 'requests' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {([['active', 'Активные'], ['new', 'Новые'], ['in_progress', 'В работе'], ['done', 'Готово'], ['cancelled', 'Отменённые'], ['all', 'Все']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setStatusFilter(id)} className={`rounded-full px-3 py-1 text-sm ${statusFilter === id ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/15'}`}>{label}</button>
            ))}
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск: имя, телефон, номер, модель" aria-label="Поиск по заявкам" className={`${INPUT} ml-auto w-full sm:w-72`} />
          </div>
          {loading ? <p className="text-slate-400">Загружаем…</p> : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-slate-400">
              {requests.length === 0 ? 'Заявок пока нет. Первая придёт с сайта или создайте её у прилавка кнопкой «Новая заявка».' : 'По этому фильтру заявок нет'}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="hidden w-full text-sm md:table">
                <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="p-3">Заявка</th><th className="p-3">Покупатель</th><th className="p-3">iPhone</th><th className="p-3">Приложения</th><th className="p-3">Статус</th><th className="p-3 text-right">Когда</th></tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} data-install-request={r.id} onClick={() => setSelectedId(r.id)} className="cursor-pointer border-t border-white/[0.06] transition hover:bg-white/[0.04]">
                      <td className="p-3 font-mono text-xs text-slate-300">{r.request_number}<div className="text-[11px] text-slate-500">{r.source === 'site' ? 'с сайта' : 'у прилавка'}</div></td>
                      <td className="p-3"><div className="font-medium text-white">{r.customer_name}</div><div className="text-xs text-slate-400">{r.customer_phone}</div></td>
                      <td className="p-3 text-slate-300">{r.device_model || '—'}{r.ios_version ? <div className="text-xs text-slate-500">iOS {r.ios_version}</div> : null}</td>
                      <td className="p-3"><div className="flex flex-wrap gap-1">{r.apps.map(a => <span key={a.bundle_id} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{a.name}</span>)}</div></td>
                      <td className="p-3"><Badge map={REQUEST_STATUS} value={r.status} /></td>
                      <td className="p-3 text-right text-xs text-slate-400">{timeAgo(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="divide-y divide-white/[0.06] md:hidden">
                {filtered.map(r => (
                  <button key={r.id} type="button" onClick={() => setSelectedId(r.id)} className="block w-full p-4 text-left">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-white">{r.customer_name}</span><Badge map={REQUEST_STATUS} value={r.status} /></div>
                    <div className="mt-0.5 text-xs text-slate-400">{r.customer_phone} · {r.device_model || 'iPhone'} · {timeAgo(r.created_at)}</div>
                    <div className="mt-2 flex flex-wrap gap-1">{r.apps.map(a => <span key={a.bundle_id} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{a.name}</span>)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {view === 'apps' && <AppsTable apps={apps} api={api} onEdit={setAppEdit} onChanged={loadAll} />}
      {view === 'stations' && <StationsGrid stations={stations} api={api} onChanged={loadAll} onAdd={() => setStationOpen(true)} />}

      {selected && <RequestPanel request={selected} apps={apps} stations={stations} api={api} onClose={() => setSelectedId(null)} onChanged={loadAll} />}
      {newOpen && <NewRequestModal apps={apps} stations={stations} api={api} onClose={() => setNewOpen(false)} onCreated={(r) => { setNewOpen(false); loadAll(); setSelectedId(r.id) }} />}
      {appEdit && <AppModal app={appEdit === 'new' ? null : appEdit} api={api} onClose={() => setAppEdit(null)} onSaved={() => { setAppEdit(null); loadAll() }} />}
      {stationOpen && <NewStationModal api={api} onClose={() => setStationOpen(false)} onCreated={loadAll} />}
    </div>
  )
}

function StatCard({ label, value, hint, icon, tone = 'plain' }: { label: string; value: string; hint?: string; icon: 'orders' | 'clock' | 'check' | 'ruble' | 'zap'; tone?: 'plain' | 'yellow' | 'green' | 'red' }) {
  const toneCls = { plain: 'bg-white/10 text-slate-300', yellow: 'bg-yellow-400/15 text-yellow-300', green: 'bg-emerald-500/15 text-emerald-300', red: 'bg-red-500/15 text-red-300' }[tone]
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
        <span className={`rounded-lg p-1.5 ${toneCls}`}><AdminIcon name={icon} className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Карточка заявки: приложения, станция, ход установки
// ═════════════════════════════════════════════════════════════════════════════

function RequestPanel({ request, apps, stations, api, onClose, onChanged }: { request: InstallRequest; apps: IphoneApp[]; stations: Station[]; api: (p: string, i?: RequestInit) => Promise<Response>; onClose: () => void; onChanged: () => void }) {
  const [jobs, setJobs] = useState<InstallJob[]>([])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(request.apps.map(a => a.bundle_id)))
  const [stationId, setStationId] = useState<string>(() => stations.find(s => s.online)?.id || stations[0]?.id || '')
  const [note, setNote] = useState(request.staff_note || '')
  const [busy, setBusy] = useState(false)
  const noteRef = useRef(request.staff_note || '')

  const loadJobs = useCallback(async () => {
    const r = await api(`/jobs?request_id=${request.id}`)
    if (r.ok) setJobs(await r.json())
  }, [api, request.id])

  const activeJob = jobs.find(j => j.status === 'queued' || j.status === 'running') || null
  const lastJob = jobs[0] || null

  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => {
    const id = window.setInterval(loadJobs, activeJob ? 2000 : 8000)
    return () => window.clearInterval(id)
  }, [loadJobs, activeJob])
  useEffect(() => { if (!stationId && stations.length) setStationId(stations.find(s => s.online)?.id || stations[0].id) }, [stations, stationId])

  const station = stations.find(s => s.id === stationId)
  const stationDevice = station?.state?.device
  const canSend = !activeJob && picked.size > 0 && Boolean(station) && request.status !== 'cancelled'

  const send = async () => {
    if (!station) return
    setBusy(true)
    try {
      const res = await api('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: request.id, station_id: station.id, bundle_ids: [...picked] }) })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      toast(station.online ? `Отправлено на станцию «${station.name}»` : `В очереди станции «${station.name}» — она сейчас не в сети`, 'success')
      await loadJobs(); onChanged()
    } finally { setBusy(false) }
  }
  const cancelJob = async () => {
    if (!activeJob) return
    const res = await api(`/jobs/${activeJob.id}/cancel`, { method: 'POST' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Задание отменено', 'success'); await loadJobs(); onChanged()
  }
  const patch = async (data: Record<string, unknown>, okText: string) => {
    setBusy(true)
    try {
      const res = await api(`/requests/${request.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!res.ok) { toast(await readError(res), 'error'); return false }
      toast(okText, 'success'); onChanged(); return true
    } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Удалить заявку?', message: `${request.request_number} · ${request.customer_name}. История установок по ней тоже удалится.`, confirmLabel: 'Удалить' }))) return
    const res = await api(`/requests/${request.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Заявка удалена', 'success'); onChanged(); onClose()
  }

  const total = request.apps.filter(a => picked.has(a.bundle_id)).reduce((s, a) => s + Number(a.price || 0), 0)
  const catalogById = new Map(apps.map(a => [a.bundle_id, a]))

  return (
    <Modal title={`${request.request_number} · ${request.customer_name}`} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="rounded-xl bg-white/[0.04] p-3 text-sm">
            <div className="flex items-center justify-between gap-2"><Badge map={REQUEST_STATUS} value={request.status} /><span className="text-xs text-slate-500">{request.source === 'site' ? 'Заявка с сайта' : 'Оформлена у прилавка'} · {timeAgo(request.created_at)}</span></div>
            <div className="mt-2 text-white"><a href={phoneHref(request.customer_phone)} className="text-yellow-300 hover:underline">{request.customer_phone}</a></div>
            <div className="text-slate-300">{request.device_model || 'Модель не указана'}{request.ios_version ? ` · iOS ${request.ios_version}` : ''}</div>
            {request.comment && <div className="mt-2 rounded-lg bg-white/[0.04] p-2 text-slate-300">«{request.comment}»</div>}
          </div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Что ставим</div>
          <ul className="mt-2 space-y-1.5">
            {request.apps.map(a => {
              const cat = catalogById.get(a.bundle_id)
              return (
                <li key={a.bundle_id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2 hover:bg-white/[0.07]">
                    <input type="checkbox" checked={picked.has(a.bundle_id)} disabled={Boolean(activeJob)} onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(a.bundle_id); else n.delete(a.bundle_id); setPicked(n) }} className="h-4 w-4 rounded" />
                    <span className="flex-1 text-sm text-white">{a.name}<span className="ml-2 text-xs text-slate-500">{a.bundle_id}</span></span>
                    <span className="text-sm text-slate-300">{fmtRub(cat ? cat.price : a.price)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between text-sm"><span className="text-slate-400">К оплате за выбранное</span><span className="font-semibold text-white">{fmtRub(total)}</span></div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Станция</div>
          {stations.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Станций ещё нет — добавьте на вкладке «Станции» и запустите на Mac.</p>
          ) : (
            <select value={stationId} onChange={e => setStationId(e.target.value)} disabled={Boolean(activeJob)} aria-label="Станция" className={`${INPUT} mt-2`}>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name} · {s.online ? (s.state?.device?.paired ? `подключён ${s.state.device.model}` : 'в сети, iPhone не подключён') : 'не в сети'}</option>)}
            </select>
          )}
          {station && !station.online && <p className="mt-1 text-xs text-yellow-300/80">Станция не в сети: задание подождёт её в очереди.</p>}
          {station?.online && !stationDevice?.paired && <p className="mt-1 text-xs text-slate-400">Подключите iPhone покупателя кабелем к Mac и подтвердите «Доверять» на телефоне.</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={send} disabled={!canSend || busy} className={BTN_PRIMARY} data-send-job><AdminIcon name="zap" className="h-4 w-4" />Отправить на станцию</button>
            {activeJob && <button type="button" onClick={cancelJob} className={BTN_SECONDARY}>Отменить задание</button>}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ход установки</div>
          {!lastJob ? (
            <p className="mt-2 text-sm text-slate-400">Заявка ещё не отправлялась на станцию.</p>
          ) : (
            <div className="mt-2 rounded-xl border border-white/10 p-3" data-job-status={lastJob.status}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-white">{JOB_STATUS[lastJob.status] || lastJob.status}{activeJob ? <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400 align-middle" /> : null}</span>
                <span className="text-xs text-slate-500">{lastJob.device_model || ''}{lastJob.ios_version ? ` · iOS ${lastJob.ios_version}` : ''}</span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {lastJob.apps.map(a => (
                  <li key={a.bundle_id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
                    <span className="min-w-0"><span className="text-white">{a.name}</span>{a.version ? <span className="ml-1 text-xs text-slate-500">{a.version}</span> : null}{a.error ? <div className="text-xs text-red-300/90">{a.error}</div> : null}</span>
                    <Badge map={APP_STATUS} value={a.status} />
                  </li>
                ))}
              </ul>
              {lastJob.log.length > 0 && (
                <div className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-slate-400">
                  {lastJob.log.slice(-12).map((l, i) => <div key={i}>{new Date(l.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {l.msg}</div>)}
                </div>
              )}
              {jobs.length > 1 && <div className="mt-2 text-xs text-slate-500">Попыток: {jobs.length}</div>}
            </div>
          )}

          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Заметка сотрудника</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Например: Т-Банка не было на аккаунте, поставили с аккаунта сына" className={`${INPUT} mt-2`} />
          {note !== noteRef.current && <button type="button" onClick={async () => { if (await patch({ staff_note: note }, 'Заметка сохранена')) noteRef.current = note }} disabled={busy} className={`${BTN_SECONDARY} mt-2`}>Сохранить заметку</button>}

          <div className="mt-5 flex flex-wrap gap-2">
            {request.status !== 'done' && <button type="button" onClick={() => patch({ status: 'done' }, 'Заявка закрыта')} disabled={busy} className={BTN_SECONDARY}><AdminIcon name="check" className="h-4 w-4" />Готово</button>}
            {request.status !== 'cancelled' && request.status !== 'done' && <button type="button" onClick={() => patch({ status: 'cancelled' }, 'Заявка отменена')} disabled={busy} className={BTN_SECONDARY}>Отменить заявку</button>}
            {(request.status === 'done' || request.status === 'cancelled') && <button type="button" onClick={() => patch({ status: 'new' }, 'Заявка снова в работе')} disabled={busy} className={BTN_SECONDARY}>Вернуть в работу</button>}
            <button type="button" onClick={remove} className={`${BTN_ROW} ml-auto text-red-300`}>Удалить</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Новая заявка у прилавка
// ═════════════════════════════════════════════════════════════════════════════

function NewRequestModal({ apps, stations, api, onClose, onCreated }: { apps: IphoneApp[]; stations: Station[]; api: (p: string, i?: RequestInit) => Promise<Response>; onClose: () => void; onCreated: (r: InstallRequest) => void }) {
  const connected = stations.find(s => s.online && s.state?.device?.paired)?.state?.device
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [model, setModel] = useState(connected?.model || '')
  const [ios, setIos] = useState(connected?.ios_version || '')
  const [comment, setComment] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const active = apps.filter(a => a.is_active)
  const total = active.filter(a => picked.has(a.id)).reduce((s, a) => s + Number(a.price || 0), 0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (picked.size === 0) { toast('Отметьте хотя бы одно приложение', 'error'); return }
    setBusy(true)
    try {
      const res = await api('/requests/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: name, customer_phone: phone, device_model: model || null, ios_version: ios || null, app_ids: [...picked], comment: comment || null }) })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      toast('Заявка создана', 'success'); onCreated(await res.json())
    } finally { setBusy(false) }
  }

  return (
    <Modal title="Новая заявка у прилавка" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">Имя покупателя<input value={name} onChange={e => setName(e.target.value)} required minLength={2} className={`${INPUT} mt-1`} /></label>
          <label className="block text-sm text-slate-300">Телефон<input value={phone} onChange={e => setPhone(e.target.value)} required inputMode="tel" placeholder="+7 999 000-00-00" className={`${INPUT} mt-1`} /></label>
          <label className="block text-sm text-slate-300">Модель iPhone<input value={model} onChange={e => setModel(e.target.value)} placeholder={connected?.model ? '' : 'iPhone 15 Pro'} className={`${INPUT} mt-1`} /></label>
          <label className="block text-sm text-slate-300">Версия iOS<input value={ios} onChange={e => setIos(e.target.value)} placeholder="18.6" className={`${INPUT} mt-1`} /></label>
        </div>
        {connected && <p className="text-xs text-emerald-300/80">Модель и iOS подставлены с подключённого iPhone.</p>}
        <div>
          <div className="mb-1 text-sm text-slate-300">Приложения</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {active.map(a => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm hover:bg-white/[0.07]">
                <input type="checkbox" checked={picked.has(a.id)} onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(a.id); else n.delete(a.id); setPicked(n) }} className="h-4 w-4 rounded" />
                <span className="flex-1 text-white">{a.name}</span><span className="text-xs text-slate-400">{fmtRub(a.price)}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="block text-sm text-slate-300">Комментарий<input value={comment} onChange={e => setComment(e.target.value)} placeholder="Например: приложение было на аккаунте жены" className={`${INPUT} mt-1`} /></label>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-slate-300">Итого <b className="text-white">{fmtRub(total)}</b></span>
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>Создать заявку</button>
        </div>
      </form>
    </Modal>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Каталог приложений
// ═════════════════════════════════════════════════════════════════════════════

function AppsTable({ apps, api, onEdit, onChanged }: { apps: IphoneApp[]; api: (p: string, i?: RequestInit) => Promise<Response>; onEdit: (a: IphoneApp) => void; onChanged: () => void }) {
  const toggle = async (a: IphoneApp) => {
    const res = await api(`/apps/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !a.is_active }) })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    onChanged()
  }
  const remove = async (a: IphoneApp) => {
    if (!(await confirmDialog({ title: `Удалить «${a.name}»?`, message: 'Из старых заявок приложение не пропадёт: там хранится снимок.', confirmLabel: 'Удалить' }))) return
    const res = await api(`/apps/${a.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Удалено', 'success'); onChanged()
  }
  const seed = async () => {
    const res = await api('/apps/seed-defaults', { method: 'POST' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    const added = await res.json()
    toast(added.length ? `Добавлено приложений: ${added.length}` : 'Все стандартные уже в каталоге', 'success'); onChanged()
  }
  if (apps.length === 0) return (
    <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-slate-400">
      <p>Каталог пуст. Добавьте приложения: название, Bundle ID и цену установки.</p>
      <button type="button" onClick={seed} className={`${BTN_PRIMARY} mt-4`} data-seed-defaults>Заполнить стандартным набором: Сбер, Т-Банк, ВТБ, Альфа, ВК, Telegram</button>
    </div>
  )
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-slate-400">
          <tr><th className="p-3">Приложение</th><th className="hidden p-3 sm:table-cell">Bundle ID</th><th className="hidden p-3 md:table-cell">Категория</th><th className="p-3">Цена</th><th className="p-3">На сайте</th><th className="p-3 text-right">Действия</th></tr>
        </thead>
        <tbody>
          {apps.map(a => (
            <tr key={a.id} data-iphone-app={a.bundle_id} className="border-t border-white/[0.06]">
              <td className="p-3"><div className="font-medium text-white">{a.name}</div>{a.description && <div className="text-xs text-slate-500">{a.description}</div>}</td>
              <td className="hidden p-3 font-mono text-xs text-slate-300 sm:table-cell">{a.bundle_id}</td>
              <td className="hidden p-3 text-slate-300 md:table-cell">{CATEGORY_LABEL[a.category] || a.category}</td>
              <td className="p-3 text-white">{fmtRub(a.price)}</td>
              <td className="p-3">
                <button type="button" role="switch" aria-checked={a.is_active} aria-label={`На сайте: ${a.name}`} onClick={() => toggle(a)} className={`relative h-6 w-11 rounded-full transition ${a.is_active ? 'bg-yellow-400' : 'bg-white/15'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-slate-950 shadow transition-all ${a.is_active ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </td>
              <td className="p-3"><div className="flex justify-end gap-1">
                <button type="button" onClick={() => onEdit(a)} aria-label={`Изменить: ${a.name}`} className={BTN_ROW}><AdminIcon name="edit" className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(a)} aria-label={`Удалить: ${a.name}`} className={`${BTN_ROW} text-red-300`}><AdminIcon name="trash" className="h-4 w-4" /></button>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AppModal({ app, api, onClose, onSaved }: { app: IphoneApp | null; api: (p: string, i?: RequestInit) => Promise<Response>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: app?.name || '', bundle_id: app?.bundle_id || '', app_store_id: app?.app_store_id ? String(app.app_store_id) : '',
    category: app?.category || 'bank', price: app ? String(Math.round(Number(app.price))) : '500', description: app?.description || '',
    icon_url: app?.icon_url || '', is_active: app?.is_active ?? true, sort_order: String(app?.sort_order ?? 0),
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { ...form, app_store_id: form.app_store_id ? Number(form.app_store_id) : null, price: Number(form.price) || 0, sort_order: Number(form.sort_order) || 0, description: form.description || null, icon_url: form.icon_url || null }
      const res = await api(app ? `/apps/${app.id}` : '/apps', { method: app ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      toast(app ? 'Сохранено' : 'Приложение добавлено', 'success'); onSaved()
    } finally { setBusy(false) }
  }
  return (
    <Modal title={app ? `Приложение: ${app.name}` : 'Новое приложение'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">Название<input value={form.name} onChange={e => set('name', e.target.value)} required className={`${INPUT} mt-1`} /></label>
          <label className="block text-sm text-slate-300">Bundle ID<input value={form.bundle_id} onChange={e => set('bundle_id', e.target.value)} required placeholder="ru.sberbankmobile" className={`${INPUT} mt-1 font-mono`} /></label>
          <label className="block text-sm text-slate-300">Категория
            <select value={form.category} onChange={e => set('category', e.target.value)} className={`${INPUT} mt-1`}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block text-sm text-slate-300">Цена установки, ₽<input value={form.price} onChange={e => set('price', e.target.value)} inputMode="numeric" className={`${INPUT} mt-1`} /></label>
          <label className="block text-sm text-slate-300">App Store ID<input value={form.app_store_id} onChange={e => set('app_store_id', e.target.value)} inputMode="numeric" placeholder="необязательно" className={`${INPUT} mt-1`} /></label>
          <label className="block text-sm text-slate-300">Порядок<input value={form.sort_order} onChange={e => set('sort_order', e.target.value)} inputMode="numeric" className={`${INPUT} mt-1`} /></label>
        </div>
        <label className="block text-sm text-slate-300">Описание на сайте<input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Переводы, СБП, вклады" className={`${INPUT} mt-1`} /></label>
        <label className="block text-sm text-slate-300">Ссылка на иконку<input value={form.icon_url} onChange={e => set('icon_url', e.target.value)} placeholder="https://…/icon.png" className={`${INPUT} mt-1`} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="h-4 w-4 rounded" />Показывать на сайте</label>
        <p className="text-xs text-slate-500">Bundle ID — точный адрес приложения в App Store. Если он окажется неточным, станция найдёт приложение по названию в истории покупок и всё равно поставит.</p>
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button><button type="submit" disabled={busy} className={BTN_PRIMARY}>{app ? 'Сохранить' : 'Добавить'}</button></div>
      </form>
    </Modal>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Станции
// ═════════════════════════════════════════════════════════════════════════════

function StationsGrid({ stations, api, onChanged, onAdd }: { stations: Station[]; api: (p: string, i?: RequestInit) => Promise<Response>; onChanged: () => void; onAdd: () => void }) {
  const remove = async (s: Station) => {
    if (!(await confirmDialog({ title: `Удалить станцию «${s.name}»?`, message: 'Её токен перестанет работать. Программу на Mac нужно будет настроить заново с новым токеном.', confirmLabel: 'Удалить' }))) return
    const res = await api(`/stations/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Станция удалена', 'success'); onChanged()
  }
  if (stations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
        <p className="text-slate-300">Станций ещё нет.</p>
        <p className="mt-1 text-sm text-slate-500">Станция — это Mac в павильоне с программой TakeSmart Station. Добавьте её здесь, получите токен и запустите программу.</p>
        <button type="button" onClick={onAdd} className={`${BTN_PRIMARY} mt-4`}><AdminIcon name="plus" className="h-4 w-4" />Добавить станцию</button>
      </div>
    )
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {stations.map(s => {
        const d = s.state?.device
        const a = s.state?.apple
        return (
          <div key={s.id} data-station={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-2">
              <div><div className="flex items-center gap-2 font-semibold text-white"><span className={`h-2.5 w-2.5 rounded-full ${s.online ? 'bg-emerald-400' : 'bg-red-400'}`} />{s.name}</div>
                <div className="text-xs text-slate-500">{s.online ? 'В сети' : s.last_seen_at ? `Была в сети ${timeAgo(s.last_seen_at)}` : 'Ещё не выходила на связь'}{s.version ? ` · v${s.version}` : ''}</div></div>
              <button type="button" onClick={() => remove(s)} aria-label={`Удалить станцию ${s.name}`} className={`${BTN_ROW} text-red-300`}><AdminIcon name="trash" className="h-4 w-4" /></button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-white/[0.04] p-2"><dt className="text-xs text-slate-500">iPhone</dt><dd className="text-white">{!s.online ? '—' : d ? (d.paired ? `${d.model || 'iPhone'} · iOS ${d.ios_version || '?'}` : 'Ждём «Доверять» на телефоне') : 'не подключён'}</dd></div>
              <div className="rounded-lg bg-white/[0.04] p-2"><dt className="text-xs text-slate-500">Apple ID покупателя</dt><dd className="text-white">{!s.online ? '—' : a?.logged_in ? `вход выполнен${a.purchases_count != null ? ` · покупок ${a.purchases_count}` : ''}` : 'не введён'}</dd></div>
            </dl>
            {s.state?.busy && <div className="mt-2 text-xs text-sky-300">Идёт установка</div>}
          </div>
        )
      })}
    </div>
  )
}

function NewStationModal({ api, onClose, onCreated }: { api: (p: string, i?: RequestInit) => Promise<Response>; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('Павильон А60')
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const res = await api('/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      const d = await res.json(); setCreated({ name: d.name, token: d.token }); onCreated()
    } finally { setBusy(false) }
  }
  const backend = window.location.origin
  const cmd = created ? `python3 takesmart_station.py --setup --backend ${backend} --token ${created.token}` : ''
  return (
    <Modal title={created ? 'Станция добавлена' : 'Новая станция'} onClose={onClose}>
      {!created ? (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-slate-300">Название<input value={name} onChange={e => setName(e.target.value)} required minLength={2} className={`${INPUT} mt-1`} /></label>
          <p className="text-xs text-slate-500">После создания покажем токен один раз — его вписывают в программу на Mac.</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button><button type="submit" disabled={busy} className={BTN_PRIMARY}>Создать</button></div>
        </form>
      ) : (
        <div className="space-y-3 text-sm text-slate-300">
          <p>Токен станции «{created.name}». Он показывается <b className="text-white">только сейчас</b> — скопируйте.</p>
          <div className="flex items-center gap-2 rounded-lg bg-black/30 p-2 font-mono text-xs text-yellow-200"><span className="flex-1 break-all" data-station-token>{created.token}</span><button type="button" onClick={() => { navigator.clipboard?.writeText(created.token); toast('Токен скопирован', 'success') }} className={BTN_ROW}>Копировать</button></div>
          <ol className="list-decimal space-y-2 pl-5">
            <li>На Mac один раз поставьте утилиты: <code className="rounded bg-black/30 px-1 py-0.5 text-xs">brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller</code></li>
            <li>Скопируйте на Mac файл <code className="rounded bg-black/30 px-1 py-0.5 text-xs">station/takesmart_station.py</code> из репозитория бэкенда.</li>
            <li>Один раз сохраните настройки: <span className="flex items-center gap-2"><code className="block flex-1 break-all rounded bg-black/30 p-2 text-xs">{cmd}</code><button type="button" onClick={() => { navigator.clipboard?.writeText(cmd); toast('Команда скопирована', 'success') }} className={BTN_ROW}>Копировать</button></span></li>
            <li>Запускайте: <code className="rounded bg-black/30 px-1 py-0.5 text-xs">python3 takesmart_station.py</code>. Откроется страница станции, где сотрудник вводит Apple ID покупателя.</li>
          </ol>
          <div className="flex justify-end"><button type="button" onClick={onClose} className={BTN_PRIMARY}>Готово</button></div>
        </div>
      )}
    </Modal>
  )
}

