import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { getAuthHeaders } from '../../lib/auth'

// ─── Вкладка «Аналитика» ─────────────────────────────────────────────────────
// Показывает, сколько и как продали: KPI с дельтами к прошлому периоду, график
// динамики (текущий период — ярко, прошлый — тускло пунктиром) и разрезы по
// товарам, брендам, категориям, статусам и страницам. Все цифры приходят с
// /api/admin/analytics — ничего не досчитываем и не выдумываем на клиенте.

// ============ TYPES ============

interface MetricPair {
  current: number
  previous: number
}

interface AnalyticsKpi {
  revenue: MetricPair
  orders: MetricPair
  avg_check: MetricPair
  items_sold: MetricPair
  visits: MetricPair
  conversion: MetricPair
}

interface SeriesPoint {
  bucket: string
  revenue: number
  orders: number
  visits: number
}

interface RangeInfo {
  from: string
  to: string
  days: number
}

interface StatusRow {
  status: string
  orders: number
  revenue: number
}

interface ProductRow {
  product_id: string | null
  name: string
  qty: number
  revenue: number
}

interface BrandRow {
  brand: string
  qty: number
  revenue: number
}

interface CategoryRow {
  category_id: string | null
  name: string
  qty: number
  revenue: number
}

interface PageRow {
  path: string
  visits: number
}

interface AnalyticsResponse {
  range: RangeInfo
  previous_range: RangeInfo
  kpi: AnalyticsKpi
  series: SeriesPoint[]
  previous_series: SeriesPoint[]
  by_status: StatusRow[]
  top_products: ProductRow[]
  top_brands: BrandRow[]
  top_categories: CategoryRow[]
  top_pages: PageRow[]
}

type PeriodKey = 'day' | 'week' | 'month' | 'custom'
type ChartMetric = 'revenue' | 'orders' | 'visits'
type AuthFetchFn = (url: string, init?: RequestInit) => Promise<Response>

// ============ CONSTANTS ============

const PERIODS: { id: PeriodKey; label: string }[] = [
  { id: 'day', label: 'Сегодня' },
  { id: 'week', label: '7 дней' },
  { id: 'month', label: '30 дней' },
  { id: 'custom', label: 'Свой период' },
]

/** Подписи и цвета статусов — зеркало STATUS_CONFIG админки, но под тёмный фон. */
const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  pending: { label: 'Новый', dot: 'bg-blue-400', text: 'text-blue-300' },
  confirmed: { label: 'Подтверждён', dot: 'bg-cyan-400', text: 'text-cyan-300' },
  processing: { label: 'В обработке', dot: 'bg-orange-400', text: 'text-orange-300' },
  shipped: { label: 'Отправлен', dot: 'bg-indigo-400', text: 'text-indigo-300' },
  delivered: { label: 'Доставлен', dot: 'bg-green-400', text: 'text-green-300' },
  cancelled: { label: 'Отменён', dot: 'bg-red-400', text: 'text-red-300' },
  refunded: { label: 'Возврат', dot: 'bg-slate-400', text: 'text-slate-300' },
}

const STATUS_OPTIONS = [
  { id: 'all', label: 'Все статусы' },
  ...Object.entries(STATUS_META).map(([id, meta]) => ({ id, label: meta.label })),
]

const CHART_METRICS: { id: ChartMetric; label: string }[] = [
  { id: 'revenue', label: 'Выручка' },
  { id: 'orders', label: 'Заказы' },
  { id: 'visits', label: 'Визиты' },
]

const LS_PERIOD = 'takesmart_analytics_period'
const LS_FROM = 'takesmart_analytics_from'
const LS_TO = 'takesmart_analytics_to'
const LS_METRIC = 'takesmart_analytics_metric'

const COLOR_CURRENT = '#facc15' // yellow-400 — текущий период
const COLOR_PREVIOUS = '#94a3b8' // slate-400 — прошлый период

// ============ FORMATTERS ============

const nf = new Intl.NumberFormat('ru-RU')

function formatMoney(value: number): string {
  return `${nf.format(Math.round(value))} ₽`
}

/** Крупные суммы ужимаем до «1,23 млн ₽», остальные — полностью. */
function formatMoneyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн ₽`
  }
  return formatMoney(value)
}

function formatCount(value: number): string {
  return nf.format(Math.round(value))
}

function formatPercentValue(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`
}

/** Подпись деления оси: круглые «250 тыс» / «1,2 млн». */
function formatAxisValue(value: number, metric: ChartMetric): string {
  if (metric !== 'revenue') return nf.format(value)
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс`
  return nf.format(value)
}

function formatMetricValue(value: number, metric: ChartMetric): string {
  return metric === 'revenue' ? formatMoney(value) : formatCount(value)
}

/**
 * Дельта в процентах. null — сравнивать не с чем (в прошлом периоде был ноль),
 * это честнее, чем рисовать «+100%» на пустой базе.
 */
function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function formatDelta(pct: number): string {
  // Рост с почти нулевой базы даёт проценты вида «+1 818,7%» — их невозможно
  // читать. От десятикратного роста показываем «в N раз», это понятнее.
  if (pct >= 900) {
    const times = pct / 100 + 1
    return `в ${times.toLocaleString('ru-RU', { maximumFractionDigits: times >= 10 ? 0 : 1 })} раз больше`
  }
  const sign = pct > 0 ? '+' : '−'
  return `${sign}${Math.abs(pct).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
}

/** Бакет приходит либо как «2026-08-05», либо как ISO с временем (для «Сегодня»). */
function parseBucket(bucket: string): Date | null {
  if (!bucket) return null
  // Чистая дата: разбираем как локальную, иначе браузер сдвинет её на часовой пояс.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket)
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
  }
  const parsed = new Date(bucket)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatBucketShort(bucket: string, period: PeriodKey): string {
  const date = parseBucket(bucket)
  if (!date) return bucket
  if (period === 'day') return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

function formatBucketFull(bucket: string, period: PeriodKey): string {
  const date = parseBucket(bucket)
  if (!date) return bucket
  if (period === 'day') return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
}

function formatRange(range: RangeInfo): string {
  const from = parseBucket(range.from)
  const to = parseBucket(range.to)
  if (!from || !to) return `${range.from} — ${range.to}`
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const left = from.toLocaleDateString('ru-RU', opts).replace('.', '')
  const right = to.toLocaleDateString('ru-RU', opts).replace('.', '')
  return left === right ? left : `${left} — ${right}`
}

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// ============ RESPONSE NORMALIZATION ============
// Бэкенд может отдать null вместо числа или пропустить блок — приводим ответ к
// строгой форме один раз здесь, чтобы ниже по коду не проверять каждое поле.

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value ? value : fallback
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function asPair(value: unknown): MetricPair {
  const raw = asRecord(value)
  return { current: asNumber(raw.current), previous: asNumber(raw.previous) }
}

function asRange(value: unknown): RangeInfo {
  const raw = asRecord(value)
  return { from: asString(raw.from), to: asString(raw.to), days: asNumber(raw.days) }
}

function asSeries(value: unknown): SeriesPoint[] {
  return asArray(value).map(item => {
    const raw = asRecord(item)
    return {
      bucket: asString(raw.bucket),
      revenue: asNumber(raw.revenue),
      orders: asNumber(raw.orders),
      visits: asNumber(raw.visits),
    }
  })
}

function normalizeAnalytics(payload: unknown): AnalyticsResponse {
  const raw = asRecord(payload)
  const kpi = asRecord(raw.kpi)
  return {
    range: asRange(raw.range),
    previous_range: asRange(raw.previous_range),
    kpi: {
      revenue: asPair(kpi.revenue),
      orders: asPair(kpi.orders),
      avg_check: asPair(kpi.avg_check),
      items_sold: asPair(kpi.items_sold),
      visits: asPair(kpi.visits),
      conversion: asPair(kpi.conversion),
    },
    series: asSeries(raw.series),
    previous_series: asSeries(raw.previous_series),
    by_status: asArray(raw.by_status).map(item => {
      const row = asRecord(item)
      return { status: asString(row.status), orders: asNumber(row.orders), revenue: asNumber(row.revenue) }
    }),
    top_products: asArray(raw.top_products).map(item => {
      const row = asRecord(item)
      return {
        product_id: asId(row.product_id),
        name: asString(row.name, 'Без названия'),
        qty: asNumber(row.qty),
        revenue: asNumber(row.revenue),
      }
    }),
    top_brands: asArray(raw.top_brands).map(item => {
      const row = asRecord(item)
      return { brand: asString(row.brand, 'Без бренда'), qty: asNumber(row.qty), revenue: asNumber(row.revenue) }
    }),
    top_categories: asArray(raw.top_categories).map(item => {
      const row = asRecord(item)
      return {
        category_id: asId(row.category_id),
        name: asString(row.name, 'Без категории'),
        qty: asNumber(row.qty),
        revenue: asNumber(row.revenue),
      }
    }),
    top_pages: asArray(raw.top_pages).map(item => {
      const row = asRecord(item)
      return { path: asString(row.path, '—'), visits: asNumber(row.visits) }
    }),
  }
}

// ============ SMALL UI PIECES ============

/** Бейдж дельты: рост зелёным, падение красным, ноль и «нет базы» — серым. */
function DeltaBadge({ pct, className = '' }: { pct: number | null; className?: string }) {
  if (pct === null) {
    return <span className={`rounded-full bg-white/8 px-1.5 py-0.5 text-[11px] font-medium text-slate-400 ${className}`}>нет базы</span>
  }
  if (Math.abs(pct) < 0.05) {
    return <span className={`rounded-full bg-white/8 px-1.5 py-0.5 text-[11px] font-medium text-slate-400 ${className}`}>без изменений</span>
  }
  const positive = pct > 0
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
        positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
      } ${className}`}
    >
      {formatDelta(pct)}
    </span>
  )
}

function KpiCard({
  label,
  value,
  previousValue,
  pct,
  loading,
  hint,
}: {
  label: string
  value: string
  previousValue: string
  pct: number | null
  loading: boolean
  /** Уточнение под заголовком: например, что метрика не считает отменённые заказы. */
  hint?: string
}) {
  return (
    <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition hover:bg-white/[0.07]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        {hint && <span className="truncate text-[10px] text-slate-600" title={hint}>{hint}</span>}
      </div>
      {loading ? (
        <>
          <div className="mt-2 h-7 w-28 animate-pulse rounded-lg bg-white/10" />
          <div className="mt-2.5 h-4 w-36 animate-pulse rounded bg-white/5" />
        </>
      ) : (
        <>
          <div className="mt-1.5 truncate text-2xl font-bold text-white" title={value}>
            {value}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <DeltaBadge pct={pct} />
            <span className="text-[11px] text-slate-500">было {previousValue}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** Карточка-обёртка блока с заголовком. */
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <div className="py-6 text-center text-sm text-slate-500">{text}</div>
}

/** Строка-бар: подпись слева, значение справа, полоса по доле от максимума. */
function BarRow({
  label,
  value,
  hint,
  ratio,
  color = 'from-yellow-400 to-amber-500',
}: {
  label: string
  value: string
  hint?: string
  ratio: number
  color?: string
}) {
  const width = Math.max(2, Math.min(100, ratio * 100))
  return (
    <div className="group">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-sm font-semibold text-white">{value}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
          <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${width}%` }} />
        </div>
        {hint && <span className="shrink-0 text-[11px] text-slate-500">{hint}</span>}
      </div>
    </div>
  )
}

// ============ CHART ============

interface ChartScale {
  max: number
  step: number
}

/** Круглые деления оси: шаг 1/2/2.5/5 × 10^n, чтобы подписи читались. */
function niceScale(maxValue: number, tickCount = 4): ChartScale {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { max: tickCount, step: 1 }
  const rawStep = maxValue / tickCount
  const exp = Math.floor(Math.log10(rawStep))
  const base = Math.pow(10, exp)
  const norm = rawStep / base
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = niceNorm * base
  return { max: step * tickCount, step }
}

const CHART_HEIGHT = 290
const TICK_COUNT = 4

function TrendChart({
  series,
  previousSeries,
  metric,
  period,
  range,
  previousRange,
}: {
  series: SeriesPoint[]
  previousSeries: SeriesPoint[]
  metric: ChartMetric
  period: PeriodKey
  range: RangeInfo
  previousRange: RangeInfo
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  // Ширину меряем сами: рисуем SVG в реальных пикселях, иначе viewBox растянет
  // текст и толщину линий.
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const update = () => setWidth(node.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const current = useMemo(() => series.map(point => point[metric]), [series, metric])
  const previous = useMemo(() => previousSeries.map(point => point[metric]), [previousSeries, metric])

  const n = current.length
  const hasCurrentData = current.some(v => v > 0)
  const hasPreviousData = previous.some(v => v > 0)

  const padLeft = width < 520 ? 46 : 62
  const padRight = 18
  const padTop = 18
  const padBottom = 30
  const innerW = Math.max(0, width - padLeft - padRight)
  const innerH = CHART_HEIGHT - padTop - padBottom

  const scale = useMemo(() => niceScale(Math.max(0, ...current, ...previous), TICK_COUNT), [current, previous])

  const xAt = useCallback(
    (index: number) => (n > 1 ? padLeft + (innerW * index) / (n - 1) : padLeft + innerW / 2),
    [n, padLeft, innerW],
  )
  const yAt = useCallback(
    (value: number) => padTop + innerH * (1 - Math.min(1, Math.max(0, value / scale.max))),
    [innerH, scale.max],
  )

  const buildLine = useCallback(
    (values: number[]) =>
      values
        .slice(0, n)
        .map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`)
        .join(' '),
    [n, xAt, yAt],
  )

  const currentPath = useMemo(() => buildLine(current), [buildLine, current])
  const previousPath = useMemo(() => buildLine(previous), [buildLine, previous])
  const areaPath = useMemo(() => {
    if (n < 2 || !currentPath) return ''
    const baseline = padTop + innerH
    return `${currentPath} L ${xAt(n - 1).toFixed(1)} ${baseline} L ${xAt(0).toFixed(1)} ${baseline} Z`
  }, [currentPath, n, innerH, xAt])

  // Подписи оси X разрежаем по реальному месту в пикселях, а не по числу точек:
  // иначе на узком экране соседние даты налезают друг на друга.
  const tickIndexes = useMemo(() => {
    if (n === 0) return []
    if (n === 1) return [0]
    const minGap = period === 'day' ? 46 : 56
    const stepPx = innerW / (n - 1)
    const every = Math.max(1, Math.ceil(minGap / Math.max(1, stepPx)))
    const list: number[] = []
    for (let i = 0; i < n; i += every) list.push(i)
    const last = list[list.length - 1]
    if (last !== n - 1) {
      // Последняя точка периода нужна всегда; если предыдущая подпись слишком
      // близко к ней — убираем именно предыдущую.
      if ((n - 1 - last) * stepPx < minGap) list.pop()
      list.push(n - 1)
    }
    return list
  }, [n, innerW, period])

  // Точки рисуем только когда их немного, иначе линия превращается в бусы.
  const showDots = n > 1 && n <= 14

  const pickIndex = useCallback(
    (clientX: number, target: SVGSVGElement) => {
      if (n === 0) return null
      const rect = target.getBoundingClientRect()
      const x = clientX - rect.left
      if (n === 1) return 0
      const step = innerW / (n - 1)
      if (step <= 0) return 0
      return Math.min(n - 1, Math.max(0, Math.round((x - padLeft) / step)))
    },
    [n, innerW, padLeft],
  )

  if (n === 0 || (!hasCurrentData && !hasPreviousData)) {
    return (
      <div ref={wrapRef} className="flex flex-col items-center justify-center gap-2 py-16 text-center" style={{ minHeight: CHART_HEIGHT }}>
        <div className="text-3xl opacity-40">📉</div>
        <div className="text-sm text-slate-400">
          {metric === 'visits' ? 'За этот период визитов не было' : 'За этот период продаж не было'}
        </div>
        <div className="text-xs text-slate-600">Попробуйте выбрать другой период или снять фильтр по статусу</div>
      </div>
    )
  }

  const hoverIndex = hover !== null && hover >= 0 && hover < n ? hover : null
  const hoverCurrent = hoverIndex !== null ? current[hoverIndex] : 0
  const hoverPrevious = hoverIndex !== null ? (previous[hoverIndex] ?? 0) : 0
  const hoverDelta = hoverIndex !== null ? deltaPercent(hoverCurrent, hoverPrevious) : null
  const tooltipLeft = hoverIndex !== null ? Math.min(Math.max(xAt(hoverIndex), 90), Math.max(90, width - 90)) : 0

  return (
    <div ref={wrapRef} className="relative select-none">
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          className="block overflow-visible"
          style={{ touchAction: 'pan-y' }}
          onPointerMove={e => setHover(pickIndex(e.clientX, e.currentTarget))}
          onPointerDown={e => setHover(pickIndex(e.clientX, e.currentTarget))}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
        >
          <defs>
            <linearGradient id="analytics-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_CURRENT} stopOpacity="0.28" />
              <stop offset="100%" stopColor={COLOR_CURRENT} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Сетка и подписи оси Y */}
          {Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
            const value = scale.step * i
            const y = yAt(value)
            return (
              <g key={i}>
                <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
                <text x={padLeft - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                  {formatAxisValue(value, metric)}
                </text>
              </g>
            )
          })}

          {/* Прошлый период — тускло и пунктиром, без заливки */}
          {hasPreviousData && previousPath && (
            <path
              d={previousPath}
              fill="none"
              stroke={COLOR_PREVIOUS}
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.55}
            />
          )}

          {/* Текущий период — ярко, с заливкой */}
          {areaPath && <path d={areaPath} fill="url(#analytics-area)" />}
          {currentPath && (
            <path
              d={currentPath}
              fill="none"
              stroke={COLOR_CURRENT}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Одна точка в периоде — линии не видно, показываем маркер */}
          {n === 1 && <circle cx={xAt(0)} cy={yAt(current[0])} r={5} fill={COLOR_CURRENT} />}

          {showDots &&
            current.map((value, index) => (
              <circle key={index} cx={xAt(index)} cy={yAt(value)} r={3} fill={COLOR_CURRENT} stroke="#0f172a" strokeWidth={1.5} />
            ))}

          {/* Курсор и выделенные точки */}
          {hoverIndex !== null && (
            <g>
              <line
                x1={xAt(hoverIndex)}
                y1={padTop}
                x2={xAt(hoverIndex)}
                y2={padTop + innerH}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              {hasPreviousData && (
                <circle cx={xAt(hoverIndex)} cy={yAt(hoverPrevious)} r={3.5} fill={COLOR_PREVIOUS} opacity={0.8} />
              )}
              <circle cx={xAt(hoverIndex)} cy={yAt(hoverCurrent)} r={5} fill={COLOR_CURRENT} stroke="#0f172a" strokeWidth={2} />
            </g>
          )}

          {/* Подписи оси X */}
          {tickIndexes.map(index => (
            <text
              key={index}
              x={xAt(index)}
              y={CHART_HEIGHT - 8}
              textAnchor={index === 0 ? 'start' : index === n - 1 ? 'end' : 'middle'}
              className="fill-slate-500 text-[11px]"
            >
              {formatBucketShort(series[index]?.bucket ?? '', period)}
            </text>
          ))}
        </svg>
      )}

      {/* Всплывающая подсказка */}
      {hoverIndex !== null && width > 0 && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
          style={{ left: tooltipLeft }}
        >
          <div className="text-[11px] font-medium text-slate-400">
            {formatBucketFull(series[hoverIndex]?.bucket ?? '', period)}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR_CURRENT }} />
            <span className="text-sm font-semibold text-white">{formatMetricValue(hoverCurrent, metric)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR_PREVIOUS }} />
            <span className="text-xs text-slate-400">{formatMetricValue(hoverPrevious, metric)}</span>
          </div>
          {hoverDelta !== null && Math.abs(hoverDelta) >= 0.05 && (
            <div className={`mt-1.5 text-[11px] font-semibold ${hoverDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {hoverDelta > 0 ? '↑' : '↓'} {formatDelta(hoverDelta)}{hoverDelta >= 900 ? '' : ' к прошлому периоду'}
            </div>
          )}
          {previousSeries[hoverIndex]?.bucket && (
            <div className="mt-1 text-[10px] text-slate-600">было: {formatBucketFull(previousSeries[hoverIndex].bucket, period)}</div>
          )}
        </div>
      )}

      {/* Легенда */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full" style={{ background: COLOR_CURRENT }} />
          Текущий: {formatRange(range)}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="20" height="2" className="shrink-0">
            <line x1="0" y1="1" x2="20" y2="1" stroke={COLOR_PREVIOUS} strokeWidth="2" strokeDasharray="4 3" opacity="0.7" />
          </svg>
          Прошлый: {formatRange(previousRange)}
        </span>
        {!hasCurrentData && <span className="text-slate-500">— в текущем периоде значений нет</span>}
      </div>
    </div>
  )
}

// ============ MAIN ============

export function AnalyticsTab({ authFetch }: { authFetch?: AuthFetchFn }) {
  const [period, setPeriod] = useState<PeriodKey>(() => {
    try {
      const saved = localStorage.getItem(LS_PERIOD)
      return saved === 'day' || saved === 'week' || saved === 'month' || saved === 'custom' ? saved : 'month'
    } catch {
      return 'month'
    }
  })
  const [customFrom, setCustomFrom] = useState(() => {
    try {
      return localStorage.getItem(LS_FROM) ?? ''
    } catch {
      return ''
    }
  })
  const [customTo, setCustomTo] = useState(() => {
    try {
      return localStorage.getItem(LS_TO) ?? ''
    } catch {
      return ''
    }
  })
  const [status, setStatus] = useState('all')
  const [metric, setMetric] = useState<ChartMetric>(() => {
    try {
      const saved = localStorage.getItem(LS_METRIC)
      return saved === 'orders' || saved === 'visits' ? saved : 'revenue'
    } catch {
      return 'revenue'
    }
  })

  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(LS_PERIOD, period)
    } catch {
      /* приватный режим — просто не запомним выбор */
    }
  }, [period])
  useEffect(() => {
    try {
      localStorage.setItem(LS_FROM, customFrom)
      localStorage.setItem(LS_TO, customTo)
    } catch {
      /* см. выше */
    }
  }, [customFrom, customTo])
  useEffect(() => {
    try {
      localStorage.setItem(LS_METRIC, metric)
    } catch {
      /* см. выше */
    }
  }, [metric])

  const customReady = period !== 'custom' || (!!customFrom && !!customTo && customFrom <= customTo)

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    if (!customReady) return
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ period })
      if (period === 'custom') {
        params.set('from', customFrom)
        params.set('to', customTo)
      }
      if (status !== 'all') params.set('status', status)

      const url = `${API_BASE_URL}/api/admin/analytics?${params.toString()}`
      const response = authFetch
        ? await authFetch(url)
        : await fetch(url, { headers: { Accept: 'application/json', ...getAuthHeaders() } })
      if (seq !== loadSeq.current) return
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Нет доступа: войдите в админку заново'
            : response.status === 404
              ? 'Раздел аналитики ещё не доступен на сервере'
              : `Сервер ответил ${response.status}`,
        )
      }
      const payload: unknown = await response.json()
      if (seq !== loadSeq.current) return
      setData(normalizeAnalytics(payload))
      setLoading(false)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить аналитику')
      setLoading(false)
    }
  }, [period, customFrom, customTo, status, customReady, authFetch])

  useEffect(() => {
    void load()
  }, [load])

  const kpi = data?.kpi
  const revenueTotal = kpi?.revenue.current ?? 0

  const maxBrandRevenue = useMemo(() => Math.max(1, ...(data?.top_brands ?? []).map(b => b.revenue)), [data])
  const maxCategoryRevenue = useMemo(() => Math.max(1, ...(data?.top_categories ?? []).map(c => c.revenue)), [data])
  const maxPageVisits = useMemo(() => Math.max(1, ...(data?.top_pages ?? []).map(p => p.visits)), [data])
  const statusTotalOrders = useMemo(() => (data?.by_status ?? []).reduce((sum, row) => sum + row.orders, 0), [data])

  const kpiCards = [
    { label: 'Выручка', value: formatMoneyCompact(kpi?.revenue.current ?? 0), previous: formatMoneyCompact(kpi?.revenue.previous ?? 0), pair: kpi?.revenue },
    { label: 'Заказов', value: formatCount(kpi?.orders.current ?? 0), previous: formatCount(kpi?.orders.previous ?? 0), pair: kpi?.orders, hint: 'без отменённых и возвратов' },
    { label: 'Средний чек', value: formatMoneyCompact(kpi?.avg_check.current ?? 0), previous: formatMoneyCompact(kpi?.avg_check.previous ?? 0), pair: kpi?.avg_check },
    { label: 'Товаров продано', value: formatCount(kpi?.items_sold.current ?? 0), previous: formatCount(kpi?.items_sold.previous ?? 0), pair: kpi?.items_sold },
    { label: 'Визитов', value: formatCount(kpi?.visits.current ?? 0), previous: formatCount(kpi?.visits.previous ?? 0), pair: kpi?.visits },
    { label: 'Конверсия', value: formatPercentValue(kpi?.conversion.current ?? 0), previous: formatPercentValue(kpi?.conversion.previous ?? 0), pair: kpi?.conversion },
  ]

  const showSkeleton = loading && !data

  return (
    <div>
      {/* ── Шапка раздела ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">📈 Аналитика</h2>
          <p className="mt-1 text-sm text-slate-400">
            {data
              ? `${formatRange(data.range)} · сравнение с ${formatRange(data.previous_range)}`
              : 'Продажи, визиты и конверсия с сравнением к прошлому периоду'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
        >
          <span className={loading ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
          Обновить
        </button>
      </div>

      {/* ── Фильтры ── */}
      <div className="mb-5 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map(item => {
              const isActive = period === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setPeriod(item.id)}
                  className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/15'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          {period === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo || todayIso()}
                onChange={e => setCustomFrom(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-yellow-400/50 focus:outline-none"
              />
              <span className="text-slate-500">—</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                max={todayIso()}
                onChange={e => setCustomTo(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-yellow-400/50 focus:outline-none"
              />
            </div>
          )}

          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-yellow-400/50 focus:outline-none sm:ml-auto sm:w-auto"
          >
            {STATUS_OPTIONS.map(option => (
              <option key={option.id} value={option.id} className="bg-slate-900 text-white">
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {period === 'custom' && !customReady && (
          <p className="mt-2 text-xs text-amber-400">Укажите обе даты: начало периода не позже конца.</p>
        )}
        {status !== 'all' && (
          <p className="mt-2 text-xs text-slate-500">
            Показаны только заказы со статусом «{STATUS_META[status]?.label ?? status}». Без фильтра из выручки исключаются
            отменённые и возвраты.
          </p>
        )}
      </div>

      {/* ── Ошибка ── */}
      {error && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <div>
            <div className="text-sm font-semibold text-red-300">Не удалось загрузить аналитику</div>
            <div className="mt-0.5 text-xs text-red-200/70">{error}</div>
          </div>
          <button
            onClick={() => void load()}
            className="rounded-xl bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/30"
          >
            Повторить
          </button>
        </div>
      )}

      {/* ── KPI ── */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpiCards.map(card => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={card.value}
            previousValue={card.previous}
            pct={card.pair ? deltaPercent(card.pair.current, card.pair.previous) : null}
            loading={showSkeleton}
            hint={card.hint}
          />
        ))}
      </div>

      {/* ── Главный график ── */}
      <div className="mb-5 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">{period === 'day' ? 'Динамика по часам' : 'Динамика по дням'}</h3>
          <div className="flex gap-1.5 rounded-xl bg-white/5 p-1">
            {CHART_METRICS.map(item => (
              <button
                key={item.id}
                onClick={() => setMetric(item.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  metric === item.id ? 'bg-yellow-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {showSkeleton ? (
          <div className="h-[290px] animate-pulse rounded-xl bg-white/5" />
        ) : data ? (
          <TrendChart
            series={data.series}
            previousSeries={data.previous_series}
            metric={metric}
            period={period}
            range={data.range}
            previousRange={data.previous_range}
          />
        ) : (
          <EmptyHint text="Нет данных" />
        )}
      </div>

      {/* ── Разрезы ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Топ товаров */}
        {/* min-w-0: без него ячейка грида раздувается под ширину таблицы
            (длинные названия товаров) и вся страница едет вбок на мобиле */}
        <div className="min-w-0 lg:col-span-2">
          <Panel title="Топ товаров" subtitle="Что реально покупали в выбранном периоде">
            {showSkeleton ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
                ))}
              </div>
            ) : data && data.top_products.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                      <th className="pb-2 font-medium">Товар</th>
                      <th className="pb-2 pl-3 text-right font-medium">Продано</th>
                      <th className="pb-2 pl-3 text-right font-medium">Выручка</th>
                      <th className="hidden pb-2 pl-3 text-right font-medium sm:table-cell">Доля</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.top_products.map((product, index) => {
                      const share = revenueTotal > 0 ? product.revenue / revenueTotal : 0
                      return (
                        <tr key={product.product_id ?? `${product.name}-${index}`} className="transition hover:bg-white/[0.03]">
                          <td className="max-w-[240px] py-2.5 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="w-5 shrink-0 text-xs font-semibold text-slate-600">{index + 1}</span>
                              <span className="truncate text-slate-200" title={product.name}>
                                {product.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 pl-3 text-right text-slate-300">{formatCount(product.qty)}</td>
                          <td className="py-2.5 pl-3 text-right font-semibold text-white">{formatMoney(product.revenue)}</td>
                          <td className="hidden py-2.5 pl-3 sm:table-cell">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-amber-500"
                                  style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
                                />
                              </div>
                              <span className="w-10 text-right text-xs text-slate-500">
                                {share > 0 ? `${(share * 100).toFixed(share * 100 >= 10 ? 0 : 1)}%` : '—'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyHint text="За этот период продаж не было" />
            )}
          </Panel>
        </div>

        {/* Статусы заказов */}
        <Panel title="Статусы заказов" subtitle={statusTotalOrders > 0 ? `${formatCount(statusTotalOrders)} заказов всего, включая отменённые` : undefined}>
          {showSkeleton ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          ) : data && data.by_status.length > 0 ? (
            <div className="space-y-3">
              {data.by_status.map(row => {
                const meta = STATUS_META[row.status]
                const ratio = statusTotalOrders > 0 ? row.orders / statusTotalOrders : 0
                return (
                  <div key={row.status}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${meta?.dot ?? 'bg-slate-500'}`} />
                        <span className={`truncate text-sm ${meta?.text ?? 'text-slate-300'}`}>{meta?.label ?? row.status}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-white">{formatCount(row.orders)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                        <div
                          className={`h-full rounded-full ${meta?.dot ?? 'bg-slate-500'} opacity-70`}
                          style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-500">{formatMoneyCompact(row.revenue)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyHint text="Заказов в периоде нет" />
          )}
        </Panel>

        {/* Бренды */}
        <Panel title="По брендам" subtitle="Выручка и штуки">
          {showSkeleton ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          ) : data && data.top_brands.length > 0 ? (
            <div className="space-y-3">
              {data.top_brands.map(brand => (
                <BarRow
                  key={brand.brand}
                  label={brand.brand}
                  value={formatMoneyCompact(brand.revenue)}
                  hint={`${formatCount(brand.qty)} шт`}
                  ratio={brand.revenue / maxBrandRevenue}
                />
              ))}
            </div>
          ) : (
            <EmptyHint text="Продаж по брендам нет" />
          )}
        </Panel>

        {/* Категории */}
        <Panel title="По категориям" subtitle="Выручка и штуки">
          {showSkeleton ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          ) : data && data.top_categories.length > 0 ? (
            <div className="space-y-3">
              {data.top_categories.map((category, index) => (
                <BarRow
                  key={category.category_id ?? `${category.name}-${index}`}
                  label={category.name}
                  value={formatMoneyCompact(category.revenue)}
                  hint={`${formatCount(category.qty)} шт`}
                  ratio={category.revenue / maxCategoryRevenue}
                  color="from-cyan-400 to-blue-500"
                />
              ))}
            </div>
          ) : (
            <EmptyHint text="Продаж по категориям нет" />
          )}
        </Panel>

        {/* Страницы */}
        <Panel title="Популярные страницы" subtitle="Визиты на витрине">
          {showSkeleton ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          ) : data && data.top_pages.length > 0 ? (
            <div className="space-y-3">
              {data.top_pages.map((page, index) => (
                <BarRow
                  key={`${page.path}-${index}`}
                  label={page.path}
                  value={formatCount(page.visits)}
                  ratio={page.visits / maxPageVisits}
                  color="from-violet-400 to-fuchsia-500"
                />
              ))}
            </div>
          ) : (
            <EmptyHint text="Визитов пока не собрано" />
          )}
        </Panel>
      </div>
    </div>
  )
}
