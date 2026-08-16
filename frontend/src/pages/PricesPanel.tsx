import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { toast, ToastHost } from '../lib/toast'

// ─────────────────────────────────────────────────────────────────────────────
// «Цены» — вкладка PWA «Заказы»: инструмент, которым сотрудник за смену проходит
// весь каталог (1000+ карточек) и обновляет/подтверждает цены. Правки копятся в
// «корзине изменений» и уходят одним батчем PATCH /api/products/prices/bulk;
// бэк штампует price_updated_at = now() каждому товару из батча — даже без
// изменения цены (осознанная семантика «цена подтверждена сегодня»).
// ─────────────────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; slug: string }

interface PriceProduct {
  id: string
  name: string
  slug: string
  price: number
  discount_price: number | null
  sku: string | null
  brand: string | null
  color: string | null
  category_id: string | null
  group_id: string | null
  attributes?: Record<string, string | number | boolean | null> | null
  is_active: boolean
  // Появляется после миграции бэка; до неё поле отсутствует → считаем «не подтверждалась»
  price_updated_at?: string | null
}

interface PaginatedResponse<T> { items: T[]; total: number; offset: number; limit: number; has_next: boolean }

/** Элемент батча по контракту PATCH /api/products/prices/bulk */
interface BulkItem { id: string; price?: number; discount_price?: number | null }

/** Сырые строки инпутов (что печатает сотрудник); undefined = поле не трогали */
interface RowDraft { price?: string; discount?: string }

/** Разобранное состояние строки с правкой: что изменилось и валидно ли */
interface RowState {
  priceChanged: boolean
  discountChanged: boolean
  nextPrice: number
  nextDiscount: number | null
  error: string | null
  errorField: 'price' | 'discount' | 'both' | null
  dirty: boolean
}

interface GroupRow {
  p: PriceProduct
  /** Главная строка подписи: цвет товара (надёжное поле color), иначе хвост имени */
  main: string
  /** Вторая строка: конфигурация без цвета; null = скрыта (одинакова у всей группы) */
  config: string | null
  /** Полный хвост имени — для title и защиты от неразличимых строк */
  full: string
}

interface Group {
  key: string
  title: string
  brand: string | null
  categoryName: string | null
  categoryIds: Set<string>
  rows: GroupRow[]
  /** id только активных (не скрытых) карточек — «✓ Актуально» работает по ним */
  activeIds: string[]
  activeCount: number
  hiddenCount: number
  haystack: string
  hasNever: boolean
  minMs: number
  allToday: boolean
}

type AdjustMode = 'percent' | 'ruble'

const SAFE_TOP = { paddingTop: 'max(env(safe-area-inset-top), 0px)' }
const SAFE_BOTTOM = { paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }
const PAGE_STEP = 30 // ленивый рендер: показываем группы порциями по 30
const SAVE_CHUNK = 500 // лимит бэка 1000 позиций — шлём с запасом по 500

const fmtRub = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽'

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  if (abs >= 11 && abs <= 14) return many
  const d = abs % 10
  if (d === 1) return one
  if (d >= 2 && d <= 4) return few
  return many
}

/** «12 990», «12990,50», «12 990 ₽» → число; мусор → null */
function parseMoney(raw: string): number | null {
  const s = raw.replace(/[\s ₽]/g, '').replace(',', '.')
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Число из API → строка для инпута (без разрядных пробелов, чтобы легко править) */
function moneyToInput(v: number | string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function startOfDayMs(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
function daysAgoMs(ms: number): number { return Math.max(0, Math.round((startOfDayMs(Date.now()) - startOfDayMs(ms)) / 86_400_000)) }

interface Freshness { label: string; pill: string; dot: string; title: string }

const FRESH_PILL = {
  today: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/20',
  yesterday: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/20',
  stale: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/20',
}

/** Свежесть по price_updated_at: сегодня / вчера / N дн назад / «—» (никогда) */
function freshnessOf(iso: string | null | undefined): Freshness {
  if (!iso) return { label: '—', pill: FRESH_PILL.stale, dot: 'bg-rose-400', title: 'Цена ещё не подтверждалась' }
  const n = daysAgoMs(new Date(iso).getTime())
  if (n <= 0) return { label: '✓ сегодня', pill: FRESH_PILL.today, dot: 'bg-emerald-400', title: 'Цена подтверждена сегодня' }
  if (n === 1) return { label: 'вчера', pill: FRESH_PILL.yesterday, dot: 'bg-amber-400', title: 'Цена подтверждалась вчера' }
  return { label: `${n} дн назад`, pill: FRESH_PILL.stale, dot: 'bg-rose-400', title: `Цена подтверждалась ${n} дн назад` }
}

function groupFreshness(g: Group): Freshness {
  if (g.hasNever || !Number.isFinite(g.minMs)) return freshnessOf(null)
  return freshnessOf(new Date(g.minMs).toISOString())
}

/** Снимаем хвост-скобку варианта: «iPhone 16 Pro (Цвет: Чёрный)» → «iPhone 16 Pro» */
function stripVariantTail(name: string): string {
  let s = name.trim()
  for (;;) {
    const next = s.replace(/\s*\([^()]*\)\s*$/, '')
    if (next === s) break
    s = next.trim()
  }
  return s
}

function commonPrefix(names: string[]): string {
  if (names.length === 0) return ''
  let p = names[0]
  for (const n of names.slice(1)) {
    let i = 0
    while (i < p.length && i < n.length && p[i] === n[i]) i++
    p = p.slice(0, i)
    if (!p) break
  }
  return p
}

/** Хвост имени варианта после общего префикса, иначе цвет + оси из attributes */
function variantTail(p: PriceProduct, rawPrefix: string, diffKeys: string[]): string {
  let rest = p.name.length > rawPrefix.length ? p.name.slice(rawPrefix.length) : ''
  rest = rest.replace(/^[\s—–\-·,:]+/, '').trim()
  const paren = rest.match(/^\((.*)\)$/s)
  if (paren) rest = paren[1].trim()
  rest = rest.replace(/(^|[,;]\s*)цвет:\s*/gi, '$1').trim()
  if (rest) return rest
  const parts: string[] = []
  if (p.color) parts.push(p.color)
  for (const k of diffKeys) {
    const v = p.attributes?.[k]
    if (v == null || v === '' || typeof v === 'boolean') continue
    const s = String(v)
    if (s !== p.color) parts.push(s)
  }
  return parts.join(' · ')
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Чистка конфигурации после вырезания цвета: «Цвет:», двойные запятые, мусорные разделители и непарные скобки по краям */
function cleanConfigText(raw: string): string {
  let s = raw.replace(/цвет:\s*/gi, ' ')
  s = s.replace(/\s*,(\s*,)+\s*/g, ', ').replace(/\s{2,}/g, ' ')
  for (;;) {
    let t = s.replace(/^[\s,;:·—–-]+|[\s,;:·—–-]+$/g, '')
    const open = (t.match(/\(/g) ?? []).length
    const close = (t.match(/\)/g) ?? []).length
    if (close > open && t.endsWith(')')) t = t.slice(0, -1)
    else if (close > open && t.startsWith(')')) t = t.slice(1)
    else if (open > close && t.startsWith('(')) t = t.slice(1)
    else if (open > close && t.endsWith('(')) t = t.slice(0, -1)
    if (t === s) break
    s = t
  }
  return s.trim()
}

/** Конфигурация варианта = хвост имени без вхождений цвета (без учёта регистра) */
function configFromTail(tail: string, color: string): string {
  if (!tail) return ''
  if (!color) return cleanConfigText(tail)
  return cleanConfigText(tail.replace(new RegExp(escapeRegExp(color), 'gi'), ' '))
}

/** Пересчёт цены для групповой операции ±% / ±₽, округление до целого рубля */
function adjustValue(v: number, mode: AdjustMode, dir: 1 | -1, value: number): number {
  const raw = mode === 'percent' ? v * (1 + (dir * value) / 100) : v + dir * value
  return Math.max(1, Math.round(raw))
}

// ── Иконка глаза для переключателя видимости ─────────────────────────────────
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
          <path d="M2 2l20 20" />
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

// ── Мини-диалог групповой операции «±%» ──────────────────────────────────────
function GroupAdjustSheet({ group, preview, onClose, onApply }: {
  group: Group
  preview: { price: number; discount: number | null } | null
  onClose: () => void
  onApply: (mode: AdjustMode, dir: 1 | -1, value: number) => void
}) {
  const [mode, setMode] = useState<AdjustMode>('percent')
  const [dir, setDir] = useState<1 | -1>(1)
  const [val, setVal] = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const n = parseMoney(val)
  const valid = n != null && n > 0 && (mode !== 'percent' || n <= 95)
  const previewNew = valid && preview ? adjustValue(preview.price, mode, dir, n!) : null

  const seg = (active: boolean) =>
    `flex-1 rounded-xl py-2.5 text-sm font-semibold transition active:scale-95 ${active ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Изменить цены группы"
        className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/10 bg-slate-950 px-4 pt-4" style={SAFE_BOTTOM}>
        <div className="mx-auto max-w-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{group.title}</div>
              <div className="text-[11px] text-slate-500">Пересчитать все {group.rows.length} {pluralRu(group.rows.length, 'карточку', 'карточки', 'карточек')} группы</div>
            </div>
            <button onClick={onClose} aria-label="Закрыть" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/5 text-lg text-slate-300 transition hover:bg-white/10 active:scale-95">✕</button>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={() => setMode('percent')} className={seg(mode === 'percent')}>Проценты %</button>
            <button onClick={() => setMode('ruble')} className={seg(mode === 'ruble')}>Рубли ₽</button>
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setDir(1)} className={seg(dir === 1)}>+ Повысить</button>
            <button onClick={() => setDir(-1)} className={seg(dir === -1)}>− Понизить</button>
          </div>

          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder={mode === 'percent' ? 'Например: 5' : 'Например: 500'}
            aria-label={mode === 'percent' ? 'Процент' : 'Сумма в рублях'}
            className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-center text-xl font-bold text-white placeholder-slate-600 outline-none transition focus:border-yellow-400/60 focus:bg-white/10"
          />

          <div className="mt-2 min-h-[18px] text-center text-[12px] text-slate-400">
            {previewNew != null && preview
              ? <>Пример: {fmtRub(preview.price)} → <span className="font-semibold text-yellow-300">{fmtRub(previewNew)}</span>{preview.discount != null && ' (скидочная пересчитается тоже)'}</>
              : val && !valid ? <span className="text-rose-400">{mode === 'percent' ? 'Введите процент от 0 до 95' : 'Введите сумму больше нуля'}</span> : 'Скидочные цены меняются той же операцией'}
          </div>

          <button
            disabled={!valid}
            onClick={() => { if (valid && n != null) onApply(mode, dir, n) }}
            className="mt-3 mb-1 w-full rounded-2xl bg-yellow-400 py-3.5 font-semibold text-gray-950 transition active:scale-[0.98] hover:bg-yellow-300 disabled:opacity-40">
            Применить к {group.rows.length} {pluralRu(group.rows.length, 'карточке', 'карточкам', 'карточкам')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Панель «Цены» ────────────────────────────────────────────────────────────
export function PricesPanel({ onDirtyChange }: { onDirtyChange?: (n: number) => void }) {
  const { logout } = useAuth()

  const [products, setProducts] = useState<PriceProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'done' | 'error'>('loading')
  const [loadedCount, setLoadedCount] = useState(0)

  // ── Корзина изменений ──
  // drafts: сырые строки инпутов (id → {price?, discount?}); confirms: отметки
  // «✓ Актуально» без изменения цены. Всё остальное (что изменилось, валидность,
  // элементы батча) — производные useMemo от drafts+confirms+products.
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [confirms, setConfirms] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Фильтры
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [staleOnly, setStaleOnly] = useState(() => { try { return localStorage.getItem('takesmart_prices_stale_only') !== '0' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('takesmart_prices_stale_only', staleOnly ? '1' : '0') } catch { /* */ } }, [staleOnly])
  const [sortMode, setSortMode] = useState<'stale' | 'alpha'>(() => { try { return localStorage.getItem('takesmart_prices_sort') === 'alpha' ? 'alpha' : 'stale' } catch { return 'stale' } })
  useEffect(() => { try { localStorage.setItem('takesmart_prices_sort', sortMode) } catch { /* */ } }, [sortMode])

  const [visibleCount, setVisibleCount] = useState(PAGE_STEP)
  const [adjustGroupKey, setAdjustGroupKey] = useState<string | null>(null)

  // ── Загрузка каталога чанками (в фоне, с прогрессом) ──
  const loadSeq = useRef(0)
  const loadAll = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoadState('loading')
    setLoadedCount(0)
    try {
      const CHUNK = 1000
      let offset = 0
      let all: PriceProduct[] = []
      for (;;) {
        const res = await fetch(`${API_BASE_URL}/api/products?limit=${CHUNK}&offset=${offset}&only_active=false`, { headers: getAuthHeaders() })
        if (seq !== loadSeq.current) return
        if (!res.ok) throw new Error(String(res.status))
        const data: PaginatedResponse<PriceProduct> | PriceProduct[] = await res.json()
        const items = Array.isArray(data) ? data : data.items ?? []
        all = all.concat(items)
        // Показываем каталог по мере загрузки — можно начинать работать сразу
        setLoadedCount(all.length)
        setProducts(all.slice())
        const hasNext = Array.isArray(data) ? items.length === CHUNK : Boolean(data.has_next)
        if (!hasNext || items.length === 0) break
        offset += items.length
      }
      if (seq !== loadSeq.current) return
      setLoadState('done')
    } catch {
      if (seq !== loadSeq.current) return
      setLoadState('error')
      toast('Не удалось загрузить каталог. Проверьте связь.', 'error')
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/api/categories?limit=100`, { headers: getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PaginatedResponse<Category> | null) => { if (d && !cancelled) setCategories(d.items ?? []) })
      .catch(() => { /* чипы категорий просто не покажем */ })
    return () => { cancelled = true }
  }, [])

  // ── Группировка по group_id ──
  const groups = useMemo<Group[]>(() => {
    const catName = new Map(categories.map((c) => [c.id, c.name]))
    const byGroup = new Map<string, PriceProduct[]>()
    const singles: PriceProduct[] = []
    for (const p of products) {
      if (p.group_id) {
        const arr = byGroup.get(p.group_id)
        if (arr) arr.push(p)
        else byGroup.set(p.group_id, [p])
      } else singles.push(p)
    }

    const build = (key: string, list: PriceProduct[]): Group => {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      const cleaned = sorted.map((p) => stripVariantTail(p.name))
      let rawPrefix: string
      if (sorted.length === 1) rawPrefix = cleaned[0]
      else {
        rawPrefix = commonPrefix(cleaned)
        // Не режем слово посередине: откатываемся до последнего пробела
        if (cleaned.some((n) => n.length > rawPrefix.length) && rawPrefix && !/[\s,—–\-(]$/.test(rawPrefix)) {
          const cut = rawPrefix.lastIndexOf(' ')
          if (cut > 0) rawPrefix = rawPrefix.slice(0, cut + 1)
        }
      }
      let title = rawPrefix.replace(/[\s—–\-·,:(«]+$/, '').trim()
      if (title.length < 3) title = cleaned[0] || sorted[0].name

      // Оси-атрибуты, различающиеся внутри группы (для подписи варианта)
      const diffKeys: string[] = []
      if (sorted.length > 1) {
        const keys = new Set<string>()
        for (const p of sorted) for (const k of Object.keys(p.attributes ?? {})) keys.add(k)
        keys.forEach((k) => {
          const vals = new Set(sorted.map((p) => String(p.attributes?.[k] ?? '')))
          if (vals.size > 1) diffKeys.push(k)
        })
      }

      // Подписи вариантов: главная строка = цвет (цена зависит от него), вторая = конфигурация
      const prelim = sorted.map((p) => {
        const tail = variantTail(p, rawPrefix, diffKeys)
        const color = (p.color ?? '').trim()
        return { p, tail, color, config: configFromTail(tail, color) }
      })
      // Конфигурацию показываем, только если она различается между карточками группы (иначе шум)
      const configsDiffer = new Set(prelim.map((r) => (r.color ? r.config : r.tail).toLowerCase())).size > 1
      // Сортировка: сначала конфигурация, потом цвет — одинаковые конфиги с разными цветами рядом
      prelim.sort((a, b) => a.config.localeCompare(b.config, 'ru') || (a.color || a.tail).localeCompare(b.color || b.tail, 'ru'))
      let rows: GroupRow[] = prelim.map(({ p, tail, color, config }) => ({
        p,
        main: color || tail || '—',
        config: configsDiffer && color && config ? config : null,
        full: tail || p.name,
      }))
      // Защита от неразличимых строк: одинаковая подпись → показываем полный хвост имени
      const sig = (r: GroupRow) => `${r.main}|${r.config ?? ''}`.toLowerCase()
      const sigCount = new Map<string, number>()
      for (const r of rows) sigCount.set(sig(r), (sigCount.get(sig(r)) ?? 0) + 1)
      rows = rows.map((r) => ((sigCount.get(sig(r)) ?? 0) > 1 && r.full !== r.main ? { ...r, main: r.full, config: null } : r))

      const categoryIds = new Set<string>()
      for (const p of sorted) if (p.category_id) categoryIds.add(p.category_id)
      const firstCat = sorted.find((p) => p.category_id)?.category_id
      const brand = sorted.find((p) => p.brand)?.brand ?? null

      // Свежесть и «всё подтверждено» считаем ТОЛЬКО по активным: скрытый товар не продаётся
      const actives = sorted.filter((p) => p.is_active)
      let hasNever = false
      let minMs = Infinity
      let allToday = actives.length > 0
      for (const p of actives) {
        if (!p.price_updated_at) { hasNever = true; allToday = false; continue }
        const ms = new Date(p.price_updated_at).getTime()
        if (ms < minMs) minMs = ms
        if (daysAgoMs(ms) !== 0) allToday = false
      }

      const haystack = [title, brand ?? '', ...sorted.map((p) => `${p.name} ${p.sku ?? ''} ${p.brand ?? ''}`)].join(' ').toLowerCase()
      return {
        key, title, brand,
        categoryName: firstCat ? catName.get(firstCat) ?? null : null,
        categoryIds, rows,
        activeIds: actives.map((p) => p.id),
        activeCount: actives.length,
        hiddenCount: sorted.length - actives.length,
        haystack, hasNever, minMs, allToday,
      }
    }

    const out: Group[] = []
    byGroup.forEach((list, gid) => out.push(build(`g:${gid}`, list)))
    for (const p of singles) out.push(build(`p:${p.id}`, [p]))
    return out
  }, [products, categories])

  // ── Разбор черновиков: что изменилось и валидно ли ──
  const rowStates = useMemo(() => {
    const map = new Map<string, RowState>()
    for (const p of products) {
      const d = drafts[p.id]
      if (!d) continue
      const basePrice = Number(p.price)
      const baseDisc = p.discount_price == null ? null : Number(p.discount_price)

      let nextPrice = basePrice
      let priceChanged = false
      let error: string | null = null
      let errorField: RowState['errorField'] = null
      if (d.price !== undefined && d.price.trim() !== '') {
        const n = parseMoney(d.price)
        if (n == null || n <= 0) { error = 'Цена должна быть числом больше нуля'; errorField = 'price' }
        else { nextPrice = n; priceChanged = Math.abs(n - basePrice) > 0.001 }
      }

      let nextDiscount = baseDisc
      let discountChanged = false
      if (d.discount !== undefined) {
        if (d.discount.trim() === '') { nextDiscount = null; discountChanged = baseDisc != null }
        else {
          const n = parseMoney(d.discount)
          if (n == null || n <= 0) { if (!error) { error = 'Скидочная цена должна быть больше нуля'; errorField = 'discount' } }
          else { nextDiscount = n; discountChanged = baseDisc == null || Math.abs(n - baseDisc) > 0.001 }
        }
      }

      if (!error && nextDiscount != null && nextDiscount >= nextPrice) {
        error = 'Скидочная цена должна быть меньше основной'
        errorField = 'both'
      }

      const dirty = priceChanged || discountChanged
      if (dirty || error) map.set(p.id, { priceChanged, discountChanged, nextPrice, nextDiscount, error, errorField, dirty })
    }
    return map
  }, [products, drafts])

  const productIdSet = useMemo(() => { const s = new Set<string>(); for (const p of products) s.add(p.id); return s }, [products])

  // ── Корзина: элементы батча по контракту (изменения + подтверждения) ──
  const cart = useMemo(() => {
    const items: BulkItem[] = []
    let errorCount = 0
    rowStates.forEach((st, id) => {
      if (st.error) { errorCount++; return }
      if (!st.dirty) return
      const it: BulkItem = { id }
      if (st.priceChanged) it.price = st.nextPrice
      if (st.discountChanged) it.discount_price = st.nextDiscount
      items.push(it)
    })
    confirms.forEach((id) => {
      if (!productIdSet.has(id)) return
      const st = rowStates.get(id)
      if (st && (st.dirty || st.error)) return // правка цены важнее голого подтверждения
      items.push({ id })
    })
    return { items, errorCount }
  }, [rowStates, confirms, productIdSet])

  useEffect(() => { onDirtyChange?.(cart.items.length) }, [cart.items.length, onDirtyChange])

  // ── Прогресс дня ── (по группам с хотя бы одной активной карточкой: скрытое не продаётся)
  const totalGroups = groups.length
  const sellableGroups = useMemo(() => groups.reduce((s, g) => s + (g.activeCount > 0 ? 1 : 0), 0), [groups])
  const confirmedToday = useMemo(() => groups.reduce((s, g) => s + (g.allToday ? 1 : 0), 0), [groups])
  const progressPct = sellableGroups ? Math.round((confirmedToday / sellableGroups) * 100) : 0

  // ── Фильтры и сортировка ──
  const filteredAll = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = groups
    if (categoryFilter !== 'all') list = list.filter((g) => g.categoryIds.has(categoryFilter))
    if (q) list = list.filter((g) => g.haystack.includes(q))
    const staleKey = (g: Group) => (g.hasNever ? -1 : g.minMs)
    return [...list].sort(sortMode === 'alpha'
      ? (a, b) => a.title.localeCompare(b.title, 'ru')
      : (a, b) => (staleKey(a) - staleKey(b)) || a.title.localeCompare(b.title, 'ru'))
  }, [groups, query, categoryFilter, sortMode])

  // В режиме «Только не обновлённые сегодня» полностью скрытые группы не показываем
  const filtered = useMemo(() => (staleOnly ? filteredAll.filter((g) => g.activeCount > 0 && !g.allToday) : filteredAll), [filteredAll, staleOnly])

  useEffect(() => { setVisibleCount(PAGE_STEP) }, [query, categoryFilter, staleOnly, sortMode])

  const visibleGroups = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length

  // Ленивая подгрузка групп по скроллу
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setVisibleCount((c) => c + PAGE_STEP)
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, visibleCount, filtered.length])

  const categoryChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of groups) g.categoryIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
    return categories.filter((c) => counts.has(c.id)).map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id)! }))
  }, [groups, categories])

  // ── Правки полей ──
  const setDraftField = useCallback((id: string, field: 'price' | 'discount', value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }, [])

  // Пустое поле цены на blur = «передумал» → возвращаем базовое значение
  const onPriceBlur = useCallback((id: string) => {
    setDrafts((prev) => {
      const d = prev[id]
      if (!d || d.price === undefined || d.price.trim() !== '') return prev
      const nd: RowDraft = { ...d }
      delete nd.price
      const next = { ...prev }
      if (nd.discount === undefined) delete next[id]
      else next[id] = nd
      return next
    })
  }, [])

  // Пустая скидка при базовой «нет скидки» — не правка, чистим черновик
  const onDiscountBlur = useCallback((id: string, baseHasDiscount: boolean) => {
    setDrafts((prev) => {
      const d = prev[id]
      if (!d || d.discount === undefined || d.discount.trim() !== '' || baseHasDiscount) return prev
      const nd: RowDraft = { ...d }
      delete nd.discount
      const next = { ...prev }
      if (nd.price === undefined) delete next[id]
      else next[id] = nd
      return next
    })
  }, [])

  // Enter/«Далее» — фокус на следующее поле цены (сквозь группы)
  const onMoneyKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const cur = e.currentTarget
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-price-nav="1"]'))
    const next = inputs.find((el) => el !== cur && !!(cur.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (next) { next.focus(); next.select() } else cur.blur()
  }, [])

  // «✓ Актуально»: активные карточки группы в корзину без изменения цен (бэк штампует дату);
  // скрытые не подтверждаем — их цену подтверждать не нужно
  const toggleConfirmGroup = useCallback((g: Group) => {
    if (g.activeIds.length === 0) return
    setConfirms((prev) => {
      const next = new Set(prev)
      const allIn = g.activeIds.every((id) => next.has(id))
      if (allIn) g.activeIds.forEach((id) => next.delete(id))
      else g.activeIds.forEach((id) => next.add(id))
      return next
    })
  }, [])

  // ── Видимость в каталоге (глаз) ──
  // PATCH /api/products/{id} строго с телом {is_active} — цену не трогаем.
  const togglingRef = useRef<Set<string>>(new Set())

  const setActiveLocal = useCallback((ids: string[], value: boolean) => {
    const idSet = new Set(ids)
    setProducts((prev) => prev.map((p) => (idSet.has(p.id) ? { ...p, is_active: value } : p)))
    // Скрытое не подтверждаем — выкидываем из корзины подтверждений
    if (!value) setConfirms((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  const patchActive = useCallback(async (id: string, value: boolean): Promise<'ok' | 'fail' | 'auth'> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/products/${id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: value }),
      })
      if (res.status === 401) { toast('Сессия истекла — войдите заново.', 'error'); logout(); return 'auth' }
      return res.ok ? 'ok' : 'fail'
    } catch { return 'fail' }
  }, [logout])

  const toggleRowActive = useCallback(async (p: PriceProduct) => {
    if (togglingRef.current.has(p.id)) return
    togglingRef.current.add(p.id)
    const next = !p.is_active
    setActiveLocal([p.id], next) // оптимистично
    try {
      const r = await patchActive(p.id, next)
      if (r !== 'ok') {
        setActiveLocal([p.id], p.is_active) // откат
        if (r === 'fail') toast(next ? 'Не удалось скрыть товар — попробуйте ещё раз.' : 'Не удалось показать товар — попробуйте ещё раз.', 'error')
      }
    } finally { togglingRef.current.delete(p.id) }
  }, [patchActive, setActiveLocal])

  // Глаз на группе: хоть одна активна → скрываем все, иначе показываем все
  const toggleGroupActive = useCallback(async (g: Group) => {
    const target = g.activeCount === 0
    const affected = g.rows.filter(({ p }) => p.is_active !== target).map(({ p }) => p.id)
    if (affected.length === 0) return
    if (affected.some((id) => togglingRef.current.has(id))) return
    affected.forEach((id) => togglingRef.current.add(id))
    setActiveLocal(affected, target) // оптимистично всей группой
    const done: string[] = []
    let auth = false
    try {
      for (const id of affected) {
        const r = await patchActive(id, target) // последовательно, по одному
        if (r === 'auth') { auth = true; break }
        if (r !== 'ok') break
        done.push(id)
      }
    } finally { affected.forEach((id) => togglingRef.current.delete(id)) }
    const failed = affected.filter((id) => !done.includes(id))
    if (failed.length > 0) {
      setActiveLocal(failed, !target) // откат непрошедших; успешные остаются
      if (!auth) toast(`Не удалось ${target ? 'показать' : 'скрыть'} ${failed.length} из ${affected.length} — попробуйте ещё раз.`, 'error')
    } else {
      toast(target
        ? `Показано ${done.length} ${pluralRu(done.length, 'карточка', 'карточки', 'карточек')}`
        : `Скрыто ${done.length} ${pluralRu(done.length, 'карточка', 'карточки', 'карточек')}`, 'success')
    }
  }, [patchActive, setActiveLocal])

  // Групповая операция ±% / ±₽ поверх текущих (в т.ч. уже правленных) цен
  const applyGroupAdjust = useCallback((g: Group, mode: AdjustMode, dir: 1 | -1, value: number) => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const { p } of g.rows) {
        const st = rowStates.get(p.id)
        const curPrice = st && !st.error ? st.nextPrice : Number(p.price)
        const curDisc = st && !st.error ? st.nextDiscount : (p.discount_price == null ? null : Number(p.discount_price))
        const newPrice = adjustValue(curPrice, mode, dir, value)
        const nd: RowDraft = { ...next[p.id], price: String(newPrice) }
        if (curDisc != null) {
          // Скидка меняется той же операцией (пропорционально для %, той же дельтой для ₽)
          let newDisc = adjustValue(curDisc, mode, dir, value)
          if (newDisc >= newPrice) newDisc = newPrice > 1 ? newPrice - 1 : 0
          nd.discount = newDisc > 0 ? String(newDisc) : ''
        }
        next[p.id] = nd
      }
      return next
    })
    toast(`Пересчитано карточек: ${g.rows.length}. Проверьте и сохраните.`, 'info')
  }, [rowStates])

  const adjustGroup = useMemo(() => (adjustGroupKey ? groups.find((g) => g.key === adjustGroupKey) ?? null : null), [adjustGroupKey, groups])
  const adjustPreview = useMemo(() => {
    if (!adjustGroup || adjustGroup.rows.length === 0) return null
    const p = adjustGroup.rows[0].p
    const st = rowStates.get(p.id)
    return {
      price: st && !st.error ? st.nextPrice : Number(p.price),
      discount: st && !st.error ? st.nextDiscount : (p.discount_price == null ? null : Number(p.discount_price)),
    }
  }, [adjustGroup, rowStates])

  // ── Сохранение батчем (чанки по 500), локальное применение по чанкам ──
  const applyChunkLocally = useCallback((chunk: BulkItem[], notFound: string[]) => {
    const nf = new Set(notFound)
    const byId = new Map(chunk.map((it) => [it.id, it]))
    const nowIso = new Date().toISOString()
    setProducts((prev) => prev.map((p) => {
      const it = byId.get(p.id)
      if (!it || nf.has(p.id)) return p
      return {
        ...p,
        price: it.price !== undefined ? it.price : p.price,
        discount_price: it.discount_price !== undefined ? it.discount_price : p.discount_price,
        price_updated_at: nowIso,
      }
    }))
    setDrafts((prev) => { const next = { ...prev }; for (const it of chunk) delete next[it.id]; return next })
    setConfirms((prev) => { const next = new Set(prev); for (const it of chunk) next.delete(it.id); return next })
  }, [])

  const save = useCallback(async () => {
    const { items, errorCount } = cart
    if (errorCount > 0) { toast('Исправьте подсвеченные поля — в ценах есть ошибки.', 'error'); return }
    if (items.length === 0 || saving) return
    setSaving(true)
    let savedTotal = 0
    let notFoundTotal = 0
    try {
      for (let i = 0; i < items.length; i += SAVE_CHUNK) {
        const chunk = items.slice(i, i + SAVE_CHUNK)
        const res = await fetch(`${API_BASE_URL}/api/products/prices/bulk`, {
          method: 'PATCH',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk }),
        })
        if (res.status === 401) { toast('Сессия истекла — войдите заново.', 'error'); logout(); return }
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { detail?: unknown } | null
          const detail = typeof d?.detail === 'string'
            ? d.detail
            : res.status === 422 ? 'сервер отклонил значения (скидка должна быть меньше цены)' : `HTTP ${res.status}`
          throw new Error(detail)
        }
        const d = await res.json().catch(() => ({})) as { updated?: number; not_found?: string[] }
        const nf = (d.not_found ?? []).map(String)
        savedTotal += Number(d.updated ?? 0)
        notFoundTotal += nf.length
        applyChunkLocally(chunk, nf)
      }
      toast(`✓ Сохранено: ${savedTotal} ${pluralRu(savedTotal, 'цена', 'цены', 'цен')}`, 'success')
      if (notFoundTotal > 0) toast(`Не найдено на сервере: ${notFoundTotal} — обновите каталог кнопкой ↻.`, 'error')
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : 'ошибка сети'
      toast(savedTotal > 0
        ? `Сохранено частично (${savedTotal}). Остальное в корзине. Причина: ${msg}`
        : `Не удалось сохранить: ${msg}`, 'error')
    } finally { setSaving(false) }
  }, [cart, saving, logout, applyChunkLocally])

  const resetAll = useCallback(() => {
    const n = cart.items.length + cart.errorCount
    if (n === 0) return
    if (!window.confirm(`Отменить несохранённые правки (${n})?`)) return
    setDrafts({})
    setConfirms(new Set())
  }, [cart.items.length, cart.errorCount])

  const resetFilters = useCallback(() => { setQuery(''); setCategoryFilter('all'); setStaleOnly(false) }, [])

  const chipCls = (active: boolean) =>
    `flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition active:scale-95 ${active ? 'bg-yellow-400 text-gray-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`

  const showSaveBar = cart.items.length > 0 || cart.errorCount > 0

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white">
      {/* Шапка с прогрессом дня */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl" style={SAFE_TOP}>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold leading-tight">Цены</div>
            <div className="truncate text-[11px] leading-tight text-slate-500">
              {loadState === 'loading' && products.length === 0
                ? 'загружаю каталог…'
                : <>Сегодня подтверждено <span className="font-semibold text-emerald-300">{confirmedToday}</span> из {sellableGroups} моделей</>}
            </div>
          </div>
          <button onClick={() => { if (!saving) void loadAll() }} aria-label="Обновить каталог"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70">
            <span className={loadState === 'loading' ? 'inline-block animate-spin' : ''}>↻</span>
          </button>
        </div>
        <div className="px-4 pb-2.5">
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pt-4">
        {loadState === 'loading' && (
          <div className="mb-3 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-slate-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
            Загружено {loadedCount}… каталог подтягивается в фоне
          </div>
        )}
        {loadState === 'error' && products.length > 0 && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-sm text-rose-300">
            <span>Каталог загружен не полностью.</span>
            <button onClick={() => void loadAll()} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15">Повторить</button>
          </div>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Поиск: модель, бренд, SKU"
          aria-label="Поиск по каталогу"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/50"
        />

        {/* Чипы категорий */}
        {categoryChips.length > 0 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button onClick={() => setCategoryFilter('all')} className={chipCls(categoryFilter === 'all')}>Все</button>
            {categoryChips.map((c) => (
              <button key={c.id} onClick={() => setCategoryFilter(categoryFilter === c.id ? 'all' : c.id)} className={chipCls(categoryFilter === c.id)}>
                {c.name}<span className={`text-xs ${categoryFilter === c.id ? 'text-gray-950/60' : 'text-slate-500'}`}>{c.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Режим дня + сортировка */}
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setStaleOnly((v) => !v)} aria-pressed={staleOnly}
            className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition active:scale-95 ${staleOnly ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-400/30' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            {staleOnly ? '✓ ' : ''}Только не обновлённые сегодня
          </button>
          <span className="my-1 w-px flex-shrink-0 bg-white/10" />
          <button onClick={() => setSortMode('stale')} className={chipCls(sortMode === 'stale')}>Давно не обновлялись</button>
          <button onClick={() => setSortMode('alpha')} className={chipCls(sortMode === 'alpha')}>По алфавиту</button>
        </div>
      </div>

      {/* Список групп */}
      <div className={`mx-auto max-w-xl space-y-3 px-4 pt-3 ${showSaveBar ? 'pb-44' : 'pb-8'}`}>
        {loadState === 'error' && products.length === 0 ? (
          <div className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.06] p-10 text-center">
            <div className="mb-3 text-5xl">📡</div>
            <div className="font-semibold text-white">Каталог не загрузился</div>
            <div className="mt-1 text-sm text-slate-400">Проверьте связь и попробуйте ещё раз</div>
            <button onClick={() => void loadAll()} className="mt-4 rounded-xl bg-yellow-400 px-5 py-2.5 text-sm font-semibold text-gray-950 transition active:scale-95 hover:bg-yellow-300">Повторить</button>
          </div>
        ) : loadState === 'loading' && products.length === 0 ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
        ) : totalGroups === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-14 text-center">
            <div className="mb-3 text-5xl">📭</div>
            <div className="font-semibold text-white">Каталог пуст</div>
          </div>
        ) : filtered.length === 0 ? (
          staleOnly && filteredAll.length > 0 ? (
            <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.06] p-10 text-center">
              <div className="mb-3 text-5xl">🎉</div>
              <div className="font-semibold text-white">Все цены подтверждены сегодня</div>
              <div className="mt-1 text-sm text-slate-400">По текущему фильтру не осталось необновлённых моделей</div>
              <button onClick={() => setStaleOnly(false)} className="mt-4 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition active:scale-95 hover:bg-white/15">Показать все</button>
            </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-14 text-center">
              <div className="mb-3 text-5xl">🔍</div>
              <div className="font-semibold text-white">Ничего не найдено</div>
              <button onClick={resetFilters} className="mt-4 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition active:scale-95 hover:bg-white/15">Сбросить фильтры</button>
            </div>
          )
        ) : (
          <>
            {visibleGroups.map((g) => {
              const fresh = groupFreshness(g)
              const confirmedAll = g.activeCount > 0 && g.activeIds.every((id) => confirms.has(id))
              return (
                <section key={g.key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  {/* Шапка группы */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-white">{g.title}</h3>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {[g.brand, g.categoryName, `${g.rows.length} ${pluralRu(g.rows.length, 'карточка', 'карточки', 'карточек')}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {g.activeCount === 0 ? (
                        <span title="Все карточки группы скрыты из каталога" className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-400">скрыта</span>
                      ) : (
                        <>
                          {g.hiddenCount > 0 && (
                            <span title={`Скрыто из каталога: ${g.hiddenCount}`} className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-400">скрыто {g.hiddenCount}</span>
                          )}
                          <span title={fresh.title} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${fresh.pill}`}>{fresh.label}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Действия группы */}
                  <div className="mt-2.5 flex gap-2">
                    <button onClick={() => toggleConfirmGroup(g)} disabled={g.activeCount === 0}
                      className={`flex-1 rounded-xl py-2 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 ${confirmedAll ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-inset ring-emerald-400/40' : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'}`}>
                      {confirmedAll ? '✓ Будет подтверждено' : '✓ Актуально'}
                    </button>
                    <button onClick={() => setAdjustGroupKey(g.key)} aria-label={`Изменить цены группы ${g.title} на процент или сумму`}
                      className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10 active:scale-[0.98]">±%</button>
                    <button onClick={() => void toggleGroupActive(g)}
                      aria-label={g.activeCount > 0 ? `Скрыть все карточки группы ${g.title} из каталога` : `Показать все карточки группы ${g.title} в каталоге`}
                      title={g.activeCount > 0 ? 'Скрыть всю группу из каталога' : 'Показать всю группу в каталоге'}
                      className="flex items-center justify-center rounded-xl bg-white/5 px-3 py-2 text-slate-300 transition hover:bg-white/10 active:scale-[0.98]">
                      <EyeIcon off={g.activeCount === 0} />
                    </button>
                  </div>

                  {/* Колонки (хвостовой спейсер w-7 — под кнопку-глаз в строках) */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1" />
                    <span className="w-[104px] text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Цена ₽</span>
                    <span className="w-[80px] text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Скидка</span>
                    <span className="w-7 flex-shrink-0" />
                  </div>

                  {/* Карточки-варианты */}
                  <div className="divide-y divide-white/5">
                    {g.rows.map(({ p, main, config, full }) => {
                      const st = rowStates.get(p.id)
                      const rowFresh = freshnessOf(p.price_updated_at)
                      const d = drafts[p.id]
                      const priceVal = d?.price ?? moneyToInput(p.price)
                      const discVal = d?.discount ?? (p.discount_price == null ? '' : moneyToInput(p.discount_price))
                      const confirmedRow = confirms.has(p.id) && !st?.dirty
                      const priceErr = st?.errorField === 'price' || st?.errorField === 'both'
                      const discErr = st?.errorField === 'discount' || st?.errorField === 'both'
                      const rowName = config ? `${main}, ${config}` : main
                      const dim = p.is_active ? '' : 'opacity-50'
                      return (
                        <div key={p.id} className="py-2">
                          <div className="flex items-start gap-2">
                            <div className={`min-w-0 flex-1 ${dim}`}>
                              <div className="flex min-w-0 items-start gap-1.5">
                                <span title={rowFresh.title} className={`mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${rowFresh.dot}`} />
                                <span className="min-w-0 break-words text-sm text-white">{main}</span>
                                {confirmedRow && <span title="Будет подтверждена без изменения цены" className="flex-shrink-0 text-[11px] text-emerald-300">✓</span>}
                              </div>
                              {/* Бейдж «Скрыт» отдельной строкой — иначе он сжимает подпись цвета до переносов по буквам */}
                              {!p.is_active && (
                                <div className="mt-0.5 pl-3">
                                  <span className="rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-400">Скрыт из каталога</span>
                                </div>
                              )}
                              {config && (
                                <div title={full} className="mt-0.5 truncate pl-3 text-[11px] text-slate-400">{config}</div>
                              )}
                              {(st?.priceChanged || p.sku) && (
                                <div className="mt-0.5 truncate pl-3 text-[11px] text-slate-500">
                                  {st?.priceChanged
                                    ? <><span className="line-through">{fmtRub(Number(p.price))}</span> → <span className="text-yellow-300">{fmtRub(st.nextPrice)}</span></>
                                    : p.sku}
                                </div>
                              )}
                            </div>
                            <input
                              value={priceVal}
                              onChange={(e) => setDraftField(p.id, 'price', e.target.value)}
                              onBlur={() => onPriceBlur(p.id)}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={onMoneyKeyDown}
                              inputMode="decimal"
                              enterKeyHint="next"
                              data-price-nav="1"
                              aria-label={`Цена: ${g.title}, ${rowName}`}
                              className={`w-[104px] flex-shrink-0 rounded-xl border px-2.5 py-2.5 text-right text-[15px] font-bold text-white outline-none transition ${dim} ${priceErr ? 'border-rose-500/70 bg-rose-500/10' : st?.priceChanged ? 'border-yellow-400/60 bg-yellow-400/10' : 'border-white/10 bg-white/5 focus:border-yellow-400/60'}`}
                            />
                            <input
                              value={discVal}
                              onChange={(e) => setDraftField(p.id, 'discount', e.target.value)}
                              onBlur={() => onDiscountBlur(p.id, p.discount_price != null)}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={onMoneyKeyDown}
                              inputMode="decimal"
                              enterKeyHint="next"
                              placeholder="—"
                              aria-label={`Скидочная цена: ${g.title}, ${rowName}`}
                              className={`w-[80px] flex-shrink-0 rounded-xl border px-2 py-2.5 text-right text-[13px] font-semibold text-white placeholder-slate-600 outline-none transition ${dim} ${discErr ? 'border-rose-500/70 bg-rose-500/10' : st?.discountChanged ? 'border-yellow-400/60 bg-yellow-400/10' : 'border-white/10 bg-white/5 focus:border-yellow-400/60'}`}
                            />
                            <button
                              onClick={() => void toggleRowActive(p)}
                              aria-label={p.is_active ? `Скрыть из каталога: ${rowName}` : `Показать в каталоге: ${rowName}`}
                              title={p.is_active ? 'Скрыть из каталога' : 'Показать в каталоге'}
                              className={`flex h-11 w-7 flex-shrink-0 items-center justify-center rounded-lg transition active:scale-95 hover:bg-white/5 ${p.is_active ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-white'}`}>
                              <EyeIcon off={!p.is_active} />
                            </button>
                          </div>
                          {st?.error && <div className="mt-1 text-right text-[11px] text-rose-400">{st.error}</div>}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            {hasMore && (
              <div ref={sentinelRef} className="pt-1">
                <button onClick={() => setVisibleCount((c) => c + PAGE_STEP)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 text-sm font-medium text-slate-400 transition active:scale-[0.99] hover:bg-white/[0.06]">
                  Показать ещё ({filtered.length - visibleCount})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky-корзина изменений (над таб-баром) */}
      {showSaveBar && (
        <div className="fixed inset-x-0 z-30 px-4" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom) + 10px)' }}>
          <div className="mx-auto max-w-xl rounded-2xl border border-yellow-400/30 bg-slate-900/95 p-2.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
            {cart.errorCount > 0 && (
              <div className="mb-2 px-1 text-[11px] text-rose-300">⚠ Ошибки в полях: {cart.errorCount} — эти карточки не сохранятся, исправьте подсвеченные.</div>
            )}
            <div className="flex gap-2">
              <button onClick={resetAll} disabled={saving}
                className="rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-slate-200 transition active:scale-[0.98] hover:bg-white/15 disabled:opacity-40">
                Сбросить
              </button>
              <button onClick={() => void save()} disabled={saving || cart.errorCount > 0 || cart.items.length === 0}
                className="flex-1 rounded-xl bg-yellow-400 py-3 font-semibold text-gray-950 shadow-lg shadow-yellow-400/20 transition active:scale-[0.98] hover:bg-yellow-300 disabled:opacity-40">
                {saving ? 'Сохраняю…' : `💾 Сохранить ${cart.items.length} ${pluralRu(cart.items.length, 'цену', 'цены', 'цен')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustGroup && (
        <GroupAdjustSheet
          group={adjustGroup}
          preview={adjustPreview}
          onClose={() => setAdjustGroupKey(null)}
          onApply={(mode, dir, value) => { applyGroupAdjust(adjustGroup, mode, dir, value); setAdjustGroupKey(null) }}
        />
      )}

      <ToastHost />
    </div>
  )
}
