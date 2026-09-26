import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { timeAgo } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// Раздел «Приложения на iPhone». Сама работа идёт на станции: Mac в павильоне,
// к которому подключают iPhone покупателя; там покупатель входит в Apple ID и
// сотрудник ставит что угодно из истории его покупок. Здесь только станции
// (токен, состояние) и история установок — что и на какой телефон поставили.
// ─────────────────────────────────────────────────────────────────────────────

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>
interface StationState { device?: { model?: string; ios_version?: string; paired?: boolean } | null; apple?: { logged_in?: boolean; purchases_count?: number | null } | null; busy?: boolean }
interface Station { id: string; name: string; version: string | null; last_seen_at: string | null; state: StationState; is_active: boolean; online: boolean; created_at: string }
interface JobApp { bundle_id: string; name: string; status: string; version: string | null; error: string | null }
interface Session { id: string; station_id: string | null; status: string; apps: JobApp[]; device_model: string | null; ios_version: string | null; note: string | null; log: { t: string; msg: string }[]; created_at: string; finished_at: string | null }
interface Stats { installed_today: number; installed_month: number; sessions_today: number; sessions_month: number; stations_online: number }

const INPUT = 'w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-yellow-400/60 focus:bg-white/10 focus:outline-none'
const BTN_ROW = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20 disabled:opacity-50'
const APP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'В очереди', cls: 'bg-white/10 text-slate-300' },
  downloading: { label: 'Скачиваем', cls: 'bg-sky-500/15 text-sky-300' },
  installing: { label: 'Ставим', cls: 'bg-sky-500/15 text-sky-300' },
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
const STATION_URL = 'http://127.0.0.1:8765'

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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-slate-900 p-5 shadow-2xl ring-1 ring-white/10 sm:max-w-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"><AdminIcon name="x" className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function InstallsSection({ authFetch }: { authFetch: AuthFetch }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [stationOpen, setStationOpen] = useState(false)
  const [openSession, setOpenSession] = useState<Session | null>(null)

  const api = useCallback((path: string, init?: RequestInit) => authFetch(`${API_BASE_URL}/api/installs${path}`, init), [authFetch])
  const loadAll = useCallback(async () => {
    try {
      const [s, st, ss] = await Promise.all([
        api('/stats').then(x => x.ok ? x.json() : null),
        api('/stations').then(x => x.ok ? x.json() : []),
        api('/sessions?limit=200').then(x => x.ok ? x.json() : []),
      ])
      if (s) setStats(s)
      setStations(st); setSessions(ss)
    } catch { /* покажем прошлое состояние */ }
    finally { setLoading(false) }
  }, [api])
  useEffect(() => {
    loadAll()
    const id = window.setInterval(loadAll, 5000)
    return () => window.clearInterval(id)
  }, [loadAll])

  const removeStation = async (s: Station) => {
    if (!(await confirmDialog({ title: `Удалить станцию «${s.name}»?`, message: 'Её токен перестанет работать. Программу на Mac нужно будет настроить заново с новым токеном.', confirmLabel: 'Удалить' }))) return
    const res = await api(`/stations/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Станция удалена', 'success'); loadAll()
  }
  const removeSession = async (s: Session) => {
    if (!(await confirmDialog({ title: 'Удалить запись из истории?', message: `${s.device_model || 'iPhone'} · ${new Date(s.created_at).toLocaleString('ru-RU')}`, confirmLabel: 'Удалить' }))) return
    const res = await api(`/sessions/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Удалено', 'success'); setOpenSession(null); loadAll()
  }
  const stationName = (id: string | null) => stations.find(s => s.id === id)?.name || '—'

  return (
    <div data-installs-section>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Установлено сегодня" value={String(stats?.installed_today ?? '—')} hint={`за месяц ${stats?.installed_month ?? '—'}`} icon="check" />
        <StatCard label="Телефонов сегодня" value={String(stats?.sessions_today ?? '—')} hint={`за месяц ${stats?.sessions_month ?? '—'}`} icon="users" />
        <StatCard label="Станций в сети" value={`${stats?.stations_online ?? 0} из ${stations.length}`} tone={stats?.stations_online ? 'green' : 'red'} icon="zap" hint={stations.find(s => s.online)?.state?.device?.paired ? `Подключён ${stations.find(s => s.online)?.state?.device?.model}` : (stats?.stations_online ? 'iPhone не подключён' : 'Запустите станцию на Mac')} />
        <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-yellow-300">Как ставить</div>
          <p className="mt-2 text-sm text-slate-300">Всё делается на странице станции на Mac: подключить iPhone кабелем, покупатель вводит Apple ID, отмечаете нужное из его истории покупок, «Установить».</p>
          <a href={STATION_URL} target="_blank" rel="noreferrer" className={`${BTN_PRIMARY} mt-3`} data-open-station><AdminIcon name="external" className="h-4 w-4" />Открыть станцию</a>
          <p className="mt-2 text-xs text-slate-500">Ссылка работает на самом Mac, где запущена станция.</p>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Станции</h3>
        <button type="button" onClick={() => setStationOpen(true)} className={BTN_SECONDARY}><AdminIcon name="plus" className="h-4 w-4" />Добавить станцию</button>
      </div>
      {stations.length === 0 ? (
        <div className="mb-6 rounded-2xl border border-dashed border-white/10 p-8 text-center">
          <p className="text-slate-300">Станций ещё нет.</p>
          <p className="mt-1 text-sm text-slate-500">Станция — это Mac в павильоне с программой TakeSmart Station. Добавьте её, получите токен и запустите программу по инструкции.</p>
        </div>
      ) : (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {stations.map(s => {
            const d = s.state?.device; const a = s.state?.apple
            return (
              <div key={s.id} data-station={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="flex items-center gap-2 font-semibold text-white"><span className={`h-2.5 w-2.5 rounded-full ${s.online ? 'bg-emerald-400' : 'bg-red-400'}`} />{s.name}</div>
                    <div className="text-xs text-slate-500">{s.online ? 'В сети' : s.last_seen_at ? `Была в сети ${timeAgo(s.last_seen_at)}` : 'Ещё не выходила на связь'}{s.version ? ` · v${s.version}` : ''}</div></div>
                  <button type="button" onClick={() => removeStation(s)} aria-label={`Удалить станцию ${s.name}`} className={`${BTN_ROW} text-red-300`}><AdminIcon name="trash" className="h-4 w-4" /></button>
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
      )}

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">История установок</h3>
      {loading ? <p className="text-slate-400">Загружаем…</p> : sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-slate-400">Пока ни одной установки. Первая запись появится сама, как только станция поставит что-то на iPhone.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="hidden w-full text-sm md:table">
            <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-slate-400">
              <tr><th className="p-3">Когда</th><th className="p-3">iPhone</th><th className="p-3">Приложения</th><th className="p-3">Итог</th><th className="p-3">Станция</th></tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const ok = s.apps.filter(a => a.status === 'installed').length
                return (
                  <tr key={s.id} data-install-session={s.id} onClick={() => setOpenSession(s)} className="cursor-pointer border-t border-white/[0.06] transition hover:bg-white/[0.04]">
                    <td className="p-3 text-slate-300">{new Date(s.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}<div className="text-[11px] text-slate-500">{timeAgo(s.created_at)}</div></td>
                    <td className="p-3 text-white">{s.device_model || 'iPhone'}{s.ios_version ? <div className="text-xs text-slate-500">iOS {s.ios_version}</div> : null}{s.note && <div className="text-xs text-slate-500">{s.note}</div>}</td>
                    <td className="p-3"><div className="flex flex-wrap gap-1">{s.apps.map(a => <span key={a.bundle_id} className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'installed' ? 'bg-emerald-500/15 text-emerald-300' : a.status === 'not_owned' ? 'bg-yellow-400/15 text-yellow-300' : 'bg-white/10 text-slate-300'}`}>{a.name}{a.version ? ` ${a.version}` : ''}</span>)}</div></td>
                    <td className="p-3"><Badge map={SESSION_STATUS} value={s.status} /><div className="mt-1 text-xs text-slate-500">{ok} из {s.apps.length}</div></td>
                    <td className="p-3 text-slate-300">{stationName(s.station_id)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="divide-y divide-white/[0.06] md:hidden">
            {sessions.map(s => (
              <button key={s.id} type="button" onClick={() => setOpenSession(s)} className="block w-full p-4 text-left">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-white">{s.device_model || 'iPhone'}</span><Badge map={SESSION_STATUS} value={s.status} /></div>
                <div className="mt-0.5 text-xs text-slate-400">{new Date(s.created_at).toLocaleString('ru-RU')} · {stationName(s.station_id)}</div>
                <div className="mt-2 flex flex-wrap gap-1">{s.apps.map(a => <span key={a.bundle_id} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{a.name}</span>)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {openSession && (
        <Modal title={`${openSession.device_model || 'iPhone'} · ${new Date(openSession.created_at).toLocaleString('ru-RU')}`} onClose={() => setOpenSession(null)}>
          <div className="text-sm text-slate-300">{openSession.ios_version ? `iOS ${openSession.ios_version} · ` : ''}станция {stationName(openSession.station_id)} · <Badge map={SESSION_STATUS} value={openSession.status} /></div>
          <ul className="mt-3 space-y-1.5">
            {openSession.apps.map(a => (
              <li key={a.bundle_id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
                <span className="min-w-0"><span className="text-white">{a.name}</span>{a.version ? <span className="ml-1 text-xs text-slate-500">{a.version}</span> : null}<div className="text-[11px] text-slate-500">{a.bundle_id}</div>{a.error ? <div className="text-xs text-red-300/90">{a.error}</div> : null}</span>
                <Badge map={APP_STATUS} value={a.status} />
              </li>
            ))}
          </ul>
          {openSession.log.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-slate-400">
              {openSession.log.map((l, i) => <div key={i}>{new Date(l.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {l.msg}</div>)}
            </div>
          )}
          <div className="mt-4 flex justify-end"><button type="button" onClick={() => removeSession(openSession)} className={`${BTN_ROW} text-red-300`}>Удалить запись</button></div>
        </Modal>
      )}
      {stationOpen && <NewStationModal api={api} onClose={() => setStationOpen(false)} onCreated={loadAll} />}
    </div>
  )
}

function StatCard({ label, value, hint, icon, tone = 'plain' }: { label: string; value: string; hint?: string; icon: 'check' | 'users' | 'zap'; tone?: 'plain' | 'green' | 'red' }) {
  const toneCls = { plain: 'bg-white/10 text-slate-300', green: 'bg-emerald-500/15 text-emerald-300', red: 'bg-red-500/15 text-red-300' }[tone]
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
  const copy = (text: string, msg: string) => { navigator.clipboard?.writeText(text); toast(msg, 'success') }
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
          <p>Токен станции «{created.name}». Он показывается <b className="text-white">только сейчас</b>.</p>
          <div className="flex items-center gap-2 rounded-lg bg-black/30 p-2 font-mono text-xs text-yellow-200"><span className="flex-1 break-all" data-station-token>{created.token}</span><button type="button" onClick={() => copy(created.token, 'Токен скопирован')} className={BTN_ROW}>Копировать</button></div>
          <ol className="list-decimal space-y-2 pl-5">
            <li>На Mac один раз: <code className="rounded bg-black/30 px-1 py-0.5 text-xs">brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller</code></li>
            <li>Скопировать на Mac файл <code className="rounded bg-black/30 px-1 py-0.5 text-xs">station/takesmart_station.py</code> из репозитория бэкенда.</li>
            <li>Один раз сохранить настройки: <span className="flex items-center gap-2"><code className="block flex-1 break-all rounded bg-black/30 p-2 text-xs">{cmd}</code><button type="button" onClick={() => copy(cmd, 'Команда скопирована')} className={BTN_ROW}>Копировать</button></span></li>
            <li>Запускать: <code className="rounded bg-black/30 px-1 py-0.5 text-xs">python3 takesmart_station.py</code>. Откроется страница станции.</li>
          </ol>
          <div className="flex justify-end"><button type="button" onClick={onClose} className={BTN_PRIMARY}>Готово</button></div>
        </div>
      )}
    </Modal>
  )
}
