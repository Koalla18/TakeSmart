import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import { ArrowRightIcon, ClockIcon, PhoneIcon, SearchIcon, ShieldCheckIcon, TruckIcon } from '../components/ui/Icons'
import { API_BASE_URL } from '../lib/config'
import { fetchPreorderSettings, fetchPreorderProducts } from '../lib/preorder'
import { mapApiProduct, type ApiProductOut, type Product } from '../data/products'
import { rankSearch } from '../lib/searchRank'

// ─────────────────────────────────────────────────────────────────────────────
// /preorder — раздел новинок до старта продаж. Чтобы не листать всю сетку,
// три уровня навигации: вкладки категорий со счётчиками → чипы МОДЕЛЕЙ
// (собираются автоматически: карточки одной группы — 4 цвета iPhone —
// схлопываются в один чип по общему началу названия) → поиск по названию.
// ─────────────────────────────────────────────────────────────────────────────

interface ApiCategory { id: string; name: string; slug: string }

type SortMode = 'soonest' | 'price_asc' | 'price_desc'

const BENEFITS = [
  { icon: <ClockIcon className="h-6 w-6" />, title: 'Первыми в очереди', desc: 'Заказ до старта продаж' },
  { icon: <ShieldCheckIcon className="h-6 w-6" />, title: 'Товар закрепим за вами', desc: 'Бронь до поступления' },
  { icon: <PhoneIcon className="h-6 w-6" />, title: 'Менеджер подтвердит', desc: 'Уточним цвет и комплектацию' },
  { icon: <TruckIcon className="h-6 w-6" />, title: 'Сообщим о поступлении', desc: 'Самовывоз или доставка' },
]

function pluralProducts(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'товар'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'товара'
  return 'товаров'
}

// ── Чипы моделей ─────────────────────────────────────────────────────────────

/** Тип товара в начале названия — в чипе он лишний («Смартфон Apple…» → «Apple…») */
const MODEL_TYPE_PREFIX = /^(смартфон|умные часы|смарт-часы|часы|беспроводные наушники|наушники|ноутбук|планшет|телевизор|игровая консоль|игровая приставка|приставка|умная колонка|колонка|пылесос|стайлер|фен|электросамокат|фотоаппарат|видеокамера|экшн-камера)[\s-]+/i

function stripModelCode(name: string): string {
  return name.replace(/\s*\([A-Z][A-Z0-9/-]{2,}\)$/, '').trim()
}

function cleanChipLabel(raw: string): string {
  let t = raw.trim().replace(MODEL_TYPE_PREFIX, '')
  // оборванная общим префиксом скобка: «… Белый (Wh» → «… Белый»
  const open = t.lastIndexOf('(')
  if (open !== -1 && !t.includes(')', open)) t = t.slice(0, open)
  return t.replace(/[\s,;:·—–-]+$/g, '').trim()
}

/** Общее начало названий группы, обрезанное до целого слова */
function commonPrefixOf(names: string[]): string {
  if (names.length === 0) return ''
  let prefix = names[0]
  for (const name of names.slice(1)) {
    let i = 0
    while (i < prefix.length && i < name.length && prefix[i].toLowerCase() === name[i].toLowerCase()) i++
    prefix = prefix.slice(0, i)
  }
  // если хоть одно имя длиннее префикса — не рвём слово посередине
  if (names.some(name => name.length > prefix.length)) {
    const cut = prefix.lastIndexOf(' ')
    if (cut > 0) prefix = prefix.slice(0, cut)
  }
  return prefix
}

/** Подпись одиночной карточки: до первой запятой, без кода и хвостовой скобки */
function soloChipLabel(name: string): string {
  const base = stripModelCode(name).split(',')[0].replace(/\s*\([^)]*\)\s*$/, '')
  return cleanChipLabel(base)
}

export interface ModelChip {
  key: string
  label: string
  count: number
  categorySlug: string
  productIds: Set<string>
}

/** Группировка предзаказа в чипы моделей: по group_id, одиночки — сами по себе */
function buildModelChips(items: ApiProductOut[], slugByCategoryId: Map<string, string>): { chips: ModelChip[]; chipKeyByProductId: Map<string, string> } {
  const byGroup = new Map<string, ApiProductOut[]>()
  for (const p of items) {
    const key = p.group_id || `solo-${p.id}`
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(p)
  }
  // Чипы с одинаковой подписью сливаются (две «одиночки» одной модели)
  const byLabel = new Map<string, ModelChip>()
  const chipKeyByProductId = new Map<string, string>()
  for (const [key, members] of byGroup) {
    let label = members.length > 1
      ? cleanChipLabel(commonPrefixOf(members.map(m => stripModelCode(m.name))))
      : soloChipLabel(members[0].name)
    if (label.length < 4) label = soloChipLabel(members[0].name) || stripModelCode(members[0].name)
    const existing = byLabel.get(label.toLowerCase())
    const chip: ModelChip = existing ?? {
      key,
      label,
      count: 0,
      categorySlug: slugByCategoryId.get(members[0].category_id || '') ?? '',
      productIds: new Set<string>(),
    }
    for (const m of members) { chip.productIds.add(m.id); chipKeyByProductId.set(m.id, chip.key) }
    chip.count = chip.productIds.size
    if (!existing) byLabel.set(label.toLowerCase(), chip)
  }
  const chips = [...byLabel.values()].sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, 'ru'))
  return { chips, chipKeyByProductId }
}

export function PreorderPage() {
  const [rawItems, setRawItems] = useState<ApiProductOut[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('soonest')

  useEffect(() => {
    const prev = document.title
    document.title = 'Предзаказ новинок — TakeSmart'
    return () => { document.title = prev || 'TakeSmart' }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchPreorderSettings(),
      fetchPreorderProducts(),
      fetch(`${API_BASE_URL}/api/categories?limit=100`)
        .then(res => (res.ok ? res.json() : []))
        .then((data: { items?: ApiCategory[] } | ApiCategory[]) => (Array.isArray(data) ? data : data.items ?? []))
        .catch(() => [] as ApiCategory[]),
    ]).then(([settings, items, cats]) => {
      if (cancelled) return
      const catMap = new Map(cats.map(c => [c.id, c]))
      setEnabled(settings.preorder_section_enabled)
      setCategories(cats)
      setRawItems(items)
      setProducts(items.map(p => {
        const cat = p.category_id ? catMap.get(p.category_id) : undefined
        return mapApiProduct(p, cat?.slug ?? '', cat?.name ?? '')
      }))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Категории — только те, в которых есть предзаказы (со счётчиками)
  const usedCategories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of products) if (p.categorySlug) counts.set(p.categorySlug, (counts.get(p.categorySlug) ?? 0) + 1)
    return categories.filter(c => counts.has(c.slug)).map(c => ({ ...c, count: counts.get(c.slug)! }))
  }, [products, categories])

  // Чипы моделей: карточки одной группы (цвета/память) — один чип
  const modelIndex = useMemo(() => {
    const slugByCategoryId = new Map(categories.map(c => [c.id, c.slug]))
    return buildModelChips(rawItems, slugByCategoryId)
  }, [rawItems, categories])

  const modelChips = useMemo(
    () => (categoryFilter ? modelIndex.chips.filter(chip => chip.categorySlug === categoryFilter) : modelIndex.chips),
    [modelIndex, categoryFilter],
  )

  const activeChip = modelFilter ? modelIndex.chips.find(chip => chip.key === modelFilter) ?? null : null

  const visible = useMemo(() => {
    let list = categoryFilter ? products.filter(p => p.categorySlug === categoryFilter) : [...products]
    if (activeChip) list = list.filter(p => activeChip.productIds.has(p.id))
    if (query.trim()) list = rankSearch(list, query, p => `${p.name} ${p.brand}`)
    if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price)
    else if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price)
    return list
  }, [products, categoryFilter, activeChip, query, sort])

  // Группы по подписи срока (порядок групп = порядок первого появления, т.е. с бэка)
  const groups = useMemo(() => {
    if (sort !== 'soonest') return [{ label: '', items: visible }]
    const order: string[] = []
    const byLabel = new Map<string, Product[]>()
    for (const p of visible) {
      const label = p.preorderNote || 'Скоро в продаже'
      if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label) }
      byLabel.get(label)!.push(p)
    }
    return order.map(label => ({ label, items: byLabel.get(label)! }))
  }, [visible, sort])

  const hasFilters = Boolean(categoryFilter || modelFilter || query)
  const resetFilters = () => { setCategoryFilter(null); setModelFilter(null); setQuery('') }
  const closed = !loading && (!enabled || products.length === 0)

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero */}
      <Section className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-24">
        <Container>
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-yellow-400/15 px-4 py-2 text-yellow-300">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
              Новинки до старта продаж
            </div>
            <h1 className="mb-6 text-5xl font-bold text-white lg:text-6xl">
              Предзаказ <span className="text-yellow-400">новинок</span>
            </h1>
            <p className="text-xl text-gray-400">
              Оформите заказ до старта продаж — закрепим устройство за вами и сообщим о поступлении первыми
            </p>
          </div>
        </Container>
      </Section>

      {/* Преимущества */}
      <Section py="sm" className="bg-transparent">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 md:gap-6">
            {BENEFITS.map(item => (
              <div key={item.title} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-lg">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-yellow-400 text-gray-900">
                  {item.icon}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{item.title}</div>
                  <div className="text-sm text-gray-500">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Товары */}
      <Section py="md" className="bg-transparent">
        <Container>
          {closed ? (
            <div className="rounded-3xl bg-white p-12 text-center shadow-lg">
              <h3 className="mb-2 text-xl font-semibold text-gray-900">
                {enabled ? 'Пока нет новинок по предзаказу' : 'Приём предзаказов сейчас закрыт'}
              </h3>
              <p className="mb-6 text-gray-500">
                Мы открываем предзаказ сразу после презентаций новинок.
                <br />Загляните позже или посмотрите, что уже есть в наличии.
              </p>
              <Button to="/catalog">Перейти в каталог</Button>
            </div>
          ) : (
            <>
              {/* Категории */}
              {usedCategories.length > 1 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { setCategoryFilter(null); setModelFilter(null) }}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      categoryFilter === null ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Все новинки <span className={categoryFilter === null ? 'text-gray-700' : 'text-gray-400'}>{products.length}</span>
                  </button>
                  {usedCategories.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => { setCategoryFilter(cat.slug); setModelFilter(null) }}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        categoryFilter === cat.slug ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat.name} <span className={categoryFilter === cat.slug ? 'text-gray-700' : 'text-gray-400'}>{cat.count}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Модели: группа карточек (цвета/память) = один чип */}
              {modelChips.length > 1 && (
                <div className="mb-5 rounded-2xl bg-white p-3 shadow-sm sm:p-4" data-preorder-models>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Модель</div>
                  <div className="flex flex-wrap gap-2">
                    {modelChips.map(chip => {
                      const active = modelFilter === chip.key
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={() => setModelFilter(active ? null : chip.key)}
                          data-model-chip={chip.key}
                          data-model-count={chip.count}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                            active ? 'bg-gray-900 text-white shadow-sm' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300'
                          }`}
                        >
                          {chip.label}
                          {chip.count > 1 && <span className={`ml-1.5 text-xs ${active ? 'text-gray-400' : 'text-gray-400'}`}>{chip.count}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Заголовок + поиск + сортировка */}
              <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {activeChip ? activeChip.label : 'Доступно по предзаказу'}
                  </h2>
                  {!loading && (
                    <p className="text-gray-500">
                      {visible.length} {pluralProducts(visible.length)}
                      {hasFilters && (
                        <button type="button" onClick={resetFilters} className="ml-3 text-sm font-medium text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline">
                          Сбросить фильтры
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Поиск по новинкам"
                      data-preorder-search
                      className="w-52 rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 sm:w-64"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="hidden sm:inline">Сортировать:</span>
                    <select
                      value={sort}
                      onChange={e => setSort(e.target.value as SortMode)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="soonest">Ближайшие поступления</option>
                      <option value="price_asc">Сначала дешевле</option>
                      <option value="price_desc">Сначала дороже</option>
                    </select>
                  </label>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
                </div>
              ) : visible.length === 0 ? (
                <div className="rounded-3xl bg-white p-12 text-center shadow-lg" data-preorder-empty>
                  <h3 className="mb-2 text-xl font-semibold text-gray-900">По этим фильтрам ничего нет</h3>
                  <p className="mb-6 text-gray-500">Попробуйте другую модель или сбросьте фильтры.</p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-xl bg-yellow-400 px-6 py-3 font-semibold text-gray-900 transition-colors hover:bg-yellow-300"
                  >
                    Показать все новинки
                  </button>
                </div>
              ) : (
                <div className="space-y-10">
                  {groups.map(group => (
                    <div key={group.label || 'all'}>
                      {group.label && (
                        <div className="mb-4 flex items-center gap-3">
                          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">{group.label}</h3>
                          <span className="h-px flex-1 bg-gray-200" />
                          <span className="text-sm text-gray-400">{group.items.length}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
                        {group.items.map(product => <ProductCard key={product.id} product={product} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Container>
      </Section>

      {/* CTA */}
      <Section className="bg-gray-900 py-16">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-white">Нужна модель, которой здесь нет?</h2>
            <p className="mb-8 text-gray-400">
              Позвоните — подскажем сроки поступления и оформим предзаказ вручную
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a href="tel:+79998021022" className="rounded-xl bg-yellow-400 px-8 py-4 font-semibold text-gray-900 transition-colors hover:bg-yellow-300">
                📞 +7 (999) 802-10-22
              </a>
              <Link to="/catalog" className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-yellow-400 px-8 py-4 text-lg font-semibold text-yellow-400 transition-all duration-200 hover:bg-yellow-400 hover:text-gray-900">
                Весь каталог
                <ArrowRightIcon className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </Container>
      </Section>
    </div>
  )
}
