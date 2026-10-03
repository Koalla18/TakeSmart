import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { resolveApp } from '../lib/appCatalog'
import { orderPrice, publicInstalls, rub, type PublicCatalog, type PublicCatalogApp } from '../lib/installs'

// Витрина услуги «Приложения на iPhone»: /apps. Заявки принимаются, только если это
// включено в админке; иначе страница рассказывает об услуге и зовёт в салон.

function Tile({ app, size = 52 }: { app: PublicCatalogApp; size?: number }) {
  const r = resolveApp({ name: app.name, bundle_id: app.bundle_id, icon: app.icon_url, genre: app.genre })
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
  if (r.icon && !broken) return <img src={r.icon} alt="" width={size} height={size} loading="lazy" style={style} className="shrink-0 bg-gray-100 object-cover" onError={() => setBroken(true)} />
  return <span aria-hidden="true" style={{ ...style, background: `hsl(${r.hue} 45% 40%)`, fontSize: Math.round(size * 0.42) }} className="flex shrink-0 items-center justify-center font-bold text-white">{r.letter}</span>
}

const STEPS = [
  ['Выбираете приложения', 'Банки, маркетплейсы и сервисы, которых больше нет в App Store.'],
  ['Входите в аккаунт TakeSmart', 'Только в разделе «Контент и покупки». Из iCloud выходить не нужно.'],
  ['Скачиваете из App Store', 'Приложения берутся из списка покупок нашего аккаунта — это обычная загрузка App Store.'],
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
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const prev = document.title
    document.title = 'Приложения на iPhone, которых нет в App Store — TakeSmart'
    publicInstalls.catalog().then(setCatalog).catch(() => setFailed(true))
    return () => { document.title = prev }
  }, [])

  const apps = useMemo(() => catalog?.apps || [], [catalog])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? apps.filter(a => `${a.name} ${a.bundle_id}`.toLowerCase().includes(needle)) : apps
  }, [apps, q])
  const chosen = picked.map(id => apps.find(a => a.id === id)).filter((a): a is PublicCatalogApp => Boolean(a))
  const total = catalog ? orderPrice(catalog, chosen.length) : 0
  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const digits = phone.replace(/\D/g, '')
  const canSend = chosen.length > 0 && name.trim().length >= 2 && digits.length >= 10 && consent && !sending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    setSending(true); setError(null)
    try {
      const res = await publicInstalls.createOrder({ app_ids: chosen.map(a => a.id), name: name.trim(), phone, consent })
      navigate(`/i/${res.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось отправить заявку. Попробуйте ещё раз.')
      setSending(false)
    }
  }

  const tg = (catalog?.support_telegram || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '')
  const supportPhone = (catalog?.support_phone || '').trim()
  const enabled = Boolean(catalog?.enabled) && apps.length > 0

  return (
    <div className="bg-white" data-apps-page data-enabled={catalog ? (enabled ? '1' : '0') : undefined}>
      <section className="bg-gray-900 text-white">
        <Container size="md" className="py-12 sm:py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-yellow-400">Услуга TakeSmart</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">Вернём на iPhone приложения, которых нет в App Store</h1>
          <p className="mt-4 max-w-2xl text-lg text-gray-300">Банки, маркетплейсы и сервисы, пропавшие из магазина. Ставятся из App Store — без компьютера и без изменений в системе телефона.</p>
          {catalog && (
            <p className="mt-6 inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl bg-white/10 px-5 py-3">
              <span className="text-3xl font-bold text-yellow-400">{rub(catalog.price)}</span><span className="text-gray-300">за приложение</span>
              {catalog.bulk_price < catalog.price && <span className="text-gray-400">· от {catalog.bulk_min} шт. — по {rub(catalog.bulk_price)}</span>}
            </p>
          )}
        </Container>
      </section>

      <Container size="md" className="py-10">
        {!catalog && !failed && <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />)}</div>}

        {catalog && enabled && (
          <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_340px]" data-apps-form>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold text-gray-900">Выберите приложения</h2>
                {apps.length > 8 && <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Поиск" className="ml-auto w-full rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] focus:border-yellow-400 focus:outline-none sm:w-56" />}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {visible.map(a => {
                  const on = picked.includes(a.id)
                  return (
                    <button key={a.id} type="button" onClick={() => toggle(a.id)} aria-pressed={on} data-app-tile={a.bundle_id}
                      className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <Tile app={a} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-gray-900">{a.name}</span>{a.version ? <span className="block text-xs text-gray-500">версия {a.version}</span> : null}</span>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${on ? 'border-yellow-400 bg-yellow-400 text-gray-900' : 'border-gray-300 text-transparent'}`}>✓</span>
                    </button>
                  )
                })}
              </div>
              {visible.length === 0 && <p className="mt-4 text-gray-500">Ничего не найдено.</p>}
            </div>

            <div className="h-fit rounded-3xl border border-gray-200 p-5 lg:sticky lg:top-24">
              <h3 className="text-lg font-bold text-gray-900">Заявка</h3>
              {chosen.length === 0 ? <p className="mt-2 text-sm text-gray-500">Отметьте приложения — посчитаем стоимость.</p> : (
                <ul className="mt-3 space-y-2">
                  {chosen.map(a => <li key={a.id} className="flex items-center gap-2.5 text-sm"><Tile app={a} size={28} /><span className="min-w-0 flex-1 truncate text-gray-900">{a.name}</span></li>)}
                </ul>
              )}
              <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-3"><span className="text-gray-500">Итого</span><span className="text-2xl font-bold text-gray-900" data-apps-total>{rub(total)}</span></div>
              <input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" placeholder="Ваше имя" className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-[15px] focus:border-yellow-400 focus:outline-none" data-apps-name />
              <input value={phone} onChange={e => setPhone(e.target.value)} required type="tel" autoComplete="tel" placeholder="+7 900 000-00-00" className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-[15px] focus:border-yellow-400 focus:outline-none" data-apps-phone />
              <label className="mt-3 flex items-start gap-2.5 text-sm text-gray-600">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-yellow-400" data-apps-consent />
                <span>Согласен на <Link to="/personal-data" className="underline">обработку персональных данных</Link></span>
              </label>
              {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={!canSend} className="mt-4 w-full rounded-2xl bg-yellow-400 px-5 py-3.5 text-base font-semibold text-gray-900 transition hover:bg-yellow-300 disabled:opacity-50" data-apps-submit>{sending ? 'Отправляем…' : 'Оставить заявку'}</button>
              <p className="mt-2 text-xs text-gray-500">Менеджер свяжется с вами, подтвердит оплату и поможет с установкой.</p>
            </div>
          </form>
        )}

        {((catalog && !enabled) || failed) && (
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

        <h2 className="mt-12 text-2xl font-bold text-gray-900">Как это работает</h2>
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
      </Container>
    </div>
  )
}
