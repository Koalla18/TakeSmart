import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { resolveApp } from '../lib/appCatalog'
import { ORDER_STATUS, clock, publicInstalls, rub, type OrderApp, type PublicOrder } from '../lib/installs'

// ─────────────────────────────────────────────────────────────────────────────
// Страница заказа «Приложения на iPhone»: /i/<ключ>. Открывается на телефоне
// покупателя по QR или ссылке и ведёт по шагам: выйти из своего аккаунта в
// «Контент и покупки», войти в аккаунт салона, скачать приложения из истории
// покупок, вернуть свой аккаунт. Пароля аккаунта салона здесь нет: его вводит
// сотрудник. Страница не индексируется и не попадает в аналитику.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS: Record<string, number> = { new: 5000, ready: 5000, active: 2500, expired: 8000 }
const BTN = 'inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-base font-semibold transition active:scale-[0.99] disabled:opacity-50'
const BTN_MAIN = `${BTN} bg-yellow-400 text-gray-900 hover:bg-yellow-300`
const BTN_GHOST = `${BTN} border border-gray-200 bg-white text-gray-900 hover:bg-gray-50`
const CARD = 'rounded-3xl border border-gray-200 bg-white p-5 shadow-sm'

function useHeadTags(title: string) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title
    const tags = [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']].map(([name, content]) => {
      const el = document.createElement('meta')
      el.name = name; el.content = content
      document.head.appendChild(el)
      return el
    })
    return () => { document.title = prevTitle; tags.forEach(t => t.remove()) }
  }, [title])
}

function CopyButton({ text, label = 'Скопировать', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch {
      const el = document.createElement('textarea')
      el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'
      document.body.appendChild(el); el.select()
      try { document.execCommand('copy') } catch { /* не вышло — пользователь перепишет вручную */ }
      el.remove()
    }
    setDone(true)
    window.setTimeout(() => setDone(false), 1600)
  }
  return (
    <button type="button" onClick={copy} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'} ${className}`}>
      {done ? 'Скопировано' : label}
    </button>
  )
}

function Path({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className="text-gray-400">›</span>}
          <span className="rounded-lg bg-gray-100 px-2 py-1 text-[15px] font-medium leading-tight text-gray-900">{it}</span>
        </span>
      ))}
    </span>
  )
}

function AppTile({ app, size = 44 }: { app: OrderApp; size?: number }) {
  const r = resolveApp({ name: app.name, bundle_id: app.bundle_id, icon: app.icon_url })
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
  if (r.icon && !broken) return <img src={r.icon} alt="" width={size} height={size} style={style} className="shrink-0 bg-gray-100 object-cover" onError={() => setBroken(true)} />
  return <span aria-hidden="true" style={{ ...style, background: `hsl(${r.hue} 45% 40%)`, fontSize: Math.round(size * 0.42) }} className="flex shrink-0 items-center justify-center font-bold text-white">{r.letter}</span>
}

function Contacts({ order, title = 'Нужна помощь?' }: { order: PublicOrder; title?: string }) {
  const tg = order.support_telegram.trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '')
  const phone = order.support_phone.trim()
  if (!tg && !phone) return <p className="text-center text-sm text-gray-500">{title} Обратитесь к сотруднику TakeSmart.</p>
  return (
    <div className="text-center" data-contacts>
      <p className="text-sm text-gray-500">{title}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200">Позвонить {phone}</a>}
        {tg && <a href={`https://t.me/${encodeURIComponent(tg)}`} target="_blank" rel="noreferrer noopener" className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200">Написать в Telegram</a>}
      </div>
    </div>
  )
}

function ReturnAccount() {
  return (
    <div className="space-y-2 text-[15px] text-gray-700">
      <Path items={['Настройки', 'ваше имя', 'Контент и покупки', 'Выйти']} />
      <p>Потом снова нажмите «Контент и покупки» и выберите «Продолжить» под своим именем.</p>
      <p>Проверьте: в App Store в профиле снова ваше имя.</p>
    </div>
  )
}

function AppsSummary({ order }: { order: PublicOrder }) {
  return (
    <ul className="space-y-2">
      {order.apps.map(a => (
        <li key={a.key} className="flex items-center gap-3">
          <AppTile app={a} size={40} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-900">{a.name}</span>
          {a.status === 'installed' && <span className="text-sm text-emerald-700">установлено</span>}
        </li>
      ))}
    </ul>
  )
}

export function InstallOrderPage() {
  const { token = '' } = useParams()
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [problem, setProblem] = useState<'notfound' | 'network' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const [fetchedAt, setFetchedAt] = useState(0)
  const stepKey = `ts-install-step-${token}`
  const [step, setStepState] = useState<number>(() => { try { return Number(sessionStorage.getItem(stepKey)) || 1 } catch { return 1 } })
  const setStep = (n: number) => { setStepState(n); try { sessionStorage.setItem(stepKey, String(n)) } catch { /* приватный режим */ } }
  useHeadTags(order ? `Заказ №${order.number} — TakeSmart` : 'Заказ — TakeSmart')

  const apply = useCallback((o: PublicOrder) => { setFetchedAt(Date.now()); setOrder(o); setProblem(null) }, [])
  const load = useCallback(async () => {
    try { apply(await publicInstalls.order(token)) } catch (e) {
      setProblem((e as { status?: number }).status === 404 ? 'notfound' : 'network')
    }
  }, [token, apply])

  const status = order?.status
  useEffect(() => {
    const first = window.setTimeout(load, 0)
    return () => window.clearTimeout(first)
  }, [load])
  useEffect(() => {
    const ms = status ? POLL_MS[status] : problem === 'network' ? 5000 : 0
    if (!ms) return
    const id = window.setInterval(() => { if (!document.hidden) load() }, ms)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [status, problem, load])
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [])

  const run = async (name: string, fn: () => Promise<PublicOrder>) => {
    setBusy(name); setActionError(null)
    try { apply(await fn()) } catch (e) { setActionError(e instanceof Error ? e.message : 'Не получилось. Попробуйте ещё раз.') }
    setBusy(null)
  }

  const elapsed = fetchedAt ? Math.max(0, (now - fetchedAt) / 1000) : 0
  const left = order?.seconds_left != null ? Math.max(0, Math.round(order.seconds_left - elapsed)) : null

  if (problem === 'notfound') {
    return (
      <Frame>
        <div className={`${CARD} text-center`} data-order-missing>
          <h1 className="text-xl font-bold text-gray-900">Заказ не найден</h1>
          <p className="mt-2 text-[15px] text-gray-600">Проверьте ссылку: её выдаёт сотрудник TakeSmart. Если заказ был давно, он мог быть удалён.</p>
        </div>
      </Frame>
    )
  }
  if (!order) {
    return (
      <Frame>
        {problem === 'network'
          ? <div className={`${CARD} text-center`}><h1 className="text-xl font-bold text-gray-900">Нет связи</h1><p className="mt-2 text-[15px] text-gray-600">Проверьте интернет. Страница обновится сама.</p></div>
          : <div className="space-y-3"><div className="h-28 animate-pulse rounded-3xl bg-gray-100" /><div className="h-56 animate-pulse rounded-3xl bg-gray-100" /></div>}
      </Frame>
    )
  }

  const installed = order.apps.filter(a => a.status === 'installed').length
  const timer = order.status === 'active' && left !== null
    ? <span data-timer className={`rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${left < 300 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-900'}`}>{clock(left)}</span>
    : <span className={`rounded-full px-3 py-1 text-xs font-medium ${ORDER_STATUS[order.status].light}`}>{ORDER_STATUS[order.status].label}</span>

  return (
    <Frame right={timer} number={order.number}>
      <div data-order-page data-status={order.status} data-step={order.status === 'active' ? step : undefined} className="space-y-4">
        {problem === 'network' && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Нет связи с сервером. Проверьте интернет — страница обновится сама.</p>}

        {order.status === 'new' && (
          <div className={CARD}>
            <h1 className="text-2xl font-bold text-gray-900">Заявка №{order.number} принята</h1>
            <p className="mt-2 text-[15px] text-gray-600">Менеджер подтвердит оплату, и здесь откроются шаги установки. Страница обновится сама — закрывать её не нужно.</p>
            {order.payment_text && <p className="mt-3 whitespace-pre-line rounded-2xl bg-yellow-50 px-4 py-3 text-[15px] text-gray-900" data-payment-text>{order.payment_text}</p>}
            <div className="mt-4"><AppsSummary order={order} /></div>
            <div className="mt-4 flex items-baseline justify-between border-t border-gray-100 pt-3"><span className="text-gray-500">К оплате</span><span className="text-2xl font-bold text-gray-900">{rub(order.price)}</span></div>
          </div>
        )}

        {order.status === 'ready' && (
          <>
            <div className={CARD}>
              <h1 className="text-2xl font-bold text-gray-900">Установка приложений на iPhone</h1>
              <p className="mt-2 text-[15px] text-gray-600">Откройте эту страницу в Safari на том iPhone, куда ставим приложения.</p>
              <div className="mt-4"><AppsSummary order={order} /></div>
            </div>
            <div className={CARD}>
              <h2 className="text-lg font-bold text-gray-900">Как это будет</h2>
              <ol className="mt-3 space-y-3 text-[15px] text-gray-700">
                {[
                  'На время установки в App Store на вашем iPhone вводится аккаунт TakeSmart — только в разделе «Контент и покупки».',
                  'Вы скачиваете приложения из списка покупок этого аккаунта.',
                  'Возвращаете свой аккаунт. Приложения остаются на телефоне и работают.',
                ].map((t, i) => (
                  <li key={i} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">{i + 1}</span><span>{t}</span></li>
                ))}
              </ol>
              <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900">Из iCloud выходить не нужно. Фото, контакты, пароли и «Локатор» остаются как были.</p>
            </div>
            <button type="button" onClick={() => run('start', () => publicInstalls.start(token))} disabled={busy !== null} className={BTN_MAIN} data-start>
              {busy === 'start' ? 'Начинаем…' : 'Начать установку'}
            </button>
            <p className="text-center text-sm text-gray-500">После нажатия у вас будет {order.window_minutes} минут. Обычно хватает 10–15.</p>
          </>
        )}

        {order.status === 'active' && (
          <ActiveSteps order={order} token={token} step={step} setStep={setStep} busy={busy} run={run} elapsed={elapsed} installed={installed} />
        )}

        {order.status === 'done' && <DoneBlock order={order} token={token} busy={busy} run={run} installed={installed} />}

        {(order.status === 'expired' || order.status === 'cancelled') && (
          <>
            <div className={CARD}>
              <h1 className="text-2xl font-bold text-gray-900">{order.status === 'expired' ? 'Время на установку вышло' : 'Заказ отменён'}</h1>
              <p className="mt-2 text-[15px] text-gray-600">{order.status === 'expired'
                ? `Установлено ${installed} из ${order.apps.length}. Чтобы закончить, попросите менеджера продлить заказ — страница откроется снова.`
                : 'Если это ошибка — свяжитесь с нами.'}</p>
            </div>
            <div className={CARD}>
              <h2 className="text-lg font-bold text-gray-900">Если вы уже вошли в аккаунт TakeSmart — верните свой</h2>
              <div className="mt-3"><ReturnAccount /></div>
            </div>
          </>
        )}

        {actionError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" data-action-error>{actionError}</p>}
        <div className="pt-2"><Contacts order={order} /></div>
      </div>
    </Frame>
  )
}

function Frame({ children, right, number }: { children: React.ReactNode; right?: React.ReactNode; number?: number }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <a href="/" aria-label="TakeSmart — на главную"><Logo /></a>
          {number ? <span className="ml-auto text-sm text-gray-500">№{number}</span> : null}
          {right ? <span className={number ? '' : 'ml-auto'}>{right}</span> : null}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pb-16 pt-5">{children}</main>
    </div>
  )
}

type Run = (name: string, fn: () => Promise<PublicOrder>) => Promise<void>

function StepCard({ n, title, current, total, onOpen, children }: { n: number; title: string; current: number; total: number; onOpen: (n: number) => void; children: React.ReactNode }) {
  const done = n < current, active = n === current
  return (
    <section data-step-card={n} data-state={done ? 'done' : active ? 'active' : 'todo'} className={`rounded-3xl border bg-white shadow-sm ${active ? 'border-yellow-400' : 'border-gray-200'}`}>
      <button type="button" onClick={() => onOpen(n)} aria-expanded={active} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-500'}`}>{done ? '✓' : n}</span>
        <span className={`min-w-0 flex-1 text-[17px] font-semibold leading-snug ${active || done ? 'text-gray-900' : 'text-gray-500'}`}>{title}</span>
        <span className="shrink-0 text-xs text-gray-400">{n} из {total}</span>
      </button>
      {active && <div className="space-y-4 border-t border-gray-100 px-5 pb-5 pt-4">{children}</div>}
    </section>
  )
}

function ActiveSteps({ order, token, step, setStep, busy, run, elapsed, installed }: {
  order: PublicOrder; token: string; step: number; setStep: (n: number) => void; busy: string | null; run: Run; elapsed: number; installed: number
}) {
  const TOTAL = 5
  const [confirmFinish, setConfirmFinish] = useState(false)
  const next = (n: number) => { setStep(n); window.requestAnimationFrame(() => document.querySelector(`[data-step-card="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  const self = order.mode === 'self'
  const finish = () => run('finish', () => publicInstalls.finish(token, {}))

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-gray-900">Идём по шагам</h1>
        <p className="mt-1 text-[15px] text-gray-600">Пять шагов, 10–15 минут. Не закрывайте страницу — к ней можно возвращаться из «Настроек» и App Store.</p>
      </div>

      <StepCard n={1} title="Выйдите из своего аккаунта в App Store" current={step} total={TOTAL} onOpen={setStep}>
        <Path items={['Настройки', 'ваше имя вверху', 'Контент и покупки', 'Выйти']} />
        <p className="text-sm text-gray-500">Раздел может называться «Медиа и покупки».</p>
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900">Из iCloud выходить не нужно. Фото, контакты, пароли и «Локатор» остаются как были.</p>
        <button type="button" onClick={() => next(2)} className={BTN_MAIN} data-next="2">Вышел, дальше</button>
        {order.apple_id && (
          <button type="button" onClick={() => next(3)} className="w-full text-center text-sm text-gray-500 underline decoration-dotted" data-skip-login>
            В «Контент и покупки» уже введён {order.apple_id}? Сразу к скачиванию
          </button>
        )}
      </StepCard>

      <StepCard n={2} title="Войдите в аккаунт TakeSmart" current={step} total={TOTAL} onOpen={setStep}>
        <ol className="space-y-4 text-[15px] text-gray-700">
          <li><b className="text-gray-900">1.</b> Ещё раз нажмите «Контент и покупки».</li>
          <li><b className="text-gray-900">2.</b> iPhone предложит продолжить под вашим именем. Нажмите внизу окна «Не [ваше имя]?».</li>
          <li>
            <b className="text-gray-900">3.</b> Введите Apple ID:
            {order.apple_id ? (
              <span className="mt-2 flex items-center gap-2 rounded-2xl bg-gray-50 p-2 pl-4">
                <span className="min-w-0 flex-1 break-all font-mono text-[15px] font-semibold text-gray-900" data-apple-id>{order.apple_id}</span>
                <CopyButton text={order.apple_id} />
              </span>
            ) : <span className="mt-1 block text-gray-500">его назовёт сотрудник.</span>}
          </li>
          <li data-password-note><b className="text-gray-900">4.</b> Пароль {self ? 'сообщит менеджер TakeSmart — позвоните или напишите нам (контакты внизу страницы).' : 'введёт сотрудник TakeSmart.'}</li>
          <li>
            <b className="text-gray-900">5.</b> iPhone попросит код из 6 цифр. Получите его здесь:
            <div className="mt-2"><CodeBox order={order} token={token} busy={busy} run={run} elapsed={elapsed} /></div>
          </li>
        </ol>
        <button type="button" onClick={() => next(3)} className={BTN_MAIN} data-next="3">Вошёл, дальше</button>
      </StepCard>

      <StepCard n={3} title="Скачайте приложения" current={step} total={TOTAL} onOpen={setStep}>
        <Path items={['App Store', 'значок профиля вверху', 'Приложения и история покупок', 'Мои приложения', 'Не на этом iPhone']} />
        <p className="text-sm text-gray-500">В старых версиях iOS: «Покупки» → «Мои покупки» → «Не на этом iPhone».</p>
        <p className="text-[15px] text-gray-700">Найдите приложение по названию и нажмите на облако со стрелкой рядом с ним.</p>
        <ul className="space-y-2">
          {order.apps.map(a => {
            const on = a.status === 'installed'
            return (
              <li key={a.key} data-app={a.bundle_id} data-installed={on ? '1' : '0'} className={`rounded-2xl border p-3 ${on ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-3">
                  <AppTile app={a} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold text-gray-900">{a.name}</span>{a.version ? <span className="block text-xs text-gray-500">версия {a.version}</span> : null}</span>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <CopyButton text={a.name} label="Скопировать название" className="flex-1" />
                  <button type="button" disabled={busy !== null} onClick={() => run(`app-${a.key}`, () => publicInstalls.markApp(token, a.key, !on))} data-mark-app
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition disabled:opacity-60 ${on ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>{on ? '✓ Скачал' : 'Скачал'}</button>
                </div>
              </li>
            )
          })}
        </ul>
        <p className="text-sm text-gray-500">Если iPhone снова спросит пароль или код — это данные аккаунта TakeSmart, а не ваши.</p>
        <button type="button" onClick={() => next(4)} className={BTN_MAIN} data-next="4">{installed === order.apps.length ? 'Всё скачал, дальше' : `Скачано ${installed} из ${order.apps.length}, дальше`}</button>
      </StepCard>

      <StepCard n={4} title="Откройте каждое приложение один раз" current={step} total={TOTAL} onOpen={setStep}>
        <p className="text-[15px] text-gray-700">Запустите каждое скачанное приложение и дождитесь первого экрана. Входить в банк сейчас необязательно.</p>
        <p className="text-sm text-gray-500">Сделайте это сейчас, пока введён аккаунт TakeSmart: позже при первом запуске iPhone может спросить его пароль.</p>
        <button type="button" onClick={() => next(5)} className={BTN_MAIN} data-next="5">Открыл, дальше</button>
      </StepCard>

      <Trouble />

      <StepCard n={5} title="Верните свой аккаунт" current={step} total={TOTAL} onOpen={setStep}>
        <ReturnAccount />
        {confirmFinish && installed < order.apps.length ? (
          <div className="space-y-2 rounded-2xl bg-amber-50 p-3">
            <p className="text-sm text-amber-900">Отмечено {installed} из {order.apps.length}. Завершить всё равно?</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setConfirmFinish(false); next(3) }} className={BTN_GHOST}>Вернуться</button>
              <button type="button" onClick={finish} disabled={busy !== null} className={BTN_MAIN} data-finish-anyway>Завершить</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => (installed < order.apps.length ? setConfirmFinish(true) : finish())} className={BTN_MAIN} data-finish>
            {busy === 'finish' ? 'Завершаем…' : 'Готово, свой аккаунт вернул'}
          </button>
        )}
      </StepCard>
    </div>
  )
}

const TROUBLE: readonly (readonly [string, string])[] = [
  ['Нет кнопки «Не [ваше имя]?»', 'Сначала выйдите: «Контент и покупки» → «Выйти» (шаг 1). После этого при новом нажатии iPhone спросит, под каким аккаунтом продолжить.'],
  ['Код не приходит', 'Код от аккаунта TakeSmart приходит не на ваш телефон. Нажмите «Получить код» на этой странице — он появится здесь.'],
  ['Не вижу приложение в списке', 'Проверьте, что в App Store в профиле аккаунт TakeSmart, и откройте именно «Не на этом iPhone». Поле поиска — вверху списка.'],
  ['iPhone предлагает связать устройство с этим аккаунтом', 'Соглашайтесь: без этого скачать не получится. Apple разрешает менять такую привязку раз в 90 дней, поэтому какое-то время App Store может не давать заново скачать ваши старые покупки. Установленные приложения при этом работают.'],
  ['Пишет, что сменить аккаунт можно через несколько дней', 'Значит, с этого телефона недавно уже скачивали покупки другого аккаунта, и Apple пока не разрешает снова. Ничего не нажимайте и свяжитесь с нами.'],
  ['Приложение открывается и просит пароль', 'Это пароль аккаунта TakeSmart. Если вы уже вернули свой аккаунт — свяжитесь с нами.'],
]

function Trouble() {
  return (
    <details className="group rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm" data-trouble>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-gray-900">Если что-то не получается<span className="text-xl leading-none text-gray-400 transition group-open:rotate-45">+</span></summary>
      <dl className="mt-3 space-y-3">
        {TROUBLE.map(([q, a]) => (
          <div key={q}><dt className="text-[15px] font-medium text-gray-900">{q}</dt><dd className="mt-0.5 text-sm text-gray-600">{a}</dd></div>
        ))}
      </dl>
    </details>
  )
}

function CodeBox({ order, token, busy, run, elapsed }: { order: PublicOrder; token: string; busy: string | null; run: Run; elapsed: number }) {
  const code = order.code
  const remaining = code.value && code.age_seconds !== null ? Math.max(0, Math.round(code.fresh_seconds - code.age_seconds - elapsed)) : 0
  const fresh = Boolean(code.value) && remaining > 0
  const retryIn = Math.max(0, Math.ceil(code.retry_in - elapsed))
  const attemptsLeft = Math.max(0, code.limit - code.requests)
  const request = () => run('code', () => publicInstalls.requestCode(token))

  if (fresh && code.value) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center" data-code-state="ready">
        <div className="font-mono text-4xl font-bold tracking-[0.2em] text-gray-900" data-code-value>{code.value.slice(0, 3)} {code.value.slice(3)}</div>
        <div className="mx-auto mt-3 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-emerald-200"><div className="h-full rounded-full bg-emerald-600 transition-[width] duration-1000 ease-linear" style={{ width: `${(remaining / code.fresh_seconds) * 100}%` }} /></div>
        <p className="mt-2 text-sm text-emerald-900">Введите код на iPhone. Действует ещё {remaining} с.</p>
        <div className="mt-3 flex justify-center"><CopyButton text={code.value} label="Скопировать код" className="bg-white" /></div>
      </div>
    )
  }
  if (code.waiting) {
    return (
      <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-center" data-code-state="waiting">
        <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[3px] border-yellow-200 border-t-yellow-500" />
        <p className="mt-2 text-[15px] font-medium text-gray-900">Запросили код у менеджера</p>
        <p className="text-sm text-gray-600">Обычно меньше минуты. Код появится здесь сам.</p>
        {retryIn === 0 && attemptsLeft > 0 && <button type="button" onClick={request} disabled={busy !== null} className="mt-2 text-sm font-medium text-gray-900 underline decoration-dotted">Запросить ещё раз</button>}
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4" data-code-state={attemptsLeft ? 'idle' : 'exhausted'}>
      {code.value && !fresh && <p className="mb-2 text-sm text-amber-800">Прошлый код устарел — запросите новый.</p>}
      {attemptsLeft > 0 ? (
        <>
          <button type="button" onClick={request} disabled={busy !== null || retryIn > 0} className={`${BTN} bg-gray-900 text-white hover:bg-gray-800`} data-get-code>
            {busy === 'code' ? 'Запрашиваем…' : retryIn > 0 ? `Можно через ${retryIn} с` : 'Получить код'}
          </button>
          <p className="mt-2 text-center text-sm text-gray-500">Нажимайте, когда iPhone попросит код. Осталось попыток: {attemptsLeft}.</p>
        </>
      ) : <p className="text-[15px] text-gray-700">Попытки закончились. Свяжитесь с менеджером — он выдаст ещё.</p>}
    </div>
  )
}

function DoneBlock({ order, token, busy, run, installed }: { order: PublicOrder; token: string; busy: string | null; run: Run; installed: number }) {
  const [rating, setRating] = useState<number>(order.rating || 0)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(order.rating !== null)
  const send = async () => {
    await run('rate', () => publicInstalls.finish(token, { rating: rating || null, text: text.trim() || null }))
    setSent(true)
  }
  return (
    <>
      <div className={`${CARD} text-center`} data-done>
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</span>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">Готово</h1>
        <p className="mt-1 text-[15px] text-gray-600">Установлено {installed} из {order.apps.length}. Спасибо, что выбрали TakeSmart.</p>
        <div className="mt-4 text-left"><AppsSummary order={order} /></div>
      </div>
      <div className={CARD}>
        <h2 className="text-lg font-bold text-gray-900">Что важно знать</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] text-gray-700">
          <li>Приложения продолжат работать под вашим аккаунтом.</li>
          <li>Через App Store они не обновятся. Когда выйдет новая версия — приходите, поставим её так же.</li>
          <li>Если при обновлении всех приложений iPhone попросит пароль чужого Apple ID — нажмите «Отменить». Это запрос на обновление такого приложения.</li>
          <li>Проверьте, что в App Store в профиле ваше имя. Если нет — верните аккаунт: «Настройки» → ваше имя → «Контент и покупки».</li>
        </ul>
      </div>
      <div className={CARD} data-rating>
        {sent ? <p className="text-center text-[15px] text-gray-700">Спасибо за оценку!</p> : (
          <>
            <h2 className="text-lg font-bold text-gray-900">Как всё прошло?</h2>
            <div className="mt-3 flex justify-center gap-1" role="radiogroup" aria-label="Оценка">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} из 5`} onClick={() => setRating(n)} data-star={n}
                  className={`h-12 w-12 rounded-xl text-3xl leading-none transition ${n <= rating ? 'text-yellow-400' : 'text-gray-300 hover:text-gray-400'}`}>★</button>
              ))}
            </div>
            <textarea value={text} onChange={e => setText(e.target.value)} maxLength={500} rows={2} placeholder="Что улучшить? (необязательно)" className="mt-3 w-full rounded-2xl border border-gray-200 px-4 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-yellow-400 focus:outline-none" />
            <button type="button" onClick={send} disabled={busy !== null || !rating} className={`${BTN_MAIN} mt-3`} data-send-rating>Отправить</button>
          </>
        )}
      </div>
    </>
  )
}
