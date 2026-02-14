import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { API_BASE_URL } from '../lib/config'
import { useCart } from '../lib/cart'
import type { Product } from '../data/products'
import { 
  ChevronLeftIcon, 
  ShieldIcon, 
  TruckIcon, 
  CheckIcon, 
  HeartIcon,
  PhoneIcon
} from '../components/ui/Icons'

interface ApiProduct {
  id: number
  name: string
  slug: string
  brand: string
  category_id: number
  price: number
  old_price?: number
  badge?: string
  in_stock: boolean
  is_used: boolean
  image: string
  images?: string[]
  description: string
  specs?: Array<{label?: string; key?: string; value: string}>
  variant_group_id?: string
  color?: string
  color_code?: string
  storage?: string
  variants?: Array<{
    id: number
    slug: string
    color?: string
    color_code?: string
    storage?: string
    price: number
    in_stock: boolean
  }>
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU').format(price) + ' ₽'
}

function getBadgeText(badge?: string): string {
  switch (badge) {
    case 'hit': return 'Хит продаж'
    case 'new': return 'Новинка'
    case 'sale': return 'Скидка'
    default: return ''
  }
}

function getImageUrl(url?: string): string {
  if (!url) return 'https://placehold.co/400x400/f3f4f6/9ca3af?text=Фото'
  if (url.startsWith('/uploads')) return `${API_BASE_URL}${url}`
  return url
}

export function UsedProductPage() {
  const params = useParams()
  const navigate = useNavigate()
  const { addItem } = useCart()
  const [product, setProduct] = useState<ApiProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<'description' | 'specs'>('description')
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  
  const slug = params.slug ?? ''
  
  useEffect(() => {
    async function loadProduct() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/products/slug/${slug}`)
        if (res.ok) {
          const data = await res.json()
          setProduct(data)
        }
      } catch (err) {
        console.error('Error loading product:', err)
      } finally {
        setLoading(false)
      }
    }
    
    loadProduct()
  }, [slug])
  
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent"></div>
      </div>
    )
  }
  
  if (!product) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="text-center">
          <div className="mb-6 text-6xl">🔍</div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Товар не найден</h1>
          <p className="mb-6 text-gray-500">Возможно, товар был удален или вы ошиблись адресом</p>
          <Button to="/used">Перейти в каталог Б/У</Button>
        </div>
      </div>
    )
  }
  
  const handleAddToCart = () => {
    const cartProduct: Product = {
      id: String(product.id),
      name: product.name,
      brand: product.brand || '',
      category: 'Б/У техника',
      categorySlug: 'used',
      price: product.price,
      oldPrice: product.old_price,
      badge: product.badge as Product['badge'],
      inStock: product.in_stock,
      image: product.images?.[0] || product.image || '📦',
      description: product.description || '',
      specs: product.specs?.map(s => ({ label: s.label || s.key || '', value: s.value })) || []
    }
    
    for (let i = 0; i < quantity; i++) {
      addItem(cartProduct)
    }
    
    navigate('/cart')
  }
  
  const images = product.images?.length ? product.images : [product.image]
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumbs */}
      <div className="border-b border-gray-100 bg-white">
        <Container className="py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-gray-500 hover:text-yellow-600">Главная</Link>
            <span className="text-gray-300">/</span>
            <Link to="/used" className="text-gray-500 hover:text-yellow-600">Б/У техника</Link>
            <span className="text-gray-300">/</span>
            <span className="truncate text-gray-900">{product.name}</span>
          </nav>
        </Container>
      </div>
      
      {/* Main Product Section */}
      <section className="bg-white py-8">
        <Container>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
            {/* Product Image */}
            <div className="relative">
              <button
                onClick={() => navigate(-1)}
                className="absolute -left-4 -top-4 z-10 flex items-center gap-1 rounded-lg p-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 lg:hidden"
              >
                <ChevronLeftIcon className="h-5 w-5" />
                Назад
              </button>
              
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-50 to-gray-100">
                {/* Badges */}
                <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
                  <span className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-semibold text-white">
                    Б/У
                  </span>
                  {product.badge && (
                    <span className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                      product.badge === 'hit' 
                        ? 'bg-yellow-400 text-gray-900'
                        : product.badge === 'sale'
                        ? 'bg-red-500 text-white'
                        : 'bg-green-500 text-white'
                    }`}>
                      {getBadgeText(product.badge)}
                    </span>
                  )}
                </div>
                
                {/* Main Image */}
                <div className="flex aspect-square items-center justify-center p-8">
                  {images[activeImageIndex]?.startsWith('http') || images[activeImageIndex]?.startsWith('/uploads') ? (
                    <img 
                      src={getImageUrl(images[activeImageIndex])}
                      alt={product.name}
                      className="max-h-full max-w-full object-contain transition-transform hover:scale-105"
                    />
                  ) : (
                    <span className="text-[12rem] transition-transform hover:scale-105">
                      {images[activeImageIndex] || '📦'}
                    </span>
                  )}
                </div>
                
                {/* Favorite button */}
                <button className="absolute right-4 top-4 rounded-full bg-white p-3 shadow-lg transition-colors hover:bg-yellow-50">
                  <HeartIcon className="h-6 w-6 text-gray-400 hover:text-red-500" />
                </button>
              </div>
              
              {/* Image thumbnails */}
              {images.length > 1 && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {images.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveImageIndex(i)}
                      className={`relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-colors ${
                        i === activeImageIndex ? 'border-yellow-400' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {img?.startsWith('http') || img?.startsWith('/uploads') ? (
                        <img src={getImageUrl(img)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-3xl bg-gray-100">{img}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {/* Product Info */}
            <div className="flex flex-col">
              {/* Brand */}
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-600">Б/У техника</span>
                {product.brand && (
                  <>
                    <span className="text-gray-300">•</span>
                    <span className="text-gray-500">{product.brand}</span>
                  </>
                )}
              </div>
              
              {/* Name */}
              <h1 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">
                {product.name}
              </h1>
              
              {/* Stock status */}
              <div className="mb-6">
                {product.in_stock ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                    <CheckIcon className="h-4 w-4" />
                    В наличии
                  </span>
                ) : (
                  <span className="text-sm text-red-500">Нет в наличии</span>
                )}
              </div>
              
              {/* Price */}
              <div className="mb-6 flex items-end gap-3">
                <span className="text-3xl font-bold text-gray-900 sm:text-4xl">
                  {formatPrice(product.price)}
                </span>
                {product.old_price && (
                  <>
                    <span className="mb-1 text-xl text-gray-400 line-through">
                      {formatPrice(product.old_price)}
                    </span>
                    <span className="mb-1 rounded-full bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-600">
                      -{Math.round((1 - product.price / product.old_price) * 100)}%
                    </span>
                  </>
                )}
              </div>
              
              {/* Description */}
              {product.description && (
                <p className="mb-6 text-gray-600">{product.description}</p>
              )}
              
              {/* Actions */}
              <div className="mb-8 flex flex-col gap-4 sm:flex-row">
                {/* Quantity */}
                <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-2">
                  <button
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-xl font-semibold text-gray-600 transition-colors hover:bg-gray-200"
                    disabled={quantity <= 1}
                  >
                    −
                  </button>
                  <span className="w-12 text-center text-lg font-semibold">{quantity}</span>
                  <button
                    onClick={() => setQuantity(q => q + 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-xl font-semibold text-gray-600 transition-colors hover:bg-gray-200"
                  >
                    +
                  </button>
                </div>
                
                {/* Order button */}
                <Button 
                  onClick={handleAddToCart}
                  size="lg"
                  className="flex-1 sm:flex-initial"
                  disabled={!product.in_stock}
                >
                  {product.in_stock ? 'Добавить в корзину' : 'Нет в наличии'}
                </Button>
                
                {/* One-click order */}
                <a 
                  href="tel:+74952557362"
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-gray-200 px-6 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-yellow-400 hover:text-yellow-600"
                >
                  <PhoneIcon className="h-5 w-5" />
                  Позвонить
                </a>
              </div>
              
              {/* Benefits */}
              <div className="grid gap-4 rounded-2xl bg-gray-50 p-6 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-yellow-100 p-2 text-yellow-600">
                    <TruckIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">Бесплатная доставка</div>
                    <div className="text-sm text-gray-500">По Москве от 2 часов</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-green-100 p-2 text-green-600">
                    <ShieldIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">Гарантия</div>
                    <div className="text-sm text-gray-500">Проверено и протестировано</div>
                  </div>
                </div>
              </div>
              
              {/* Call to order */}
              <div className="mt-6 flex items-center gap-4 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
                <div className="rounded-full bg-yellow-400 p-3">
                  <PhoneIcon className="h-6 w-6 text-gray-900" />
                </div>
                <div>
                  <div className="text-sm text-gray-600">Остались вопросы?</div>
                  <a href="tel:+74952557362" className="text-lg font-semibold text-gray-900 hover:text-yellow-600">
                    +7 (495) 255-73-62
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>
      
      {/* Tabs Section */}
      <section className="border-t border-gray-100 bg-white py-8">
        <Container>
          {/* Tab buttons */}
          <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setActiveTab('description')}
              className={`whitespace-nowrap rounded-lg px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'description'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Описание
            </button>
            <button
              onClick={() => setActiveTab('specs')}
              className={`whitespace-nowrap rounded-lg px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'specs'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Характеристики
            </button>
          </div>
          
          {/* Tab content */}
          <div className="rounded-2xl bg-gray-50 p-6">
            {activeTab === 'description' && (
              <div className="prose prose-gray max-w-none">
                <p className="text-gray-600">{product.description || 'Описание отсутствует'}</p>
                
                <div className="mt-6 rounded-xl bg-orange-50 p-4">
                  <h4 className="mb-2 font-semibold text-orange-800">О Б/У товарах</h4>
                  <p className="text-sm text-orange-700">
                    Все Б/У товары проходят полную проверку и диагностику перед продажей. 
                    Мы гарантируем работоспособность устройства и предоставляем гарантию на каждый товар.
                  </p>
                </div>
              </div>
            )}
            
            {activeTab === 'specs' && (
              <div className="space-y-3">
                {product.specs && product.specs.length > 0 ? (
                  product.specs.map((spec, i) => (
                    <div
                      key={i}
                      className={`flex justify-between rounded-lg px-4 py-3 ${
                        i % 2 === 0 ? 'bg-white' : ''
                      }`}
                    >
                      <span className="text-gray-500">{spec.label || spec.key}</span>
                      <span className="font-medium text-gray-900">{spec.value}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500">Характеристики не указаны</p>
                )}
              </div>
            )}
          </div>
        </Container>
      </section>
      
      {/* Back to catalog */}
      <section className="py-8">
        <Container>
          <div className="text-center">
            <Button to="/used" variant="outline">
              ← Вернуться в каталог Б/У
            </Button>
          </div>
        </Container>
      </section>
    </div>
  )
}
