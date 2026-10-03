import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { resolveApp } from '../lib/appCatalog'
import { APPS_DEFAULT_SUBTITLE, APPS_DEFAULT_TITLE, orderPrice, publicInstalls, rub, type PublicCatalog, type PublicCatalogApp } from '../lib/installs'

// Витрина услуги «Приложения на iPhone»: /apps.
// Обычный посетитель выбирает приложения и оставляет заявку (если приём с сайта включён).
// Менеджер открывает «Режим сотрудника» своим паролем — тогда то же самое можно поставить
// сразу (кнопка «Установить»). Пароль знает только менеджер, у обычного пользователя его нет.

const CATEGORY_ORDER = ['Банки', 'Маркетплейсы', 'Транспорт', 'Сервисы', 'Связь', 'Госуслуги']
const STAFF_KEY = 'ts-apps-staff'

function Tile({ app, selected, onToggle }: { app: PublicCatalogApp; selected: boolean; onToggle: () => void }) {
  const r = resolveApp({ name: app.name, bundle_id: app.bundle_id, icon: app.icon_url, genre: app.genre })
  const [broken, setBroken] = useState(false)
  const size = 48
  const style = { width: size, height: size, borderRadius: 12 }
  const icon = r.icon && !broken
    ? <img src={r.icon} alt="" width={size} height={size} loading="lazy" style={style} className="shrink-0 bg-gray-100 object-cover" onError={() => setBroken(true)} />
    : <span aria-hidden="true" style={{ ...style, background: `hsl(${r.hue} 45% 42%)`, fontSize: 20 }} className="flex shrink-0 items-center justify-center font-bold text-white">{r.letter}</span>
  return (
    <button type="button" onClick={onToggle} aria-pressed={selected} data-app-tile={app.bundle_id}
      className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${selected ? 'border-yellow-400 bg-yellow-50 ring-1 ring-yellow-400' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'}`}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-gray-900">{app.name}</span>
        <span className="block truncate text-xs text-gray-500">{app.version ? `версия ${app.version}` : (app.category || 'Приложение')}</span>
      </span>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${selected ? 'border-yellow-400 bg-yellow-400 text-gray-900' : 'border-gray-300 text-transparent'}`}>✓</span>
    </button>
  )
}

const STEPS = [
  ['Выбираете приложения', 'Банки, маркетплейсы и сервисы, которых больше нет в App Store.'],
  ['Входите в аккаунт TakeSmart', 'Только в разделе «Контент и покупки». Из iCloud выходить не нужно.'],
  ['Скачиваете из App Store', 'Приложения берутся из списка покупок нашего аккаунта — это обычная загрузка.'],
  ['Возвращаете свой аккаунт', 'Приложения остаются на телефоне и работают.'],
] as const

const FAQ = [
  ['Что будет с моими данными?', 'Из iCloud вы не выходите: фото, контакты, пароли и «Локатор» остаются как были. Аккаунт TakeSmart вводится только в разделе «Контент и покупки» и только на время установки.'],
  ['Приложения будут обновляться?', 'Через App Store — нет. Когда выйдет новая версия, её ставят так же, как в первый раз. Сами приложения продолжают работать.'],
  ['Сколько это занимает?', 'Обычно 10–15 минут на всё.'],
  ['Нужного приложения нет в списке', 'Напишите или позвоните — подскажем, можно ли его поставить.'],
] as const

export function AppsPage() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('Все')
  // Заявка (обычный посетитель)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Режим сотрудника
  const [staffCode, setStaffCode] = useState<string | null>(() => { try { return sessionStorage.getItem(STAFF_KEY) } catch { return null } })
  const [askStaff, setAskStaff] = useState(false)

  useEffect(() => {
    const prev = document.title
    document.title = 'Приложения на iPhone, которых нет в App Store — TakeSmart'
    publicInstalls.catalog().then(setCatalog).catch(() => setFailed(true))
    return () => { document.title = prev }
  }, [])

  const apps = useMemo(() => catalog?.apps || [], [catalog])
  const categories = useMemo(() => {
    const present = new Set(apps.map(a => a.category || 'Прочее'))
    return CATEGORY_ORDER.filter(c => present.has(c)).concat([...present].filter(c => !CATEGORY_ORDER.includes(c)))
  }, [apps])
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of apps) m[a.category || 'Прочее'] = (m[a.category || 'Прочее'] || 0) + 1
    return m
  }, [apps])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return apps.filter(a => {
      if (needle && !`${a.name} ${a.bundle_id}`.toLowerCase().includes(needle)) return false
      if (cat !== 'Все' && (a.category || 'Прочее') !== cat) return false
      return true
    })
  }, [apps, q, cat])
  // При «Все» без поиска — группируем по категориям; иначе плоский список
  const grouped = useMemo(() => {
    if (cat !== 'Все' || q.trim()) return null
    return categories.map(c => ({ cat: c, items: filtered.filter(a => (a.category || 'Прочее') === c) })).filter(g => g.items.length)
  }, [categories, filtered, cat, q])

  const chosen = picked.map(id => apps.find(a => a.id === id)).filter((a): a is PublicCatalogApp => Boolean(a))
  const total = catalog ? orderPrice(catalog, chosen.length) : 0
  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const digits = phone.replace(/\D/g, '')
  const staffMode = Boolean(staffCode)

  const setStaff = (code: string | null) => {
    setStaffCode(code)
    try { if (code) sessionStorage.setItem(STAFF_KEY, code); else sessionStorage.removeItem(STAFF_KEY) } catch { /* приватный режим */ }
  }

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chosen.length || name.trim().length < 2 || digits.length < 10 || !consent || sending) return
    setSending(true); setError(null)
    try {
      const res = await publicInstalls.createOrder({ app_ids: chosen.map(a => a.id), name: name.trim(), phone, consent })
      navigate(`/i/${res.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось отправить заявку. Попробуйте ещё раз.')
      setSending(false)
    }
  }
  const staffInstall = async () => {
    if (!chosen.length || !staffCode || sending) return
    setSending(true); setError(null)
    try {
      const res = await publicInstalls.staffOrder({ app_ids: chosen.map(a => a.id), code: staffCode })
      navigate(`/i/${res.token}`)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 401) { setStaff(null); setAskStaff(true); setError('Неверный пароль менеджера.') }
      else setError(err instanceof Error ? err.message : 'Не получилось начать установку.')
      setSending(false)
    }
  }

  const tg = (catalog?.support_telegram || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '')
  const supportPhone = (catalog?.support_phone || '').trim()
  // Показ каталога покупателям и приём заявок настраиваются в админке отдельно
  const showToVisitors = Boolean(catalog?.enabled)
  const canOrder = Boolean(catalog?.requests_enabled)
  const showPrice = catalog ? catalog.show_price : true
  const hasCatalog = apps.length > 0
  const canUseStaff = Boolean(catalog?.staff_mode)
  // Показ каталога выключен в админке — обычный посетитель видит только «приходите в салон»,
  // менеджер — каталог после ввода пароля
  const showCatalog = hasCatalog && (showToVisitors || staffMode)

  return (
    <div className="bg-white" data-apps-page data-enabled={catalog ? (showToVisitors ? '1' : '0') : undefined} data-requests={canOrder ? '1' : '0'} data-staff={staffMode ? '1' : '0'}>
      <section className="relative overflow-hidden bg-gray-900 text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-yellow-400/20 blur-3xl" />
        <Container size="md" className="relative py-12 sm:py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-yellow-400">Услуга TakeSmart</p>
          {!catalog && !failed ? (
            <div aria-hidden="true"><div className="mt-3 h-10 max-w-2xl animate-pulse rounded-xl bg-white/10 sm:h-14" /><div className="mt-5 h-5 max-w-xl animate-pulse rounded bg-white/10" /></div>
          ) : (
            <>
              <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl" data-apps-title>{catalog?.page_title || APPS_DEFAULT_TITLE}</h1>
              <p className="mt-4 max-w-2xl whitespace-pre-line text-lg text-gray-300" data-apps-subtitle>{catalog?.page_subtitle || APPS_DEFAULT_SUBTITLE}</p>
            </>
          )}
          {catalog && showPrice && (
            <p className="mt-6 inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl bg-white/10 px-5 py-3">
              <span className="text-3xl font-bold text-yellow-400">{rub(catalog.price)}</span><span className="text-gray-300">за приложение</span>
              {/* На телефоне скидка — отдельной строкой: иначе перенос начинает строку с «·» */}
              {catalog.bulk_price < catalog.price && <span className="basis-full text-gray-400 sm:basis-auto"><span className="hidden sm:inline">· </span>от {catalog.bulk_min} шт. — по {rub(catalog.bulk_price)}</span>}
            </p>
          )}
          {staffMode && (
            <div className="mt-4 inline-flex items-center gap-3 rounded-xl bg-yellow-400/15 px-4 py-2 text-sm text-yellow-100" data-staff-banner>
              Режим сотрудника включён — можно ставить приложения сразу.
              <button type="button" onClick={() => setStaff(null)} className="underline decoration-dotted hover:text-white">выйти</button>
            </div>
          )}
        </Container>
      </section>

      <Container size="md" className="py-10">
        {!catalog && !failed && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />)}</div>}

        {catalog && showCatalog && (
          <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              <div className="sticky top-16 z-10 -mx-4 bg-white/95 px-4 py-3 backdrop-blur sm:top-20">
                <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Поиск: Сбер, ВТБ, Госуслуги…" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] focus:border-yellow-400 focus:outline-none" data-apps-search />
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {['Все', ...categories].map(c => (
                    <button key={c} type="button" onClick={() => setCat(c)} data-cat={c}
                      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${cat === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                      {c}{c !== 'Все' && <span className="ml-1.5 text-xs opacity-60">{counts[c]}</span>}
                    </button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="mt-6 text-gray-500">Ничего не найдено.</p>
              ) : grouped ? (
                <div className="mt-4 space-y-7">
                  {grouped.map(g => (
                    <section key={g.cat} data-cat-section={g.cat}>
                      <h2 className="mb-3 text-lg font-bold text-gray-900">{g.cat} <span className="text-sm font-normal text-gray-400">{g.items.length}</span></h2>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {g.items.map(a => <Tile key={a.id} app={a} selected={picked.includes(a.id)} onToggle={() => toggle(a.id)} />)}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {filtered.map(a => <Tile key={a.id} app={a} selected={picked.includes(a.id)} onToggle={() => toggle(a.id)} />)}
                </div>
              )}
            </div>

            {/* Панель заказа: справа на компьютере, под каталогом на телефоне */}
            <div id="order" className="scroll-mt-24">
              <div className="rounded-3xl border border-gray-200 p-5 lg:sticky lg:top-24">
                <SummaryBody
                  chosen={chosen} total={total} showPrice={showPrice} canOrder={canOrder} staffMode={staffMode} sending={sending} error={error}
                  name={name} setName={setName} phone={phone} setPhone={setPhone} consent={consent} setConsent={setConsent}
                  onToggle={toggle} onRequest={submitRequest} onStaffInstall={staffInstall}
                  canRequest={chosen.length > 0 && name.trim().length >= 2 && digits.length >= 10 && consent} />
              </div>
            </div>
          </div>
        )}

        {((catalog && !showCatalog) || failed) && (
          <div className="rounded-3xl border border-gray-200 p-6 sm:p-8" data-apps-offline>
            <h2 className="text-2xl font-bold text-gray-900">Приходите в салон TakeSmart</h2>
            <p className="mt-2 max-w-2xl text-gray-600">Сотрудник поставит приложения на ваш iPhone за 10–15 минут. С собой — только телефон.</p>
            {(supportPhone || tg) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {supportPhone && <a href={`tel:${supportPhone.replace(/[^\d+]/g, '')}`} className="rounded-xl bg-yellow-400 px-5 py-3 font-semibold text-gray-900 hover:bg-yellow-300">Позвонить {supportPhone}</a>}
                {tg && <a href={`https://t.me/${encodeURIComponent(tg)}`} target="_blank" rel="noreferrer noopener" className="rounded-xl bg-gray-100 px-5 py-3 font-semibold text-gray-900 hover:bg-gray-200">Написать в Telegram</a>}
              </div>
            )}
          </div>
        )}

        <h2 className="mt-14 text-2xl font-bold text-gray-900">Как это работает</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-4 rounded-2xl bg-gray-50 p-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 font-bold text-white">{i + 1}</span>
              <span><span className="block font-semibold text-gray-900">{title}</span><span className="mt-0.5 block text-sm text-gray-600">{text}</span></span>
            </li>
          ))}
        </ol>

        <h2 className="mt-12 text-2xl font-bold text-gray-900">Частые вопросы</h2>
        <div className="mt-4 divide-y divide-gray-200 rounded-2xl border border-gray-200">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-gray-900">{question}<span className="text-gray-400 transition group-open:rotate-45">+</span></summary>
              <p className="mt-2 text-gray-600">{answer}</p>
            </details>
          ))}
        </div>

        {canUseStaff && !staffMode && (
          <div className="mt-10 text-center">
            <button type="button" onClick={() => setAskStaff(true)} data-staff-open className="text-sm text-gray-400 underline decoration-dotted hover:text-gray-700">Я сотрудник TakeSmart</button>
          </div>
        )}
      </Container>

      {/* Нижняя панель на телефоне */}
      {catalog && showCatalog && chosen.length > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/95 p-3 backdrop-blur lg:hidden" data-apps-bar>
          {/* справа место под круглую кнопку Telegram сайта — иначе она закрывает «Установить» */}
          <div className="mx-auto flex max-w-md items-center gap-3 pr-16">
            <div className="min-w-0 flex-1"><div className="text-xs text-gray-500">{chosen.length} выбрано</div>{showPrice && <div className="text-lg font-bold text-gray-900">{rub(total)}</div>}</div>
            {staffMode
              ? <button type="button" onClick={staffInstall} disabled={sending} className="rounded-2xl bg-gray-900 px-5 py-3 font-semibold text-white disabled:opacity-50" data-mobile-install>{sending ? '…' : 'Установить'}</button>
              : canOrder
                ? <a href="#order" className="rounded-2xl bg-yellow-400 px-5 py-3 font-semibold text-gray-900">Оформить</a>
                : supportPhone
                  ? <a href={`tel:${supportPhone.replace(/[^\d+]/g, '')}`} className="rounded-2xl bg-yellow-400 px-5 py-3 font-semibold text-gray-900">Позвонить</a>
                  : null}
          </div>
        </div>
      )}

      {askStaff && <StaffModal onClose={() => setAskStaff(false)} onSubmit={code => { setStaff(code); setAskStaff(false); setError(null) }} />}
    </div>
  )
}

function SummaryBody({ chosen, total, showPrice, canOrder, staffMode, sending, error, name, setName, phone, setPhone, consent, setConsent, onToggle, onRequest, onStaffInstall, canRequest }: {
  chosen: PublicCatalogApp[]; total: number; showPrice: boolean; canOrder: boolean; staffMode: boolean; sending: boolean; error: string | null
  name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void; consent: boolean; setConsent: (v: boolean) => void
  onToggle: (id: string) => void; onRequest: (e: React.FormEvent) => void; onStaffInstall: () => void; canRequest: boolean
}) {
  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900">{staffMode ? 'Установка' : 'Заявка'}</h3>
      {chosen.length === 0 ? <p className="mt-2 text-sm text-gray-500">Отметьте приложения слева — посчитаем стоимость.</p> : (
        <ul className="mt-3 space-y-2">
          {chosen.map(a => {
            const r = resolveApp({ name: a.name, bundle_id: a.bundle_id, icon: a.icon_url })
            return (
              <li key={a.id} className="flex items-center gap-2.5 text-sm">
                {r.icon ? <img src={r.icon} alt="" width={26} height={26} className="rounded-md bg-gray-100 object-cover" /> : <span style={{ background: `hsl(${r.hue} 45% 42%)` }} className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-xs font-bold text-white">{r.letter}</span>}
                <span className="min-w-0 flex-1 truncate text-gray-900">{a.name}</span>
                <button type="button" onClick={() => onToggle(a.id)} aria-label={`Убрать ${a.name}`} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">✕</button>
              </li>
            )
          })}
        </ul>
      )}
      {showPrice && <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-3"><span className="text-gray-500">Итого</span><span className="text-2xl font-bold text-gray-900" data-apps-total>{rub(total)}</span></div>}

      {staffMode ? (
        <>
          <button type="button" onClick={onStaffInstall} disabled={!chosen.length || sending} className="mt-4 w-full rounded-2xl bg-gray-900 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-gray-800 disabled:opacity-50" data-staff-install>
            {sending ? 'Начинаем…' : chosen.length ? `Установить ${chosen.length}` : 'Выберите приложения'}
          </button>
          <p className="mt-2 text-xs text-gray-500">Откроется страница установки: вход в аккаунт TakeSmart и шаги по скачиванию.</p>
        </>
      ) : canOrder ? (
        <form onSubmit={onRequest} className="mt-3">
          <input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" placeholder="Ваше имя" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-[15px] focus:border-yellow-400 focus:outline-none" data-apps-name />
          <input value={phone} onChange={e => setPhone(e.target.value)} required type="tel" autoComplete="tel" placeholder="+7 900 000-00-00" className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-[15px] focus:border-yellow-400 focus:outline-none" data-apps-phone />
          <label className="mt-3 flex items-start gap-2.5 text-sm text-gray-600">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-yellow-400" data-apps-consent />
            <span>Согласен на <Link to="/personal-data" className="underline">обработку персональных данных</Link></span>
          </label>
          <button type="submit" disabled={!canRequest || sending} className="mt-4 w-full rounded-2xl bg-yellow-400 px-5 py-3.5 text-base font-semibold text-gray-900 transition hover:bg-yellow-300 disabled:opacity-50" data-apps-submit>{sending ? 'Отправляем…' : 'Оставить заявку'}</button>
          <p className="mt-2 text-xs text-gray-500">Менеджер свяжется с вами, подтвердит оплату и поможет с установкой.</p>
        </form>
      ) : (
        <p className="mt-3 text-sm text-gray-600" data-apps-no-requests>Эти приложения ставят в салоне TakeSmart. Отметьте нужное и приходите — или позвоните нам, подскажем.</p>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}

function StaffModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = code.trim()
    if (!value || checking) return
    setChecking(true); setErr(null)
    try { await publicInstalls.staffCheck(value); onSubmit(value) } catch (x) { setErr(x instanceof Error ? x.message : 'Не получилось проверить пароль') }
    setChecking(false)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label="Режим сотрудника" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-sm sm:rounded-3xl">
        <h3 className="text-lg font-bold text-gray-900">Режим сотрудника</h3>
        <p className="mt-1 text-sm text-gray-600">Введите пароль менеджера, чтобы ставить приложения сразу. У покупателей этого пароля нет.</p>
        <form onSubmit={submit}>
          <input value={code} onChange={e => { setCode(e.target.value); setErr(null) }} type="password" autoFocus autoComplete="off" placeholder="Пароль менеджера" className={`mt-4 w-full rounded-xl border px-4 py-3 text-[15px] focus:border-yellow-400 focus:outline-none ${err ? 'border-red-300' : 'border-gray-200'}`} data-staff-code />
          {err && <p role="alert" className="mt-2 text-sm text-red-600" data-staff-error>{err}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 font-medium text-gray-700">Отмена</button>
            <button type="submit" disabled={!code.trim() || checking} className="flex-1 rounded-2xl bg-gray-900 px-4 py-3 font-semibold text-white disabled:opacity-50" data-staff-submit>{checking ? 'Проверяем…' : 'Войти'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
