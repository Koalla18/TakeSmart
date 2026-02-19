import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { useCart } from '../lib/cart'
import { API_BASE_URL } from '../lib/config'
import type { Product as CartProduct } from '../data/products'

interface ApiProduct {
  id: number
  name: string
  slug: string
  brand: string
  price: number
  old_price?: number
  badge?: string
  in_stock: boolean
  is_used: boolean
  image: string
  images?: string[]
  description: string
  specs: Array<{label?: string; key?: string; value: string}>
  category_id?: number
}

export function UsedPage() {
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'price_asc' | 'price_desc' | 'name'>('name')
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [categories, setCategories] = useState<{id: number; name: string; icon?: string}[]>([])
  const { addItem } = useCart()

  useEffect(() => {
    fetchUsedProducts()
    fetchCategories()
  }, [])

  async function fetchUsedProducts() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/products?is_used=true`)
      if (res.ok) {
        const data = await res.json()
        console.log('Used products:', data)
        setProducts(data)
      }
    } catch (err) {
      console.error('Error fetching used products:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchCategories() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/categories`)
      if (res.ok) {
        setCategories(await res.json())
      }
    } catch (err) {
      console.error('Error fetching categories:', err)
    }
  }

  const filteredProducts = products.filter(p => 
    categoryFilter === null || p.category_id === categoryFilter
  )

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === 'price_asc') return a.price - b.price
    if (sortBy === 'price_desc') return b.price - a.price
    return a.name.localeCompare(b.name)
  })

  // Get unique categories that have used products
  const usedCategories = categories.filter(cat => 
    products.some(p => p.category_id === cat.id)
  )

  function handleAddToCart(product: ApiProduct) {
    const cartProduct: CartProduct = {
      id: String(product.id),
      slug: product.slug || String(product.id),
      name: product.name,
      brand: product.brand || '',
      category: 'Б/У техника',
      categorySlug: 'used',
      price: product.price,
      oldPrice: product.old_price,
      badge: product.badge as CartProduct['badge'],
      inStock: product.in_stock,
      image: product.images?.[0] || product.image || '📦',
      description: product.description || '',
      specs: product.specs?.map(s => ({ label: s.label || s.key || '', value: s.value })) || []
    }
    addItem(cartProduct)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero */}
      <Section className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-24">
        <Container>
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-4 inline-flex items-center rounded-full bg-orange-500/20 px-4 py-2 text-orange-300">
              <span className="mr-2">🔥</span>
              Проверено и гарантировано
            </div>
            <h1 className="mb-6 text-5xl font-bold text-white lg:text-6xl">
              Б/У <span className="text-yellow-400">техника</span>
            </h1>
            <p className="text-xl text-gray-400">
              Качественная техника с гарантией по выгодным ценам
            </p>
          </div>
        </Container>
      </Section>

      {/* Benefits */}
      <Section className="py-12">
        <Container>
          <div className="grid gap-6 md:grid-cols-4">
            {[
              { icon: '✅', title: 'Проверено', desc: 'Полная диагностика' },
              { icon: '🔒', title: 'Гарантия', desc: 'До 12 месяцев' },
              { icon: '💰', title: 'Выгода', desc: 'До 50% экономии' },
              { icon: '📦', title: 'Доставка', desc: 'По всей России' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-2xl">
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

      {/* Products */}
      <Section className="pb-24">
        <Container>
          {/* Category Filter */}
          {usedCategories.length > 0 && (
            <div className="mb-8 flex flex-wrap gap-2">
              <button
                onClick={() => setCategoryFilter(null)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  categoryFilter === null
                    ? 'bg-yellow-400 text-gray-900'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Все категории
              </button>
              {usedCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    categoryFilter === cat.id
                      ? 'bg-yellow-400 text-gray-900'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* Header */}
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Товары в наличии</h2>
              <p className="text-gray-500">{filteredProducts.length} товаров</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Сортировать:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="name">По названию</option>
                <option value="price_asc">Сначала дешевле</option>
                <option value="price_desc">Сначала дороже</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent"></div>
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="rounded-3xl bg-white p-12 text-center shadow-lg">
              <div className="mx-auto mb-4 h-24 w-24 text-6xl">📦</div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900">Пока нет товаров</h3>
              <p className="mb-6 text-gray-500">
                Б/У техника появится в ближайшее время. 
                <br />Следите за обновлениями!
              </p>
              <Button to="/catalog">Перейти в каталог</Button>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedProducts.map((product) => {
                const imgSrc = product.images?.[0] || product.image
                const displayImage = imgSrc?.startsWith('/uploads') 
                  ? `${API_BASE_URL}${imgSrc}` 
                  : imgSrc || 'https://placehold.co/400x400/f3f4f6/9ca3af?text=Фото'
                return (
                <div 
                  key={product.id} 
                  className="group rounded-3xl bg-white p-4 shadow-lg transition-all hover:shadow-2xl"
                >
                  {/* Image - clickable */}
                  <Link to={`/used/${product.slug}`} className="relative mb-4 block aspect-square overflow-hidden rounded-2xl bg-gray-100">
                    <img
                      src={displayImage}
                      alt={product.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    {/* Badge */}
                    {product.badge && (
                      <span className="absolute left-3 top-3 rounded-full bg-yellow-400 px-3 py-1 text-sm font-semibold text-gray-900">
                        {product.badge}
                      </span>
                    )}
                    <span className="absolute right-3 top-3 rounded-full bg-orange-500 px-3 py-1 text-sm font-semibold text-white">
                      Б/У
                    </span>
                    {/* Stock */}
                    {!product.in_stock && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <span className="rounded-full bg-white px-4 py-2 font-semibold text-gray-900">
                          Нет в наличии
                        </span>
                      </div>
                    )}
                  </Link>

                  {/* Content - clickable */}
                  <Link to={`/used/${product.slug}`} className="mb-3 block">
                    <div className="text-sm text-gray-500">{product.brand}</div>
                    <h3 className="line-clamp-2 font-semibold text-gray-900 hover:text-yellow-600">{product.name}</h3>
                  </Link>

                  {/* Price */}
                  <div className="mb-4">
                    <span className="text-2xl font-bold text-gray-900">
                      {product.price.toLocaleString('ru-RU')} ₽
                    </span>
                    {product.old_price && (
                      <span className="ml-2 text-lg text-gray-400 line-through">
                        {product.old_price.toLocaleString('ru-RU')} ₽
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAddToCart(product)}
                      disabled={!product.in_stock}
                      className="flex-1 rounded-xl bg-yellow-400 px-4 py-3 font-semibold text-gray-900 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      В корзину
                    </button>
                    <Link
                      to={`/used/${product.slug}`}
                      className="flex items-center justify-center rounded-xl border border-gray-200 px-4 transition-colors hover:bg-gray-50"
                      title="Подробнее"
                    >
                      👁️
                    </Link>
                  </div>
                </div>
              )})}
            </div>
          )}
        </Container>
      </Section>

      {/* Info Section */}
      <Section className="bg-gray-50 py-16">
        <Container>
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-8 text-center text-3xl font-bold text-gray-900">Почему стоит покупать Б/У технику?</h2>
            
            <div className="grid gap-8 md:grid-cols-2">
              <div className="rounded-3xl bg-white p-8 shadow-lg">
                <h3 className="mb-4 text-xl font-bold text-gray-900">✅ Что мы проверяем</h3>
                <ul className="space-y-3 text-gray-600">
                  <li className="flex items-start gap-3">
                    <span className="text-green-500">•</span>
                    Полную функциональность устройства
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-green-500">•</span>
                    Состояние батареи (для ноутбуков)
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-green-500">•</span>
                    Все порты и разъёмы
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-green-500">•</span>
                    Дисплей и матрицу
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-green-500">•</span>
                    Отсутствие ремонтов
                  </li>
                </ul>
              </div>

              <div className="rounded-3xl bg-white p-8 shadow-lg">
                <h3 className="mb-4 text-xl font-bold text-gray-900">🛡️ Наши гарантии</h3>
                <ul className="space-y-3 text-gray-600">
                  <li className="flex items-start gap-3">
                    <span className="text-yellow-500">•</span>
                    Гарантия от 3 до 12 месяцев
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-yellow-500">•</span>
                    Возврат 14 дней без вопросов
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-yellow-500">•</span>
                    Честное описание состояния
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-yellow-500">•</span>
                    Реальные фото каждого товара
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-yellow-500">•</span>
                    Консультация перед покупкой
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <Section className="bg-gray-900 py-16">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-white">Не нашли нужный товар?</h2>
            <p className="mb-8 text-gray-400">
              Позвоните нам — поможем подобрать технику или найдём её под заказ
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a 
                href="tel:+79998021022" 
                className="rounded-xl bg-yellow-400 px-8 py-4 font-semibold text-gray-900 transition-colors hover:bg-yellow-300"
              >
                📞 +7 (999) 802-10-22
              </a>
              <Button to="/catalog" variant="outline" size="lg" className="border-white text-white hover:bg-white hover:text-gray-900">
                Весь каталог
              </Button>
            </div>
          </div>
        </Container>
      </Section>
    </div>
  )
}
