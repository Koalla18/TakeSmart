import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { classifyApp, resolveApp } from '../lib/appCatalog'
import { REMOVED_FROM_RU_STORE, storeIdIcon } from '../lib/storeIcons'
import { api, errorText, type CommandType, type ConsoleData, type Device, type HelperConsole, type Purchase, type Station } from '../lib/installStations'

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «iPhone» в PWA «TakeSmart — Заказы». Покупатель подключает iPhone кабелем
// к Mac с помощником (public/station/takesmart_station.py), вводит свой Apple ID —
// и здесь плитками с иконками появляется всё, что когда-либо было на этом аккаунте и
// чего сейчас нет на телефоне. Первыми — русские приложения, которых больше нет в
// российском App Store (банки и т. п.): ради них обычно и приходят.
//
// Общение с помощником — через сервер (/api/installs/stations/*), как в админке:
// помощник раз в секунду шлёт состояние и забирает команды.
// ─────────────────────────────────────────────────────────────────────────────

const CONSOLE_POLL_MS = 1000

// ── Иконка: из App Store → наш логотип по App Store ID → логотип из каталога → буква ──
function iconSources(p: Purchase): string[] {
  const r = resolveApp(p)
  return [p.icon, storeIdIcon(p.id), r.icon].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i)
}

function Tile({ p, size = 60 }: { p: Purchase; size?: number }) {
  const sources = useMemo(() => iconSources(p), [p])
  const [i, setI] = useState(0)
  const r = resolveApp(p)
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.225) }
  if (i < sources.length) return <img src={sources[i]} alt="" width={size} height={size} loading="lazy" style={style} className="shrink-0 bg-white/5 object-cover ring-1 ring-white/10" onError={() => setI(n => n + 1)} />
  return <span aria-hidden="true" style={{ ...style, background: `hsl(${r.hue} 45% 30%)`, fontSize: Math.round(size * 0.42) }} className="flex shrink-0 items-center justify-center font-bold text-white/90 ring-1 ring-white/10">{r.letter}</span>
}

function isRemoved(p: Purchase): boolean {
  if (typeof p.removed === 'boolean') return p.removed
  return REMOVED_FROM_RU_STORE.has(String(p.id ?? ''))  // помощник/сервер старее 0.3.8 — берём наш список
}

// ── Вкладка ──────────────────────────────────────────────────────────────────
export function IphoneTab({ stations }: { stations: Station[] | null }) {
  const online = useMemo(() => (stations || []).filter(s => s.online), [stations])
  const [chosen, setChosen] = useState<string | null>(null)
  const active = online.find(s => s.id === chosen) || online.find(s => s.state?.device) || online[0] || null

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl" style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}>
        <div className="mx-auto flex max-w-xl items-center gap-2.5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-lg ring-1 ring-white/10">📱</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold leading-tight">iPhone покупателя</div>
            <div className="truncate text-[11px] leading-tight text-slate-500">{stations === null ? 'ищем помощника…' : active ? `помощник «${active.name}» на связи` : 'помощник на Mac не на связи'}</div>
          </div>
        </div>
        {online.length > 1 && (
          <div className="mx-auto flex max-w-xl gap-2 overflow-x-auto px-4 pb-2">
            {online.map(s => <button key={s.id} onClick={() => setChosen(s.id)} className={`flex-shrink-0 rounded-full px-3 py-1 text-xs ${s.id === active?.id ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300'}`}>{s.name}{s.state?.device ? ' · 📱' : ''}</button>)}
          </div>
        )}
      </header>
      <div className="mx-auto max-w-xl px-4 pt-4">
        {stations === null ? <div className="h-32 animate-pulse rounded-3xl bg-white/[0.04]" />
          : !active ? <Offline stations={stations} />
          : <Console key={active.id} station={active} />}
      </div>
    </div>
  )
}

function Offline({ stations }: { stations: Station[] }) {
  const known = stations.filter(s => s.last_seen_at)
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
      <div className="text-base font-semibold text-white">Помощник на Mac не на связи</div>
      <p className="mt-1.5 text-slate-400">Он видит iPhone по кабелю и ставит приложения. Как только Mac с помощником включится, здесь появится подключённый телефон.</p>
      {known.length > 0
        ? <div className="mt-3 space-y-1 text-xs text-slate-500">{known.map(s => <div key={s.id}>«{s.name}» был на связи {new Date(s.last_seen_at!).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>)}
            <div>Если Mac включён, а связи нет — в Терминале на нём: <code className="rounded bg-black/40 px-1 text-yellow-100">python3 ~/takesmart_station.py --autostart</code></div></div>
        : <p className="mt-3 text-xs text-slate-500">Ни один Mac ещё не подключён. Подключить: админка → «Приложения» → получить команду для Mac.</p>}
    </div>
  )
}

function useConsole(stationId: string) {
  const [data, setData] = useState<ConsoleData | null>(null)
  const known = useRef<{ version: number; list: Purchase[] }>({ version: -1, list: [] })
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (document.hidden) return
      try {
        const k = known.current
        const r = await api(`/stations/${stationId}/console${k.version >= 0 ? `?pv=${k.version}` : ''}`)
        if (!r.ok || !alive) return
        const d: ConsoleData = await r.json()
        if (d.purchases) known.current = { version: d.purchases_version, list: d.purchases }
        else if (d.purchases_version !== k.version) known.current = { version: -1, list: k.list }
        setData({ ...d, purchases: known.current.list })
      } catch { /* сеть */ }
    }
    load()
    const t = window.setInterval(load, CONSOLE_POLL_MS)
    return () => { alive = false; window.clearInterval(t) }
  }, [stationId])
  const send = useCallback(async (type: CommandType, payload: Record<string, unknown> = {}): Promise<string | null> => {
    try {
      const r = await api(`/stations/${stationId}/commands`, { method: 'POST', body: JSON.stringify({ type, payload }) })
      return r.ok ? null : await errorText(r)
    } catch { return 'Нет связи с сервером' }
  }, [stationId])
  return { data, send }
}

function Console({ station }: { station: Station }) {
  const { data, send } = useConsole(station.id)
  const [flash, setFlash] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const [noticeT, setNoticeT] = useState(0)
  const c = data?.console || {}
  const st = data?.station || station
  const device = st.state?.device || null
  const apple = st.state?.apple || {}
  const phoneReady = Boolean(device?.paired)
  const n = c.notice
  if (n && n.t !== noticeT) { setNoticeT(n.t); setFlash({ text: n.message, tone: n.tone === 'error' ? 'error' : 'info' }) }
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), 6000); return () => window.clearTimeout(t) }, [flash])
  const run = useCallback(async (type: CommandType, payload?: Record<string, unknown>) => {
    const err = await send(type, payload)
    if (err) setFlash({ text: err, tone: 'error' })
    return !err
  }, [send])

  return (
    <div className="space-y-3">
      {flash && <div className={`rounded-2xl px-4 py-2.5 text-sm ${flash.tone === 'error' ? 'border border-rose-500/20 bg-rose-500/[0.08] text-rose-200' : 'border border-white/10 bg-white/[0.05] text-slate-200'}`}>{flash.text}</div>}
      {(c.tools_missing || []).length > 0 && <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-xs text-rose-200">На Mac не хватает: {(c.tools_missing || []).join(', ')}. В Терминале: brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller</div>}
      <DeviceRow device={device} installed={Object.keys(c.installed || {}).length} />
      {apple.logged_in
        ? <AppleRow apple={apple} loading={Boolean(c.purchases_loading)} count={data?.purchases?.length ?? null} run={run} />
        : <AppleLogin c={c} run={run} />}
      {c.session ? <Progress session={c.session} purchases={data?.purchases || []} run={run} />
        : apple.logged_in ? <Picker purchases={data?.purchases || []} installed={c.installed || {}} loading={Boolean(c.purchases_loading)} phoneReady={phoneReady} run={run} />
        : null}
    </div>
  )
}

function DeviceRow({ device: d, installed }: { device: Device | null; installed: number }) {
  const tone = !d ? 'idle' : d.paired ? 'ok' : 'wait'
  return (
    <div className={`flex items-center gap-3 rounded-3xl border p-4 ${tone === 'ok' ? 'border-emerald-400/25 bg-emerald-400/[0.05]' : tone === 'wait' ? 'border-yellow-400/30 bg-yellow-400/[0.06]' : 'border-white/10 bg-white/[0.04]'}`} data-device={tone}>
      <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-xl ${tone === 'ok' ? 'bg-emerald-400/15' : tone === 'wait' ? 'bg-yellow-400/15' : 'bg-white/5'}`}>📱</span>
      <div className="min-w-0 flex-1">
        {!d ? <><div className="font-semibold text-slate-200">Подключите iPhone к Mac</div><div className="text-xs text-slate-400">Кабелем, разблокировать, нажать «Доверять»</div></>
          : !d.paired ? <><div className="font-semibold text-yellow-100">Нажмите «Доверять» на iPhone</div><div className="text-xs text-slate-400">Телефон виден, но ещё не доверяет этому Mac</div></>
          : <><div className="truncate font-semibold text-white">{d.model || 'iPhone'}{d.name ? <span className="font-normal text-slate-400"> · {d.name}</span> : null}</div><div className="text-xs text-slate-400">iOS {d.ios_version || '?'} · на телефоне {installed} приложений</div></>}
      </div>
    </div>
  )
}

function AppleRow({ apple, loading, count, run }: { apple: { email?: string | null; name?: string | null }; loading: boolean; count: number | null; run: (t: CommandType) => Promise<boolean> }) {
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/5 text-xl">👤</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{apple.name || 'Apple ID'}</div>
        <div className="truncate text-xs text-slate-400">{apple.email}{loading ? ' · читаем покупки…' : count !== null ? ` · покупок ${count}` : ''}</div>
      </div>
      <button onClick={() => run('refresh_purchases')} aria-label="Обновить список" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-300 active:scale-95">↻</button>
      <button onClick={() => run('logout')} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-300 active:scale-95">Выйти</button>
    </div>
  )
}

const FIELD = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[15px] text-white placeholder-slate-500 outline-none focus:border-yellow-400/50'
const PRIMARY = 'w-full rounded-xl bg-yellow-400 py-3 text-sm font-semibold text-gray-950 transition active:scale-[0.99] disabled:opacity-50'

function AppleLogin({ c, run }: { c: HelperConsole; run: (t: CommandType, p?: Record<string, unknown>) => Promise<boolean> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const l = c.login || { status: 'idle' as const, message: null }
  const working = l.status === 'working' || sending
  const codeStep = l.status === 'need_code' || (l.status === 'working' && l.pending)
  useEffect(() => { if (!sending) return; const t = window.setTimeout(() => setSending(false), 2500); return () => window.clearTimeout(t) }, [sending])

  const login = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setSending(true)
    if (await run('login', { email: email.trim(), password })) setPassword(''); else setSending(false)
  }
  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setSending(true)
    if (await run('code', { code: code.trim() })) setCode(''); else setSending(false)
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Apple ID покупателя</div>
      {codeStep ? (
        <form onSubmit={confirm} className="mt-2 space-y-2.5">
          <p className="text-sm text-slate-300">Apple прислала 6-значный код на устройства покупателя или по SMS (не на почту).</p>
          <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Код подтверждения" className={FIELD} autoFocus />
          <button type="submit" disabled={working || !code.trim()} className={PRIMARY}>{working ? 'Проверяем…' : 'Подтвердить'}</button>
          <div className="flex justify-between text-xs">
            <button type="button" disabled={working} onClick={() => run('resend_code')} className="text-slate-400">Прислать код ещё раз</button>
            <button type="button" onClick={() => run('reset_login')} className="text-slate-400">Другой Apple ID</button>
          </div>
          {l.message && l.status !== 'working' && <p className="text-xs text-yellow-200">{l.message}</p>}
        </form>
      ) : (
        <form onSubmit={login} className="mt-2 space-y-2.5">
          <p className="text-xs text-slate-400">После входа появится всё, что покупатель когда-либо скачивал. Пароль и код уходят в Apple через помощника и у нас не сохраняются.</p>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="off" autoCapitalize="none" placeholder="Почта Apple ID" className={FIELD} />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="off" placeholder="Пароль" className={FIELD} />
          <button type="submit" disabled={working || !email.trim() || !password} className={PRIMARY}>{working ? 'Связываемся с Apple…' : 'Войти'}</button>
          {l.message && l.status === 'error' && <p className="text-sm text-rose-300">{l.message}</p>}
        </form>
      )}
    </div>
  )
}

// ── Плитки приложений ────────────────────────────────────────────────────────
interface Item { p: Purchase; name: string; removed: boolean; russian: boolean; bank: boolean; onPhone: boolean }

function Picker({ purchases, installed, loading, phoneReady, run }: { purchases: Purchase[]; installed: Record<string, unknown>; loading: boolean; phoneReady: boolean; run: (t: CommandType, p?: Record<string, unknown>) => Promise<boolean> }) {
  const [q, setQ] = useState('')
  const [showInstalled, setShowInstalled] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [starting, setStarting] = useState(false)
  useEffect(() => { if (!starting) return; const t = window.setTimeout(() => setStarting(false), 4000); return () => window.clearTimeout(t) }, [starting])

  const items = useMemo<Item[]>(() => purchases.map(p => {
    const r = resolveApp(p)
    return { p, name: r.name, removed: isRemoved(p), russian: classifyApp(p).russian, bank: r.bank, onPhone: Boolean(installed[p.bundle_id]) }
  }), [purchases, installed])

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const pool = items.filter(it => (showInstalled || !it.onPhone) && (!needle || `${it.name} ${it.p.name} ${it.p.bundle_id}`.toLowerCase().includes(needle)))
    // Внутри секции: банки первыми, потом как в истории покупок (свежие сверху)
    const order = (a: Item, b: Item) => Number(b.bank) - Number(a.bank)
    return [
      { key: 'ru-removed', title: 'Русские — удалены из App Store', hint: 'Скачать заново можно только отсюда', items: pool.filter(it => it.removed && it.russian).sort(order) },
      { key: 'removed', title: 'Другие удалённые из App Store', hint: null, items: pool.filter(it => it.removed && !it.russian).sort(order) },
      { key: 'store', title: 'Есть в App Store', hint: 'Можно поставить и из App Store на телефоне', items: pool.filter(it => !it.removed).sort((a, b) => Number(b.russian) - Number(a.russian) || order(a, b)) },
    ].filter(s => s.items.length)
  }, [items, q, showInstalled])
  const onPhoneCount = items.filter(it => it.onPhone).length

  const toggle = (bundle: string) => setSelected(prev => { const n = new Set(prev); if (n.has(bundle)) n.delete(bundle); else n.add(bundle); return n })
  const install = async () => {
    const apps = purchases.filter(p => selected.has(p.bundle_id)).map(p => ({ bundle_id: p.bundle_id, name: resolveApp(p).name, id: p.id }))
    if (!apps.length) return
    setStarting(true)
    if (await run('install', { apps })) setSelected(new Set()); else setStarting(false)
  }

  if (!purchases.length) {
    return <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-slate-400">{loading ? <><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-yellow-400" />Читаем историю покупок… Обычно до полуминуты.</> : 'В истории покупок этого Apple ID нет приложений для iPhone'}</div>
  }

  return (
    <div className="pb-24">
      <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="🔍 Сбер, Т-Банк, Пятёрочка…" className={FIELD} data-app-search />
      <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-slate-500">
        <span className="min-w-0">В покупках {items.length}{onPhoneCount ? ` · на iPhone уже ${onPhoneCount}` : ''}</span>
        {onPhoneCount > 0 && <button onClick={() => setShowInstalled(v => !v)} className="shrink-0 whitespace-nowrap text-slate-400 underline-offset-2 hover:underline">{showInstalled ? 'Скрыть стоящие' : 'Показать стоящие'}</button>}
      </div>

      {sections.length === 0 && <div className="mt-6 text-center text-sm text-slate-500">{q ? 'Ничего не найдено' : 'Всё из покупок уже стоит на телефоне'}</div>}
      {sections.map(s => (
        <section key={s.key} className="mt-5" data-section={s.key}>
          <div className="flex items-baseline gap-2 px-1">
            <h2 className={`text-xs font-semibold uppercase tracking-wider ${s.key === 'ru-removed' ? 'text-yellow-300' : 'text-slate-400'}`}>{s.title}</h2>
            <span className="text-[11px] text-slate-600">{s.items.length}</span>
          </div>
          {s.hint && <div className="px-1 text-[11px] text-slate-500">{s.hint}</div>}
          <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5">
            {s.items.map(it => {
              const on = selected.has(it.p.bundle_id)
              return (
                <button key={it.p.bundle_id} onClick={() => toggle(it.p.bundle_id)} aria-pressed={on} data-app-tile={it.p.bundle_id}
                  className={`relative flex min-w-0 flex-col items-center gap-1.5 rounded-2xl p-1.5 transition active:scale-95 ${on ? 'bg-yellow-400/10 ring-1 ring-yellow-400/60' : ''}`}>
                  <span className="relative">
                    <Tile p={it.p} />
                    {on && <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-gray-950 ring-2 ring-slate-950">✓</span>}
                    {it.onPhone && !on && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-slate-800 px-1.5 text-[9px] text-slate-300 ring-1 ring-white/10">стоит</span>}
                  </span>
                  <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-slate-200">{it.name}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <div className="fixed inset-x-0 z-30 px-4" style={{ bottom: 'calc(68px + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto max-w-xl">
          {selected.size > 0 && (
            <button onClick={install} disabled={!phoneReady || starting} data-install-btn
              className="w-full rounded-2xl bg-yellow-400 py-3.5 text-[15px] font-bold text-gray-950 shadow-2xl shadow-black/50 transition active:scale-[0.99] disabled:opacity-60">
              {starting ? 'Запускаем…' : !phoneReady ? 'Подключите iPhone, чтобы установить' : `Установить на iPhone (${selected.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const APP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'в очереди', cls: 'text-slate-400' },
  downloading: { label: 'скачиваем', cls: 'text-sky-300' },
  installing: { label: 'ставим', cls: 'text-sky-300' },
  installed: { label: 'установлено', cls: 'text-emerald-300' },
  not_owned: { label: 'нет в покупках', cls: 'text-yellow-300' },
  failed: { label: 'ошибка', cls: 'text-rose-300' },
  skipped: { label: 'пропущено', cls: 'text-slate-500' },
}

function Progress({ session: s, purchases, run }: { session: NonNullable<HelperConsole['session']>; purchases: Purchase[]; run: (t: CommandType) => Promise<boolean> }) {
  const byBundle = useMemo(() => new Map(purchases.map(p => [p.bundle_id, p])), [purchases])
  const running = s.status === 'running' && !s.finished
  const done = s.apps.filter(a => a.status === 'installed').length
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4" data-install-progress data-finished={s.finished ? '1' : '0'}>
      <div className="flex items-center gap-2 text-base font-semibold">
        {running && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400" />}
        {running ? 'Ставим на iPhone…' : `Установлено ${done} из ${s.apps.length}`}
      </div>
      <ul className="mt-3 space-y-2">
        {s.apps.map(a => {
          const m = APP_STATUS[a.status] || { label: a.status, cls: 'text-slate-400' }
          return (
            <li key={a.bundle_id} className="flex items-center gap-3">
              <Tile p={byBundle.get(a.bundle_id) || { ...a, id: null }} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{resolveApp(a).name}{a.version ? <span className="ml-1 text-xs text-slate-500">{a.version}</span> : null}</div>
                {a.error ? <div className="text-xs text-rose-300/90">{a.error}</div> : a.status === 'downloading' && a.progress ? <div className="text-xs text-sky-300/80">скачано {a.progress}</div> : null}
              </div>
              <span className={`text-xs ${m.cls}`}>{m.label}</span>
            </li>
          )
        })}
      </ul>
      {running
        ? <div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Не отключайте iPhone до конца</span><button onClick={() => run('cancel')} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-300">Остановить</button></div>
        : <button onClick={() => run('dismiss_session')} className={`${PRIMARY} mt-4`}>Готово</button>}
    </div>
  )
}
