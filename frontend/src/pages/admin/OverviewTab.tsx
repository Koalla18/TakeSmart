/**
 * «Обзор» — домашний экран админки v2.
 *
 * Отвечает на один вопрос: что сегодня требует внимания. Цифры дня берутся из
 * той же ручки /api/admin/analytics (period=day), что и раздел «Аналитика», —
 * на клиенте ничего не досчитывается. Списки товаров/заказов приходят от
 * страницы: они уже загружены, второй раз в сеть не ходим.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { AdminIcon, type AdminIconName } from './AdminIcons'
import type { AdminSection } from './adminNav'

type AuthFetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface OverviewProduct {
  id: string
  name: string
  price: number
  discount_price: number | null
  is_active: boolean
  is_featured: boolean
  stock_quantity: number
  condition: string
  main_image_url: string | null
  brand: string | null
}

export interface OverviewOrder {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string | null
  total_amount: number
  created_at: string
  shipping_city?: string | null
}

interface Pair { current: number; previous: number }
interface DayAnalytics {
  range: { from: string; to: string; days: number }
  kpi: { revenue: Pair; orders: Pair; avg_check: Pair; items_sold: Pair; visits: Pair; conversion: Pair }
}

interface OverviewTabProps<P extends OverviewProduct> {
  authFetch: AuthFetchFn
  products: P[]
  categoriesWithoutSchema: number
  pendingOrders: OverviewOrder[]
  onOpenOrder: (id: string) => void
  onGoTo: (section: AdminSection, opts?: { orderStatus?: string }) => void
  onEditProduct: (product: P) => void
  onNewProduct: () => void
  onNewGroup: () => void
  onNewCategory: () => void
  onNewBanner: () => void
  imageUrl: (url?: string | null) => string
}

// ── Форматирование ───────────────────────────────────────────────────────────
const fmtInt = (n: number) => Math.round(n).toLocaleString('ru-RU')
const fmtMoney = (n: number) => `${fmtInt(n)} ₽`
const fmtPct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return time
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, yesterday)) return `вчера, ${time}`
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${time}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/** Дельта к вчера. null — сравнивать не с чем: вчера был ноль, либо сегодня ещё ничего не было
 *  (день не закончился — «−100 %» с утра пугал бы, не сообщая ничего). */
function deltaOf(pair: Pair | undefined): { label: string; tone: 'up' | 'down' | 'flat' } | null {
  if (!pair || pair.previous <= 0 || pair.current <= 0) return null
  const pct = ((pair.current - pair.previous) / pair.previous) * 100
  if (Math.abs(pct) < 0.5) return { label: '0%', tone: 'flat' }
  return { label: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`, tone: pct > 0 ? 'up' : 'down' }
}

// ── Кирпичики ────────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  // min-w-0: карточка живёт в grid-колонке, а строки внутри обрезаются truncate — без этого
  // колонка растягивается под самый длинный текст и на телефоне появляется горизонтальная прокрутка
  return <div className={`min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.035] ${className}`}>{children}</div>
}

function CardTitle({ icon, title, hint, action }: { icon: AdminIconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-slate-300"><AdminIcon name={icon} className="h-4 w-4" /></span>
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          {hint && <div className="text-xs text-slate-500">{hint}</div>}
        </div>
      </div>
      {action}
    </div>
  )
}

function KpiTile({ label, value, previous, delta, loading }: { label: string; value: string; previous: string; delta: ReturnType<typeof deltaOf>; loading: boolean }) {
  const toneClass = delta?.tone === 'up' ? 'bg-emerald-400/15 text-emerald-300' : delta?.tone === 'down' ? 'bg-rose-400/15 text-rose-300' : 'bg-white/[0.06] text-slate-400'
  return (
    <Card className="p-5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {loading ? (
        <div className="mt-2 h-8 w-28 animate-pulse rounded-lg bg-white/10" />
      ) : (
        <div className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight text-white tabular-nums">{value}</div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta && !loading && <span className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${toneClass}`}>{delta.label}</span>}
        <span className="text-slate-500">{loading ? '' : `вчера ${previous}`}</span>
      </div>
    </Card>
  )
}

function SignalRow({ icon, count, label, ok, onClick }: { icon: AdminIconName; count: number; label: string; ok: string; onClick: () => void }) {
  const attention = count > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${attention ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>
        <AdminIcon name={attention ? icon : 'check'} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-white">{attention ? `${count} ${label}` : ok}</span>
      </span>
      <AdminIcon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-600" />
    </button>
  )
}

function QuickAction({ icon, label, hint, onClick }: { icon: AdminIconName; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4 text-left transition hover:border-yellow-400/30 hover:bg-white/[0.06]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-300 transition group-hover:bg-yellow-400 group-hover:text-slate-950">
        <AdminIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block truncate text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  )
}

// ── Экран ────────────────────────────────────────────────────────────────────
export function OverviewTab<P extends OverviewProduct>({
  authFetch, products, categoriesWithoutSchema, pendingOrders,
  onOpenOrder, onGoTo, onEditProduct, onNewProduct, onNewGroup, onNewCategory, onNewBanner, imageUrl,
}: OverviewTabProps<P>) {
  const [day, setDay] = useState<DayAnalytics | null>(null)
  const [dayState, setDayState] = useState<'loading' | 'ready' | 'error'>('loading')
  // authFetch пересоздаётся родителем; держим свежую ссылку, но грузим один раз
  const fetchRef = useRef(authFetch)
  fetchRef.current = authFetch

  const loadDay = useCallback(async () => {
    setDayState('loading')
    try {
      const res = await fetchRef.current(`${API_BASE_URL}/api/admin/analytics?period=day`)
      if (!res.ok) throw new Error(String(res.status))
      const data: DayAnalytics = await res.json()
      setDay(data)
      setDayState('ready')
    } catch {
      setDayState('error')
    }
  }, [])

  useEffect(() => { void loadDay() }, [loadDay])

  const kpi = day?.kpi
  const loading = dayState === 'loading'

  const newProducts = products.filter(p => (p.condition || 'new') === 'new')
  const outOfStock = newProducts.filter(p => p.is_active && p.stock_quantity <= 0).length
  const hidden = newProducts.filter(p => !p.is_active).length
  const featured = products.find(p => p.is_featured)
  const featuredCount = products.filter(p => p.is_featured).length
  const visiblePending = pendingOrders.slice(0, 6)

  return (
    <div className="space-y-6">
      {/* ── Сегодня ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Сегодня</h2>
          {dayState === 'error' ? (
            <button type="button" onClick={() => void loadDay()} className="text-xs text-rose-300 hover:text-rose-200">Цифры дня не загрузились · повторить</button>
          ) : (
            <button type="button" onClick={() => onGoTo('analytics')} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white">
              Подробнее в аналитике <AdminIcon name="arrowRight" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Выручка" value={fmtMoney(kpi?.revenue.current ?? 0)} previous={fmtMoney(kpi?.revenue.previous ?? 0)} delta={deltaOf(kpi?.revenue)} loading={loading} />
          <KpiTile label="Заказы" value={fmtInt(kpi?.orders.current ?? 0)} previous={fmtInt(kpi?.orders.previous ?? 0)} delta={deltaOf(kpi?.orders)} loading={loading} />
          <KpiTile label="Визиты на сайте" value={fmtInt(kpi?.visits.current ?? 0)} previous={fmtInt(kpi?.visits.previous ?? 0)} delta={deltaOf(kpi?.visits)} loading={loading} />
          <KpiTile label="Конверсия" value={fmtPct(kpi?.conversion.current ?? 0)} previous={fmtPct(kpi?.conversion.previous ?? 0)} delta={deltaOf(kpi?.conversion)} loading={loading} />
        </div>
      </section>

      {/* ── Требует внимания ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Требует внимания</h2>
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Card>
            <CardTitle
              icon="orders"
              title={pendingOrders.length ? `Новые заказы · ${pendingOrders.length}` : 'Новые заказы'}
              hint={pendingOrders.length ? 'Ещё не подтверждены — позвоните клиенту' : 'Все заказы обработаны'}
              action={pendingOrders.length > 0 ? (
                <button type="button" onClick={() => onGoTo('orders', { orderStatus: 'pending' })} className="flex items-center gap-1 text-xs font-medium text-yellow-300 hover:text-yellow-200">
                  Все новые <AdminIcon name="arrowRight" className="h-3.5 w-3.5" />
                </button>
              ) : undefined}
            />
            {visiblePending.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-8 text-sm text-slate-400">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><AdminIcon name="check" className="h-5 w-5" /></span>
                Новых заказов нет — можно заняться каталогом.
              </div>
            ) : (
              <div className="mt-3 divide-y divide-white/[0.05] border-t border-white/[0.05]">
                {visiblePending.map(order => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => onOpenOrder(order.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-white/[0.04]"
                  >
                    <span className="w-24 shrink-0 font-mono text-xs font-bold text-yellow-300">{order.order_number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{order.customer_name}</span>
                      <span className="block truncate text-xs text-slate-500">{[order.shipping_city, order.customer_phone].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-white tabular-nums">{fmtMoney(Number(order.total_amount) || 0)}</span>
                      <span className="block text-xs text-slate-500">{formatWhen(order.created_at)}</span>
                    </span>
                  </button>
                ))}
                {pendingOrders.length > visiblePending.length && (
                  <button type="button" onClick={() => onGoTo('orders', { orderStatus: 'pending' })} className="w-full px-5 py-3 text-center text-xs font-medium text-slate-400 transition hover:text-white">
                    Ещё {pendingOrders.length - visiblePending.length} {plural(pendingOrders.length - visiblePending.length, 'заказ', 'заказа', 'заказов')} →
                  </button>
                )}
              </div>
            )}
          </Card>

          <div className="min-w-0 space-y-4">
            <Card>
              <CardTitle icon="box" title="Каталог" hint="Что мешает продавать" />
              <div className="mt-2 px-2 pb-2">
                <SignalRow icon="archive" count={outOfStock} label={plural(outOfStock, 'товар без остатка', 'товара без остатка', 'товаров без остатка')} ok="Все товары в наличии" onClick={() => onGoTo('products')} />
                <SignalRow icon="eyeOff" count={hidden} label={plural(hidden, 'товар скрыт из каталога', 'товара скрыты из каталога', 'товаров скрыто из каталога')} ok="Скрытых товаров нет" onClick={() => onGoTo('products')} />
                <SignalRow icon="sliders" count={categoriesWithoutSchema} label={plural(categoriesWithoutSchema, 'категория без схемы полей', 'категории без схемы полей', 'категорий без схемы полей')} ok="У всех категорий настроена схема" onClick={() => onGoTo('fields')} />
              </div>
            </Card>

            {featured && (
              <button
                type="button"
                onClick={() => onEditProduct(featured)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-yellow-400/20 bg-gradient-to-br from-yellow-400/[0.08] to-transparent p-4 text-left transition hover:border-yellow-400/40"
                title="Открыть карточку товара"
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06]">
                  {featured.main_image_url
                    ? <img src={imageUrl(featured.main_image_url)} alt="" className="h-full w-full object-cover" />
                    : <AdminIcon name="star" className="h-6 w-6 text-yellow-300" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-yellow-400/80"><AdminIcon name="star" className="h-3 w-3" /> Хит продаж на главной</span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-white">{featured.name}</span>
                  <span className="block text-xs text-slate-500">{fmtMoney(featured.discount_price ?? featured.price)} · {featuredCount} {plural(featuredCount, 'товар отмечен', 'товара отмечено', 'товаров отмечено')}</span>
                </span>
                <AdminIcon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:text-yellow-300" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Быстрые действия ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Быстрые действия</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction icon="plus" label="Новый товар" hint="Одна карточка в каталог" onClick={onNewProduct} />
          <QuickAction icon="layers" label="Создать группу" hint="Модель с вариантами памяти и цвета" onClick={onNewGroup} />
          <QuickAction icon="folder" label="Новая категория" hint="Раздел каталога со схемой полей" onClick={onNewCategory} />
          <QuickAction icon="image" label="Новый баннер" hint="Слайд на главной странице" onClick={onNewBanner} />
        </div>
      </section>
    </div>
  )
}
