import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import { ArrowRightIcon, ClockIcon, PhoneIcon, ShieldCheckIcon, TruckIcon } from '../components/ui/Icons'
import { API_BASE_URL } from '../lib/config'
import { fetchPreorderSettings, fetchPreorderProducts } from '../lib/preorder'
import { mapApiProduct, type Product } from '../data/products'

// ─────────────────────────────────────────────────────────────────────────────
// /preorder — раздел новинок до старта продаж. Собран по образцу страницы Б/У:
// тёмный hero с жёлтым словом, ряд преимуществ, чипы категорий, сетка карточек.
// Товары приходят с бэка уже отсортированными (ближайшая дата первой), здесь
// они группируются по подписи срока: «Старт продаж 26 сентября» становится
// заголовком блока.
// ─────────────────────────────────────────────────────────────────────────────

interface ApiCategory { id: string; name: string; slug: string }

type SortMode = 'soonest' | 'price_asc' | 'price_desc'

const BENEFITS = [
  { icon: <ClockIcon className="h-6 w-6" />, title: 'Первыми в очереди', desc: 'Заказ до старта продаж' },
  { icon: <ShieldCheckIcon className="h-6 w-6" />, title: 'Без предоплаты', desc: 'Оплата при получении' },
  { icon: <PhoneIcon className="h-6 w-6" />, title: 'Менеджер подтвердит', desc: 'Уточним цвет и комплектацию' },
  { icon: <TruckIcon className="h-6 w-6" />, title: 'Сообщим о поступлении', desc: 'Самовывоз или доставка' },
]

function pluralProducts(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'товар'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'товара'
  return 'товаров'
}

export function PreorderPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
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
      setProducts(items.map(p => {
        const cat = p.category_id ? catMap.get(p.category_id) : undefined
        return mapApiProduct(p, cat?.slug ?? '', cat?.name ?? '')
      }))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Категории — только те, в которых есть предзаказы
  const usedCategories = useMemo(() => {
    const slugs = new Set(products.map(p => p.categorySlug).filter(Boolean))
    return categories.filter(c => slugs.has(c.slug))
  }, [products, categories])

  const visible = useMemo(() => {
    let list = categoryFilter ? products.filter(p => p.categorySlug === categoryFilter) : [...products]
    if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price)
    else if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price)
    return list
  }, [products, categoryFilter, sort])

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
              {usedCategories.length > 1 && (
                <div className="mb-8 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(null)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      categoryFilter === null ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Все новинки
                  </button>
                  {usedCategories.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoryFilter(cat.slug)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        categoryFilter === cat.slug ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Доступно по предзаказу</h2>
                  {!loading && <p className="text-gray-500">{visible.length} {pluralProducts(visible.length)}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Сортировать:</span>
                  <select
                    value={sort}
                    onChange={e => setSort(e.target.value as SortMode)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    <option value="soonest">Ближайшие поступления</option>
                    <option value="price_asc">Сначала дешевле</option>
                    <option value="price_desc">Сначала дороже</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
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
