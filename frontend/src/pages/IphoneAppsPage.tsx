import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { ClockIcon, PhoneIcon, ShieldCheckIcon, CheckIcon, ArrowRightIcon } from '../components/ui/Icons'
import { API_BASE_URL } from '../lib/config'

// ─────────────────────────────────────────────────────────────────────────────
// /iphone-apps — услуга «Установка приложений на iPhone»: каталог с ценами,
// как это работает, честные ограничения и заявка. Установка идёт по кабелю
// в павильоне: приложение скачивается из истории покупок Apple ID покупателя
// и ставится оригинальным файлом, подписанным Apple. Без сертификатов и джейлбрейка.
// ─────────────────────────────────────────────────────────────────────────────

interface App { id: string; name: string; bundle_id: string; category: string; price: number | string; description: string | null; icon_url: string | null }

const CATEGORY: Record<string, { label: string; order: number }> = {
  bank: { label: 'Банки', order: 1 }, messenger: { label: 'Мессенджеры', order: 2 }, social: { label: 'Соцсети', order: 3 },
  service: { label: 'Сервисы', order: 4 }, other: { label: 'Другое', order: 5 },
}
const IPHONE_MODELS = ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone Air', 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 15 Plus', 'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14', 'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini', 'iPhone 12', 'iPhone 11', 'iPhone SE', 'Другой']

const fmtRub = (v: number | string) => `${Math.round(Number(v) || 0).toLocaleString('ru-RU')} ₽`

function AppIcon({ app }: { app: App }) {
  if (app.icon_url) return <img src={app.icon_url} alt="" className="h-12 w-12 rounded-2xl object-cover" loading="lazy" />
  const letter = app.name.trim().charAt(0).toUpperCase()
  const tone: Record<string, string> = { bank: 'bg-emerald-500', messenger: 'bg-sky-500', social: 'bg-blue-600', service: 'bg-orange-500', other: 'bg-gray-700' }
  return <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-bold text-white ${tone[app.category] || tone.other}`}>{letter}</div>
}

export function IphoneAppsPage() {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ name: '', phone: '', model: '', ios: '', comment: '', consent: false })
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const prev = document.title
    document.title = 'Установка приложений на iPhone — TakeSmart'
    fetch(`${API_BASE_URL}/api/installs/apps`).then(r => (r.ok ? r.json() : [])).then(setApps).catch(() => setApps([])).finally(() => setLoading(false))
    return () => { document.title = prev || 'TakeSmart' }
  }, [])

  const groups = useMemo(() => {
    const m = new Map<string, App[]>()
    for (const a of apps) { const k = CATEGORY[a.category] ? a.category : 'other'; m.set(k, [...(m.get(k) || []), a]) }
    return [...m.entries()].sort((a, b) => CATEGORY[a[0]].order - CATEGORY[b[0]].order)
  }, [apps])
  const total = apps.filter(a => picked.has(a.id)).reduce((s, a) => s + Number(a.price || 0), 0)
  const togglePick = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (picked.size === 0) { setError('Отметьте хотя бы одно приложение в списке выше'); return }
    if (!form.consent) { setError('Нужно согласие на обработку персональных данных'); return }
    setSending(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/installs/requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: form.name, customer_phone: form.phone, device_model: form.model || null, ios_version: form.ios || null, app_ids: [...picked], comment: form.comment || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x: { msg?: string }) => x.msg).join('. ') : 'Не удалось отправить заявку, позвоните нам')
        return
      }
      const d = await res.json()
      setDone(d.request_number)
    } catch { setError('Нет связи. Позвоните нам: +7 (999) 802-10-22') }
    finally { setSending(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <Section className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-24">
        <Container>
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-yellow-400/15 px-4 py-2 text-yellow-300">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
              В павильоне, по кабелю, 10 минут
            </div>
            <h1 className="mb-6 text-5xl font-bold text-white lg:text-6xl">
              Приложения, которых нет в App Store, <span className="text-yellow-400">на вашем iPhone</span>
            </h1>
            <p className="text-xl text-gray-400">
              Сбер, Т-Банк и другие удалённые приложения вернём на телефон оригинальным файлом Apple. Без сертификатов, без джейлбрейка и без срока годности
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href="#request" className="rounded-xl bg-yellow-400 px-8 py-4 font-semibold text-gray-900 transition-colors hover:bg-yellow-300">Оставить заявку</a>
              <a href="#apps" className="rounded-xl border-2 border-yellow-400 px-8 py-4 font-semibold text-yellow-400 transition-colors hover:bg-yellow-400 hover:text-gray-900">Список приложений</a>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="sm" className="bg-transparent">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 md:gap-6">
            {[
              { icon: <ShieldCheckIcon className="h-6 w-6" />, title: 'Оригинал от Apple', desc: 'Файл из истории покупок вашего Apple ID' },
              { icon: <ClockIcon className="h-6 w-6" />, title: 'Не слетает', desc: 'Никаких сертификатов на год' },
              { icon: <CheckIcon className="h-6 w-6" />, title: 'Пароль не храним', desc: 'Вводите его сами, только на нашем Mac' },
              { icon: <PhoneIcon className="h-6 w-6" />, title: 'При вас', desc: 'Установка в павильоне, за 10 минут' },
            ].map(item => (
              <div key={item.title} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-lg">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-yellow-400 text-gray-900">{item.icon}</div>
                <div><div className="font-semibold text-gray-900">{item.title}</div><div className="text-sm text-gray-500">{item.desc}</div></div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section id="apps" py="md" className="bg-transparent">
        <Container>
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-3xl font-bold text-gray-900">Что можем поставить</h2><p className="mt-1 text-gray-500">Отметьте нужное, внизу страницы заявка соберётся сама</p></div>
            {picked.size > 0 && <div className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white">Выбрано {picked.size} · {fmtRub(total)}</div>}
          </div>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white" />)}</div>
          ) : apps.length === 0 ? (
            <div className="rounded-3xl bg-white p-12 text-center shadow-lg"><p className="text-gray-500">Список приложений обновляется. Позвоните, подскажем по вашему.</p></div>
          ) : groups.map(([cat, list]) => (
            <div key={cat} className="mb-8">
              <div className="mb-3 flex items-center gap-3"><h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">{CATEGORY[cat].label}</h3><span className="h-px flex-1 bg-gray-200" /></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map(app => {
                  const on = picked.has(app.id)
                  return (
                    <button key={app.id} type="button" onClick={() => togglePick(app.id)} aria-pressed={on} data-app-card={app.bundle_id}
                      className={`flex w-full min-w-0 items-center gap-4 rounded-2xl border-2 bg-white p-4 text-left shadow-sm transition ${on ? 'border-yellow-400 ring-2 ring-yellow-400/30' : 'border-transparent hover:border-gray-200'}`}>
                      <AppIcon app={app} />
                      <div className="min-w-0 flex-1"><div className="font-semibold text-gray-900">{app.name}</div>{app.description && <div className="truncate text-sm text-gray-500">{app.description}</div>}</div>
                      <div className="text-right"><div className="font-bold text-gray-900">{fmtRub(app.price)}</div><div className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full ${on ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-transparent'}`}><CheckIcon className="h-3.5 w-3.5" /></div></div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </Container>
      </Section>

      <Section py="md" bg="gray">
        <Container>
          <h2 className="mb-8 text-3xl font-bold text-gray-900">Как это работает</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              ['01', 'Приходите с iPhone', 'В павильон А60 в ТЦ «Багратионовский». Заявка на сайте нужна, чтобы мы подготовились и вы не ждали.'],
              ['02', 'Подключаем к Mac', 'Вы сами вводите свой Apple ID и код подтверждения на нашем компьютере. Пароль уходит в Apple напрямую, мы его не видим и не храним.'],
              ['03', 'Приложение на телефоне', 'Скачиваем его из истории покупок вашего Apple ID и ставим по кабелю. Это тот же файл, что раздаёт Apple, поэтому срока годности у него нет.'],
            ].map(([n, t, d]) => (
              <div key={n} className="rounded-2xl bg-white p-6 shadow-sm"><div className="text-3xl font-bold text-yellow-400">{n}</div><div className="mt-2 text-lg font-semibold text-gray-900">{t}</div><p className="mt-2 text-gray-500">{d}</p></div>
            ))}
          </div>
        </Container>
      </Section>

      <Section py="md" className="bg-transparent">
        <Container>
          <div className="rounded-3xl bg-white p-8 shadow-lg">
            <h2 className="text-2xl font-bold text-gray-900">Что важно знать заранее</h2>
            <ul className="mt-4 space-y-3 text-gray-600">
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-yellow-400" /><span><b className="text-gray-900">Приложение должно быть в истории покупок вашего Apple ID.</b> Если вы хоть раз ставили его на этот аккаунт, оно там навсегда. Если не ставили, можно использовать Apple ID родственника: при первом запуске понадобится его код подтверждения.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-yellow-400" /><span><b className="text-gray-900">Ставится последняя версия, которая была в App Store.</b> Банки её поддерживают, но обновлений через App Store у неё не будет.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-yellow-400" /><span><b className="text-gray-900">Пуш-уведомления могут не приходить.</b> Само приложение, вход и переводы работают, коды приходят по SMS.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-yellow-400" /><span><b className="text-gray-900">Оплата только за установленное.</b> Если приложения нет в истории покупок и поставить его не получилось, вы ничего не платите.</span></li>
            </ul>
          </div>
        </Container>
      </Section>

      <Section id="request" py="md" bg="gray">
        <Container>
          <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-lg">
            {done ? (
              <div className="text-center" data-request-done>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-yellow-400 text-gray-900"><CheckIcon className="h-7 w-7" /></div>
                <h2 className="mt-4 text-2xl font-bold text-gray-900">Заявка {done} принята</h2>
                <p className="mt-2 text-gray-500">Перезвоним, подтвердим приложения и время. Приходите с iPhone и паролем от Apple ID.</p>
                <Link to="/catalog" className="mt-6 inline-flex items-center gap-2 font-semibold text-gray-900 hover:text-yellow-500">Пока посмотреть каталог <ArrowRightIcon className="h-4 w-4" /></Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4" data-request-form>
                <h2 className="text-2xl font-bold text-gray-900">Оставить заявку</h2>
                <p className="text-gray-500">{picked.size > 0 ? `Выбрано: ${apps.filter(a => picked.has(a.id)).map(a => a.name).join(', ')} · ${fmtRub(total)}` : 'Отметьте приложения в списке выше, потом заполните форму'}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700">Имя<input value={form.name} onChange={e => set('name', e.target.value)} required minLength={2} placeholder="Иван" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-400/30" /></label>
                  <label className="block text-sm font-medium text-gray-700">Телефон<input value={form.phone} onChange={e => set('phone', e.target.value)} required type="tel" inputMode="tel" placeholder="+7 999 000-00-00" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-400/30" /></label>
                  <label className="block text-sm font-medium text-gray-700">Модель iPhone
                    <select value={form.model} onChange={e => set('model', e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 focus:border-yellow-400 focus:outline-none">
                      <option value="">Не знаю / укажу на месте</option>
                      {IPHONE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-gray-700">Версия iOS<input value={form.ios} onChange={e => set('ios', e.target.value)} placeholder="Настройки → Основные → Об этом устройстве" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-400/30" /></label>
                </div>
                <label className="block text-sm font-medium text-gray-700">Комментарий<input value={form.comment} onChange={e => set('comment', e.target.value)} placeholder="Например: Сбер стоял раньше, удалил в прошлом году" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-400/30" /></label>
                <label className="flex items-start gap-3 text-sm text-gray-600"><input type="checkbox" checked={form.consent} onChange={e => set('consent', e.target.checked)} className="mt-1 h-4 w-4 rounded" />Даю согласие на обработку персональных данных в соответствии с <Link to="/personal-data" className="text-yellow-600 hover:underline">Согласием</Link>.</label>
                {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}
                <button type="submit" disabled={sending} className="w-full rounded-xl bg-yellow-400 px-6 py-4 font-semibold text-gray-900 transition-colors hover:bg-yellow-300 disabled:opacity-60">{sending ? 'Отправляем…' : 'Отправить заявку'}</button>
                <p className="text-center text-xs text-gray-400">Или просто приходите: ТЦ «Багратионовский», павильон А60, ежедневно 10:30–20:30 · <a href="tel:+79998021022" className="text-gray-600 hover:underline">+7 (999) 802-10-22</a></p>
              </form>
            )}
          </div>
        </Container>
      </Section>
    </div>
  )
}
