import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { resolveApp } from '../../lib/appCatalog'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { timeAgo } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// «Приложения на iPhone». Вся работа идёт прямо в этом разделе, открытом на Mac,
// к которому кабелем подключают iPhone покупателя. На Mac запущен помощник
// (takesmart_station.py) — маленькая программа, которая видит телефон и умеет
// скачивать приложения из истории покупок Apple ID. Страница говорит с ним по
// http://127.0.0.1:8765; Apple ID покупателя уходит с этого Mac прямо в Apple.
// В админку помощник пишет только историю установок.
// ─────────────────────────────────────────────────────────────────────────────

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>

const HELPER_URL = 'http://127.0.0.1:8765'
const HELPER_POLL_ONLINE_MS = 1500
const HELPER_POLL_OFFLINE_MS = 5000
const BREW_CMD = 'brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller'

interface HelperDevice { udid: string; model: string | null; ios_version: string | null; name: string | null; paired: boolean | null }
interface Purchase { bundle_id: string; name: string; id: number | null; version: string | null; icon?: string | null; genre?: string | null }
interface HelperSessionApp { bundle_id: string; name: string; status: string; version: string | null; error: string | null }
interface HelperHistoryItem { t: string; device: string | null; status: string; apps: { name: string; status: string; version: string | null }[] }
interface HelperState {
  version: string
  simulate: boolean
  connected: boolean
  station_name: string | null
  last_error: string | null
  device: HelperDevice | null
  installed: Record<string, { name: string; version: string }>
  apple: { logged_in: boolean; email: string | null; name: string | null }
  purchases: Purchase[] | null
  purchases_loading: boolean
  login: { status: 'idle' | 'working' | 'need_code' | 'ok' | 'error'; message: string | null; pending?: boolean }
  session: { id: string | null; apps: HelperSessionApp[]; status: string; started: string } | null
  history: HelperHistoryItem[]
  tools_missing: string[]
  host_name: string
  backend_url: string
  backend_configured: boolean
  station_id: string | null
}
type HelperStatus = 'checking' | 'offline' | 'online'

interface Station { id: string; name: string; version: string | null; last_seen_at: string | null; is_active: boolean; online: boolean; created_at: string }
interface JobApp { bundle_id: string; name: string; status: string; version: string | null; error: string | null }
interface Session { id: string; station_id: string | null; status: string; apps: JobApp[]; device_model: string | null; ios_version: string | null; note: string | null; log: { t: string; msg: string }[]; created_at: string; finished_at: string | null }
interface Stats { installed_today: number; installed_month: number; sessions_today: number; sessions_month: number; stations_online: number }

const INPUT = 'w-full rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[15px] text-white placeholder:text-slate-600 focus:border-yellow-400/60 focus:bg-white/10 focus:outline-none'
const BTN_ROW = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20 disabled:opacity-50'
const CARD = 'rounded-2xl border border-white/10 bg-white/[0.03] p-5'
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
function helperScriptUrl(): string { return `${window.location.origin}/station/takesmart_station.py` }
function copyText(text: string, msg: string) { navigator.clipboard?.writeText(text).then(() => toast(msg, 'success'), () => toast('Не удалось скопировать', 'error')) }
async function readError(res: Response): Promise<string> {
  try {
    const d = await res.json()
    return typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x: { msg?: string }) => x.msg).join('; ') : `Ошибка ${res.status}`
  } catch { return `Ошибка ${res.status}` }
}

// ── Связь с помощником на этом Mac ───────────────────────────────────────────
async function helperGet(): Promise<HelperState> {
  const r = await fetch(`${HELPER_URL}/api/state`, { cache: 'no-store' })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}
async function helperPost(path: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch(`${HELPER_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Station': '1' }, body: JSON.stringify(body ?? {}) })
    const d = await r.json().catch(() => ({}))
    return { ok: r.ok && d.ok !== false, message: d.message }
  } catch { return { ok: false, message: 'Помощник на Mac не отвечает' } }
}
function useHelper() {
  const [status, setStatus] = useState<HelperStatus>('checking')
  const [state, setState] = useState<HelperState | null>(null)
  const statusRef = useRef<HelperStatus>('checking')
  const refresh = useCallback(async () => {
    try { const s = await helperGet(); setState(s); statusRef.current = 'online'; setStatus('online') }
    catch { statusRef.current = 'offline'; setStatus('offline') }
  }, [])
  useEffect(() => {
    let alive = true
    let timer = 0
    const loop = async () => { await refresh(); if (!alive) return; timer = window.setTimeout(loop, statusRef.current === 'online' ? HELPER_POLL_ONLINE_MS : HELPER_POLL_OFFLINE_MS) }
    loop()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [refresh])
  return { status, state, refresh }
}

function Badge({ map, value }: { map: Record<string, { label: string; cls: string }>; value: string }) {
  const m = map[value] || { label: value, cls: 'bg-white/10 text-slate-300' }
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}

function Cmd({ text, copyLabel = 'Скопировать' }: { text: string; copyLabel?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/40 p-2 pl-3 font-mono text-[12px] leading-relaxed text-yellow-100">
      <span className="min-w-0 flex-1 break-all">{text}</span>
      <button type="button" onClick={() => copyText(text, 'Скопировано')} className={`${BTN_ROW} shrink-0 font-sans`}>{copyLabel}</button>
    </div>
  )
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

function AppIcon({ app, size = 44 }: { app: ReturnType<typeof resolveApp>; size?: number }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
  if (app.icon && !broken) return <img src={app.icon} alt="" width={size} height={size} style={style} className="shrink-0 bg-white/5 object-cover" onError={() => setBroken(true)} />
  return (
    <span aria-hidden="true" style={{ ...style, background: `hsl(${app.hue} 45% 28%)` }} className="flex shrink-0 items-center justify-center text-lg font-bold text-white/90">
      {app.letter}
    </span>
  )
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 6h4" /><path d="M11 18h2" />
    </svg>
  )
}

// ── Раздел ───────────────────────────────────────────────────────────────────
export function InstallsSection({ authFetch }: { authFetch: AuthFetch }) {
  const helper = useHelper()
  const [stats, setStats] = useState<Stats | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [openSession, setOpenSession] = useState<Session | null>(null)
  const [tokenModal, setTokenModal] = useState(false)
  const linkingRef = useRef(false)

  const api = useCallback((path: string, init?: RequestInit) => authFetch(`${API_BASE_URL}/api/installs${path}`, init), [authFetch])
  const loadAll = useCallback(async () => {
    try {
      const [s, st, ss] = await Promise.all([
        api('/stats').then(x => x.ok ? x.json() : null),
        api('/stations').then(x => x.ok ? x.json() : []),
        api('/sessions?limit=100').then(x => x.ok ? x.json() : []),
      ])
      if (s) setStats(s)
      setStations(st); setSessions(ss)
    } catch { /* покажем прошлое состояние */ }
  }, [api])
  useEffect(() => {
    loadAll()
    const id = window.setInterval(loadAll, 5000)
    return () => window.clearInterval(id)
  }, [loadAll])

  // Помощник запущен, но не знает эту админку (не настроен, настроен на другой адрес,
  // токен отозван) — выдаём ему адрес и токен сами, по локальной сети.
  const hs = helper.state
  const relink = useCallback(async (host: string) => {
    try {
      const res = await api('/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (host || 'Помощник').slice(0, 80) }) })
      if (!res.ok) { toast(`Не удалось привязать помощника: ${await readError(res)}`, 'error'); return }
      const d = await res.json()
      const r = await helperPost('/api/settings', { backend_url: backendOrigin(), token: d.token })
      if (!r.ok) { toast(r.message || 'Помощник не принял настройки', 'error'); return }
      toast('Помощник привязан к админке: история установок будет сохраняться', 'success')
      helper.refresh(); loadAll()
    } catch (e) { toast(`Не удалось привязать помощника: ${e instanceof Error ? e.message : 'ошибка'}`, 'error') }
  }, [api, helper, loadAll])
  const needsLink = Boolean(hs && (!hs.backend_configured || hs.backend_url !== backendOrigin() || (!hs.connected && /токен/i.test(hs.last_error || ''))))
  useEffect(() => {
    if (helper.status !== 'online' || !hs || !needsLink || linkingRef.current) return
    linkingRef.current = true
    relink(hs.host_name)
  }, [helper.status, needsLink]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeStation = async (s: Station) => {
    if (!(await confirmDialog({ title: `Отвязать помощник «${s.name}»?`, message: 'Его токен перестанет работать. При следующем открытии этого раздела на том Mac помощник привяжется заново.', confirmLabel: 'Отвязать' }))) return
    const res = await api(`/stations/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Помощник отвязан', 'success'); loadAll()
  }
  const removeSession = async (s: Session) => {
    if (!(await confirmDialog({ title: 'Удалить запись из истории?', message: `${s.device_model || 'iPhone'} · ${new Date(s.created_at).toLocaleString('ru-RU')}`, confirmLabel: 'Удалить' }))) return
    const res = await api(`/sessions/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { toast(await readError(res), 'error'); return }
    toast('Удалено', 'success'); setOpenSession(null); loadAll()
  }
  const stationName = (id: string | null) => stations.find(s => s.id === id)?.name || '—'

  return (
    <div data-installs-section data-helper-status={helper.status}>
      {helper.status !== 'online' ? (
        <HelperOffline status={helper.status} onRetry={helper.refresh} />
      ) : hs ? (
        <Console state={hs} refresh={helper.refresh} onRelink={() => relink(hs.host_name)} />
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
                        <td className="p-3"><Badge map={SESSION_STATUS} value={s.status} /><div className="mt-1 text-xs text-slate-500">{ok} из {s.apps.length}{stations.length > 1 ? ` · ${stationName(s.station_id)}` : ''}</div></td>
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
          <span className="font-normal normal-case tracking-normal text-slate-500">· {helper.status === 'online' ? `запущен здесь${hs?.backend_configured ? ', привязан' : ''}` : 'на этом Mac не запущен'}{stations.length ? ` · привязано: ${stations.length}` : ''}</span>
          <span className="ml-auto text-xs text-slate-600 group-open:hidden">показать</span>
        </summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className={CARD}>
            <div className="text-sm font-semibold text-white">Первая настройка Mac</div>
            <SetupSteps />
          </div>
          <div className={CARD}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-white">Привязанные помощники</div>
              <button type="button" onClick={() => setTokenModal(true)} className={BTN_SECONDARY}><AdminIcon name="plus" className="h-4 w-4" />Токен вручную</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Раздел привязывает помощника сам, когда открыт на том же Mac. Токен вручную нужен только если Mac стоит отдельно.</p>
            {stations.length === 0 ? <p className="mt-3 text-sm text-slate-500">Пока ни одного.</p> : (
              <ul className="mt-3 space-y-2">
                {stations.map(s => (
                  <li key={s.id} data-station={s.id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <span className="min-w-0 flex-1 truncate text-white">{s.name}<span className="ml-2 text-xs text-slate-500">{s.online ? 'в сети' : s.last_seen_at ? `был в сети ${timeAgo(s.last_seen_at)}` : 'ещё не выходил на связь'}{s.version ? ` · v${s.version}` : ''}</span></span>
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
          <div className="text-sm text-slate-300">{openSession.ios_version ? `iOS ${openSession.ios_version} · ` : ''}<Badge map={SESSION_STATUS} value={openSession.status} />{stations.length > 1 ? <span className="text-slate-500"> · {stationName(openSession.station_id)}</span> : null}</div>
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
      {tokenModal && <TokenModal api={api} onClose={() => setTokenModal(false)} onCreated={loadAll} />}
    </div>
  )
}

// ── Помощник не найден: что сделать ──────────────────────────────────────────
function SetupSteps() {
  return (
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-slate-300">
      <li>Один раз поставить утилиты (Терминал):<div className="mt-1"><Cmd text={BREW_CMD} /></div></li>
      <li>Скачать помощник и включить автозапуск (Терминал):<div className="mt-1"><Cmd text={`curl -fsSL ${helperScriptUrl()} -o ~/takesmart_station.py && python3 ~/takesmart_station.py --autostart`} /></div><div className="mt-1 text-xs text-slate-500">Дальше помощник стартует сам при входе в macOS и работает в фоне. Обновить — та же команда.</div></li>
      <li>Вернуться в этот раздел: он сам увидит помощника и привяжет его. Если браузер спросит про доступ к локальной сети — разрешить.</li>
    </ol>
  )
}

function HelperOffline({ status, onRetry }: { status: HelperStatus; onRetry: () => void }) {
  if (status === 'checking') {
    return <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Ищем помощника на этом Mac…</div>
  }
  return (
    <div data-helper-offline className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className={`${CARD} border-yellow-400/25 bg-yellow-400/[0.04]`}>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-400/15 text-yellow-300"><PhoneGlyph className="h-6 w-6" /></span>
          <div>
            <div className="text-lg font-semibold text-white">Запустите помощник на этом Mac</div>
            <div className="text-sm text-slate-400">Он видит iPhone по кабелю и ставит приложения. Раздел сам подхватит его, как только он запустится.</div>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-black/30 p-3 text-sm text-slate-300">
          Уже настраивали? Помощник стартует сам при входе в macOS. Если остановили — в Терминале: <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-yellow-100">python3 ~/takesmart_station.py --autostart</code>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onRetry} className={BTN_PRIMARY}><AdminIcon name="refresh" className="h-4 w-4" />Проверить ещё раз</button>
          <a href={HELPER_URL} target="_blank" rel="noreferrer" className={BTN_SECONDARY}><AdminIcon name="external" className="h-4 w-4" />Страница помощника</a>
        </div>
        <p className="mt-3 text-xs text-slate-500">Помощник запущен, а здесь его не видно? Значит браузер не пускает страницу к 127.0.0.1: разрешите доступ к локальной сети в запросе браузера или откройте «Страницу помощника» — там всё то же самое.</p>
      </div>
      <div className={CARD}>
        <div className="text-sm font-semibold text-white">Первая настройка Mac</div>
        <SetupSteps />
      </div>
    </div>
  )
}

// ── Консоль: iPhone → Apple ID → приложения ──────────────────────────────────
function Console({ state, refresh, onRelink }: { state: HelperState; refresh: () => void; onRelink: () => void }) {
  const device = state.device
  const phoneReady = Boolean(device?.paired)
  const loggedIn = state.apple.logged_in
  const session = state.session
  const steps = [
    { n: 1, label: phoneReady ? `${device?.model || 'iPhone'} подключён` : device ? 'Подтвердите доверие на iPhone' : 'Подключите iPhone кабелем', done: phoneReady },
    { n: 2, label: loggedIn ? 'Apple ID покупателя введён' : 'Введите Apple ID покупателя', done: loggedIn },
    { n: 3, label: session ? 'Идёт установка' : 'Выберите приложения и установите', done: false },
  ]
  return (
    <div data-console>
      <ol className="mb-5 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => {
          const active = !s.done && steps.slice(0, i).every(x => x.done)
          return (
            <li key={s.n} data-step={s.n} data-done={s.done ? '1' : '0'} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${s.done ? 'border-emerald-400/30 bg-emerald-400/[0.06]' : active ? 'border-yellow-400/40 bg-yellow-400/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? 'bg-emerald-400 text-slate-950' : active ? 'bg-yellow-400 text-slate-950' : 'bg-white/10 text-slate-400'}`}>{s.done ? <AdminIcon name="check" className="h-4 w-4" /> : s.n}</span>
              <span className={`text-sm font-medium ${s.done ? 'text-emerald-200' : active ? 'text-white' : 'text-slate-400'}`}>{s.label}</span>
            </li>
          )
        })}
      </ol>

      {state.tools_missing.length > 0 && (
        <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/[0.06] p-4 text-sm text-red-200">
          На Mac не найдены утилиты: {state.tools_missing.join(', ')}. Поставьте их в Терминале и перезапустите помощник:
          <div className="mt-2"><Cmd text={BREW_CMD} /></div>
        </div>
      )}
      {state.backend_configured && !state.connected && state.last_error && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-yellow-400/25 bg-yellow-400/[0.05] px-4 py-3 text-sm text-yellow-100">
          <span className="min-w-0 flex-1">Установка работает, но история не сохраняется: {state.last_error}</span>
          <button type="button" onClick={onRelink} className={BTN_ROW}>Привязать заново</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <DeviceCard state={state} />
          <AppleIdCard state={state} refresh={refresh} />
        </div>
        <div className="min-w-0">
          {session ? <InstallProgress state={state} refresh={refresh} /> : loggedIn ? <AppPicker state={state} refresh={refresh} /> : <PickerPlaceholder state={state} />}
        </div>
      </div>
    </div>
  )
}

function DeviceCard({ state }: { state: HelperState }) {
  const d = state.device
  const installedCount = Object.keys(state.installed || {}).length
  return (
    <div className={CARD} data-device-card>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">iPhone</div>
      {!d ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] text-slate-400"><PhoneGlyph className="h-6 w-6" /></span>
            <div className="text-lg font-semibold text-slate-300">Не подключён</div>
          </div>
          <p className="mt-2 text-sm text-slate-400">Подключите iPhone покупателя кабелем к этому Mac и разблокируйте его. На экране телефона появится «Доверять этому компьютеру?» — нажмите «Доверять».</p>
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
        </>
      )}
    </div>
  )
}

function AppleIdCard({ state, refresh }: { state: HelperState; refresh: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const l = state.login
  const working = l.status === 'working'
  const codeStep = l.status === 'need_code' || (working && l.pending)
  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    const r = await helperPost('/api/login', { email: email.trim(), password })
    if (!r.ok) toast(r.message || 'Не удалось начать вход', 'error')
    setPassword('')
    window.setTimeout(refresh, 300)
  }
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    const r = await helperPost('/api/login', { code: code.trim() })
    if (!r.ok) toast(r.message || 'Не удалось отправить код', 'error')
    setCode('')
    window.setTimeout(refresh, 300)
  }
  const logout = async () => { await helperPost('/api/logout'); refresh() }
  const reset = async () => { await helperPost('/api/login', { reset: true }); refresh() }

  return (
    <div className={CARD} data-apple-card>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Apple ID покупателя</div>
      {state.apple.logged_in ? (
        <>
          <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-white"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />{state.apple.name || 'Вход выполнен'}</div>
          {state.apple.email && <div className="text-sm text-slate-400">{state.apple.email}</div>}
          <div className="mt-2 text-sm text-slate-400">{state.purchases_loading ? 'Читаем историю покупок…' : state.purchases ? `В истории покупок: ${state.purchases.length}` : ''}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={logout} className={BTN_SECONDARY}>Выйти из Apple ID</button>
            <button type="button" onClick={() => helperPost('/api/purchases').then(refresh)} className={`${BTN_ROW}`}>Обновить список</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">После установки помощник выйдет из Apple ID сам и удалит скачанные файлы.</p>
        </>
      ) : codeStep ? (
        <form onSubmit={sendCode} className="mt-2">
          <p className="text-sm text-slate-300">Apple прислала код на устройства покупателя или по SMS. Почту и пароль повторять не нужно.</p>
          <input id="helper-code" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Код подтверждения" className={`${INPUT} mt-3`} autoFocus />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={working || !code.trim()} className={BTN_PRIMARY}>{working ? 'Проверяем код…' : 'Подтвердить код'}</button>
            <button type="button" onClick={reset} className="text-sm text-slate-400 hover:text-white">Другой Apple ID</button>
          </div>
          {l.message && !working && <p className="mt-2 text-xs text-yellow-200">{l.message}</p>}
        </form>
      ) : (
        <form onSubmit={login} className="mt-2">
          <p className="text-sm text-slate-400">Покупатель вводит свой Apple ID здесь. Пароль и код уходят с этого Mac прямо в Apple — у нас не сохраняются.</p>
          <input id="helper-email" value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="off" placeholder="Apple ID (почта)" className={`${INPUT} mt-3`} />
          <input id="helper-password" value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="off" placeholder="Пароль" className={`${INPUT} mt-2`} />
          <button type="submit" disabled={working || !email.trim() || !password} className={`${BTN_PRIMARY} mt-3`}>{working ? 'Связываемся с Apple…' : 'Войти'}</button>
          {l.message && l.status === 'error' && <p className="mt-2 text-sm text-red-300">{l.message}</p>}
        </form>
      )}
    </div>
  )
}

function PickerPlaceholder({ state }: { state: HelperState }) {
  const last = state.history[0]
  return (
    <div className={`${CARD} flex min-h-[260px] flex-col`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Что поставить</div>
      <div className="mt-2 text-lg font-semibold text-slate-300">Сначала Apple ID покупателя</div>
      <p className="mt-1 max-w-xl text-sm text-slate-400">После входа здесь появится всё, что когда-либо было на его аккаунте: банки, госуслуги, соцсети, авиакомпании. Отмечаете нужное — и «Установить».</p>
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

function AppPicker({ state, refresh }: { state: HelperState; refresh: () => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'bank'>('all')
  const [hideInstalled, setHideInstalled] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [manual, setManual] = useState('')
  const purchases = state.purchases || []
  const installed = state.installed || {}
  const phoneReady = Boolean(state.device?.paired)

  const items = useMemo(() => purchases.map(p => ({ p, r: resolveApp(p), have: installed[p.bundle_id] })), [purchases, installed])
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
    const r = await helperPost('/api/install', { apps })
    if (!r.ok) { toast(r.message || 'Не удалось начать установку', 'error'); return }
    setSelected(new Set()); refresh()
  }
  const installManual = async () => {
    const v = manual.trim()
    if (!v) return
    const isId = /^\d+$/.test(v)
    const r = await helperPost('/api/install', { apps: [isId ? { id: Number(v), name: `App Store #${v}` } : { bundle_id: v, name: v }] })
    if (!r.ok) { toast(r.message || 'Не удалось начать установку', 'error'); return }
    setManual(''); refresh()
  }
  const canInstall = phoneReady && selected.size > 0

  return (
    <div className={`${CARD} flex flex-col`} data-app-picker>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">История покупок аккаунта <span className="font-normal normal-case tracking-normal text-slate-500">· {visible.length} из {purchases.length}</span></div>
        <button type="button" onClick={install} disabled={!canInstall} data-install-btn className={`${BTN_PRIMARY} ml-auto`}>
          <AdminIcon name="check" className="h-4 w-4" />{selected.size ? `Установить (${selected.size})` : 'Установить'}
        </button>
      </div>
      {!phoneReady && selected.size > 0 && <p className="mt-2 text-xs text-yellow-200">Подключите iPhone, чтобы установить выбранное.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Поиск: Сбер, Т-Банк, ВК…" data-app-search className={`${INPUT} sm:max-w-xs`} />
        {([['all', 'Все'], ['bank', 'Банки']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} data-filter={k} className={`rounded-full px-3 py-1.5 text-sm transition ${filter === k ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>{label}</button>
        ))}
        <button type="button" onClick={() => setHideInstalled(v => !v)} className={`rounded-full px-3 py-1.5 text-sm transition ${hideInstalled ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>Скрыть уже установленные</button>
      </div>

      <div className="mt-3 max-h-[62vh] overflow-auto pr-1">
        {purchases.length === 0 && state.purchases_loading ? (
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/[0.05]" />)}</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">{purchases.length === 0 ? 'В истории покупок этого Apple ID пусто для iPhone' : 'Ничего не найдено'}</div>
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
          <button type="button" onClick={installManual} disabled={!phoneReady || !manual.trim()} data-manual-btn className={BTN_SECONDARY}>Поставить</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Сработает, только если приложение есть в истории покупок этого Apple ID или ещё доступно в App Store.</p>
      </details>
    </div>
  )
}

function InstallProgress({ state, refresh }: { state: HelperState; refresh: () => void }) {
  const s = state.session!
  const running = s.status === 'running'
  const done = s.apps.filter(a => a.status === 'installed').length
  return (
    <div className={CARD} data-install-progress>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Установка</div>
      <div className="mt-1 flex items-center gap-3">
        {running && <span className="h-3 w-3 animate-pulse rounded-full bg-sky-400" />}
        <div className="text-lg font-semibold text-white">{running ? `Ставим на ${state.device?.model || 'iPhone'}…` : `Готово: установлено ${done} из ${s.apps.length}`}</div>
      </div>
      <ul className="mt-4 space-y-2">
        {s.apps.map(a => {
          const r = resolveApp(a)
          return (
            <li key={a.bundle_id} data-progress-app={a.bundle_id} data-status={a.status} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
              <AppIcon app={r} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{r.name}{a.version ? <span className="ml-1 text-xs text-slate-500">{a.version}</span> : null}</span>{a.error ? <span className="block text-xs text-red-300/90">{a.error}</span> : null}</span>
              <Badge map={APP_STATUS} value={a.status} />
            </li>
          )
        })}
      </ul>
      {running && (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={() => helperPost('/api/cancel').then(refresh)} className={BTN_SECONDARY}>Остановить после текущего</button>
          <span className="text-xs text-slate-500">Не отключайте iPhone до конца установки.</span>
        </div>
      )}
    </div>
  )
}

function TokenModal({ api, onClose, onCreated }: { api: (p: string, i?: RequestInit) => Promise<Response>; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('Mac в павильоне')
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
  const cmd = created ? `python3 ~/takesmart_station.py --setup --backend ${backendOrigin()} --token ${created.token}` : ''
  return (
    <Modal title={created ? 'Токен помощника' : 'Токен для отдельного Mac'} onClose={onClose}>
      {!created ? (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-slate-400">Нужен, только если помощник стоит на Mac, где этот раздел не открывают. Иначе раздел привяжет помощника сам.</p>
          <label className="block text-sm text-slate-300">Как назвать<input value={name} onChange={e => setName(e.target.value)} required minLength={2} className={`${INPUT} mt-1`} /></label>
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button><button type="submit" disabled={busy} className={BTN_PRIMARY}>Получить токен</button></div>
        </form>
      ) : (
        <div className="space-y-3 text-sm text-slate-300">
          <p>Токен для «{created.name}». Показывается <b className="text-white">только сейчас</b>.</p>
          <Cmd text={created.token} />
          <p>На том Mac один раз выполнить:</p>
          <Cmd text={cmd} />
          <div className="flex justify-end"><button type="button" onClick={onClose} className={BTN_PRIMARY}>Готово</button></div>
        </div>
      )}
    </Modal>
  )
}
