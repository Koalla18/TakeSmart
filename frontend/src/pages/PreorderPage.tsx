import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import { ArrowRightIcon } from '../components/ui/Icons'
import { API_BASE_URL } from '../lib/config'
import { fetchPreorderProducts } from '../lib/preorder'
import { mapApiProduct, type Product } from '../data/products'

// ─────────────────────────────────────────────────────────────────────────────
// /preorder — витрина новинок, которые можно заказать до поступления.
// Данные: GET /api/products/preorder (порядок с бэка: ближайшая дата первой,
// без даты — в конце). Группируем по подписи срока — «Ожидается 26 сентября»
// становится заголовком блока, а не повторяется на каждой карточке в одиночку.
// ─────────────────────────────────────────────────────────────────────────────

interface ApiCategory { id: string; name: string; slug: string }

type SortMode = 'soonest' | 'price_asc' | 'price_desc'

const STEPS = [
  { n: '01', title: 'Оформляете предзаказ', text: 'Как обычный заказ: кладёте товар в корзину и оставляете контакты. Предоплата не требуется.' },
  { n: '02', title: 'Менеджер подтверждает', text: 'Свяжемся, уточним комплектацию, цвет и способ получения — и закрепим товар за вами.' },
  { n: '03', title: 'Сообщаем о поступлении', text: 'Как только устройство приедет, напишем вам первыми — заберёте в магазине или получите доставкой.' },
]

export function PreorderPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ApiCategory[]>([])
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
      fetchPreorderProducts(),
      fetch(`${API_BASE_URL}/api/categories?limit=100`)
        .then(res => (res.ok ? res.json() : []))
        .then((data: { items?: ApiCategory[] } | ApiCategory[]) => (Array.isArray(data) ? data : data.items ?? []))
        .catch(() => [] as ApiCategory[]),
    ]).then(([items, cats]) => {
      if (cancelled) return
      const catMap = new Map(cats.map(c => [c.id, c]))
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero */}
      <Section bg="dark" py="xl" className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <Container>
          <div className="relative mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
              Новинки по предзаказу
            </div>
            <h1 className="mb-5 text-4xl font-bold text-white sm:text-5xl lg:text-6xl">
              Успейте заказать <span className="bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">первыми</span>
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-gray-400 sm:text-xl">
              Новые устройства уже можно оформить до старта продаж. Без предоплаты — закрепим товар за вами и сообщим о поступлении.
            </p>
          </div>
        </Container>
      </Section>

      {/* Как это работает */}
      <Section py="sm" className="bg-transparent">
        <Container>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map(step => (
              <div key={step.n} className="flex gap-4 rounded-2xl bg-white p-5 shadow-lg shadow-gray-200/60 ring-1 ring-gray-100">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-violet-600 font-mono text-sm font-bold text-white">
                  {step.n}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{step.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-gray-500">{step.text}</div>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Товары */}
      <Section py="md" className="bg-transparent">
        <Container>
          {usedCategories.length > 1 && (
            <div className="mb-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCategoryFilter(null)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  categoryFilter === null ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
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
                    categoryFilter === cat.slug ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">Доступно по предзаказу</h2>
              {!loading && (
                <p className="mt-1 text-gray-500">
                  {visible.length} {visible.length % 10 === 1 && visible.length % 100 !== 11 ? 'товар' : visible.length % 10 >= 2 && visible.length % 10 <= 4 && (visible.length % 100 < 10 || visible.length % 100 >= 20) ? 'товара' : 'товаров'}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-500">
              Сортировать:
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortMode)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="soonest">Ближайшие поступления</option>
                <option value="price_asc">Сначала дешевле</option>
                <option value="price_desc">Сначала дороже</option>
              </select>
            </label>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-3xl bg-white p-12 text-center shadow-lg ring-1 ring-gray-100">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 text-3xl">🚀</div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900">Пока нет новинок по предзаказу</h3>
              <p className="mb-6 text-gray-500">Мы открываем предзаказ сразу после презентаций — загляните позже или посмотрите каталог.</p>
              <Button to="/catalog">Перейти в каталог</Button>
            </div>
          ) : (
            <div className="space-y-10">
              {groups.map(group => (
                <div key={group.label || 'all'}>
                  {group.label && (
                    <div className="mb-4 flex items-center gap-3">
                      <span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-sm font-semibold text-violet-700 ring-1 ring-violet-100">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {group.label}
                      </span>
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
        </Container>
      </Section>

      {/* CTA */}
      <Section bg="dark" py="lg">
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
              <Link to="/catalog" className="inline-flex items-center gap-2 rounded-xl border-2 border-white/20 px-8 py-4 font-semibold text-white transition-all hover:border-white/40 hover:bg-white/10">
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
