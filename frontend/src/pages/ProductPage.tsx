import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard } from '../components/ProductCard'
import { getProductById, products, formatPrice, getBadgeText } from '../data/products'
import { useCart } from '../lib/cart'
import { API_BASE_URL } from '../lib/config'
import type { Product as CartProduct } from '../data/products'
import { 
  ChevronLeftIcon, 
  ShieldIcon, 
  TruckIcon, 
  CheckIcon, 
  HeartIcon,
  PhoneIcon
} from '../components/ui/Icons'

interface ProductVariant {
  id: number
  slug: string
  color?: string
  color_code?: string
  storage?: string
  price: number
  in_stock: boolean
}

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
  variants?: ProductVariant[]
}

function getImageUrl(url?: string): string {
  if (!url) return ''
  if (url.startsWith('/uploads')) return `${API_BASE_URL}${url}`
  return url
}

export function ProductPage() {
  const params = useParams()
  const navigate = useNavigate()
  const { addItem } = useCart()
  const id = params.id ?? ''
  
  // Try local data first, then API
  const localProduct = getProductById(id)
  
  const [apiProduct, setApiProduct] = useState<ApiProduct | null>(null)
  const [loading, setLoading] = useState(!localProduct)
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<'description' | 'specs' | 'reviews'>('description')
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  
  // Load from API if it might have variants or not found locally
  useEffect(() => {
    async function loadProduct() {
      try {
        // Try by ID first
        let res = await fetch(`${API_BASE_URL}/api/products/${id}`)
        if (!res.ok) {
          // Maybe it's a slug
          res = await fetch(`${API_BASE_URL}/api/products/slug/${id}`)
        }
        if (res.ok) {
          const data = await res.json()
          setApiProduct(data)
        }
      } catch (err) {
        console.error('Error loading product:', err)
      } finally {
        setLoading(false)
      }
    }
    
    loadProduct()
  }, [id])
  
  // Get related products from the same category
  const relatedProducts = localProduct 
    ? products.filter(p => p.categorySlug === localProduct.categorySlug && p.id !== localProduct.id).slice(0, 4)
    : []
  
  // Use API product if available, otherwise local
  const hasApiProduct = apiProduct !== null
  const product = hasApiProduct ? null : localProduct
  
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent"></div>
      </div>
    )
  }
  
  if (!product && !apiProduct) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="text-center">
          <div className="mb-6 text-6xl">🔍</div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Товар не найден</h1>
          <p className="mb-6 text-gray-500">Возможно, товар был удален или вы ошиблись адресом</p>
          <Button to="/catalog">Перейти в каталог</Button>
        </div>
      </div>
    )
  }
  
  // Get unique colors and storages from variants
  const variants = apiProduct?.variants || []
  const uniqueColors = [...new Map(
    variants.filter(v => v.color).map(v => [v.color, { color: v.color!, color_code: v.color_code }])
  ).values()]
  const uniqueStorages = [...new Set(variants.filter(v => v.storage).map(v => v.storage!))]
  
  // Check if a specific combination is available
  const isVariantAvailable = (color?: string, storage?: string) => {
    return variants.some(v => 
      (!color || v.color === color) && 
      (!storage || v.storage === storage) && 
      v.in_stock
    )
  }
  
  // Get variant for specific color/storage combination
  const getVariantForOptions = (color?: string, storage?: string) => {
    return variants.find(v => 
      (!color || v.color === color) && 
      (!storage || v.storage === storage)
    )
  }
  
  // Handle variant selection
  const handleColorSelect = (color: string) => {
    const variant = getVariantForOptions(color, apiProduct?.storage)
    if (variant) {
      navigate(`/product/${variant.slug}`, { replace: true })
    } else {
      // Find any variant with this color
      const anyVariant = variants.find(v => v.color === color)
      if (anyVariant) {
        navigate(`/product/${anyVariant.slug}`, { replace: true })
      }
    }
  }
  
  const handleStorageSelect = (storage: string) => {
    const variant = getVariantForOptions(apiProduct?.color, storage)
    if (variant) {
      navigate(`/product/${variant.slug}`, { replace: true })
    } else {
      // Find any variant with this storage
      const anyVariant = variants.find(v => v.storage === storage)
      if (anyVariant) {
        navigate(`/product/${anyVariant.slug}`, { replace: true })
      }
    }
  }
  
  const handleAddToCart = () => {
    const cartProduct: CartProduct = hasApiProduct ? {
      id: String(apiProduct!.id),
      name: apiProduct!.name,
      brand: apiProduct!.brand || '',
      category: '',
      categorySlug: '',
      price: apiProduct!.price,
      oldPrice: apiProduct!.old_price,
      badge: apiProduct!.badge as CartProduct['badge'],
      inStock: apiProduct!.in_stock,
      image: apiProduct!.images?.[0] || apiProduct!.image || '📦',
      description: apiProduct!.description || '',
      specs: apiProduct!.specs?.map(s => ({ label: s.label || s.key || '', value: s.value })) || []
    } : product!
    
    for (let i = 0; i < quantity; i++) {
      addItem(cartProduct)
    }
    
    navigate('/cart')
  }
  
  // Render for API product with variants
  if (hasApiProduct) {
    const images = apiProduct.images?.length ? apiProduct.images : [apiProduct.image]
    
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Breadcrumbs */}
        <div className="border-b border-gray-100 bg-white">
          <Container className="py-4">
            <nav className="flex items-center gap-2 text-sm">
              <Link to="/" className="text-gray-500 hover:text-yellow-600">Главная</Link>
              <span className="text-gray-300">/</span>
              <Link to="/catalog" className="text-gray-500 hover:text-yellow-600">Каталог</Link>
              <span className="text-gray-300">/</span>
              <span className="truncate text-gray-900">{apiProduct.name}</span>
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
                  {/* Badge */}
                  {apiProduct.badge && (
                    <div className="absolute left-4 top-4 z-10">
                      <span className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                        apiProduct.badge === 'hit' 
                          ? 'bg-yellow-400 text-gray-900'
                          : apiProduct.badge === 'sale'
                          ? 'bg-red-500 text-white'
                          : 'bg-green-500 text-white'
                      }`}>
                        {getBadgeText(apiProduct.badge as 'hit' | 'new' | 'sale')}
                      </span>
                    </div>
                  )}
                  
                  {/* Main Image */}
                  <div className="flex aspect-square items-center justify-center p-8">
                    {images[activeImageIndex]?.startsWith('http') || images[activeImageIndex]?.startsWith('/uploads') ? (
                      <img 
                        src={getImageUrl(images[activeImageIndex])}
                        alt={apiProduct.name}
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
                  <span className="text-yellow-600">{apiProduct.brand}</span>
                </div>
                
                {/* Name */}
                <h1 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">
                  {apiProduct.name}
                </h1>
                
                {/* Stock status */}
                <div className="mb-4">
                  {apiProduct.in_stock ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                      <CheckIcon className="h-4 w-4" />
                      В наличии
                    </span>
                  ) : (
                    <span className="text-sm text-red-500">Нет в наличии</span>
                  )}
                </div>
                
                {/* Color Selector */}
                {uniqueColors.length > 0 && (
                  <div className="mb-4">
                    <label className="mb-2 block text-sm text-gray-500">Цвет</label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueColors.map(({ color, color_code }) => {
                        const isSelected = apiProduct.color === color
                        const isAvailable = isVariantAvailable(color, apiProduct.storage)
                        return (
                          <button
                            key={color}
                            onClick={() => handleColorSelect(color)}
                            disabled={!isAvailable}
                            className={`flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-medium transition-all ${
                              isSelected
                                ? 'border-yellow-400 bg-yellow-50'
                                : isAvailable
                                ? 'border-gray-200 bg-white hover:border-gray-300'
                                : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            <span 
                              className={`h-5 w-5 rounded-full border ${
                                isAvailable ? 'border-gray-300' : 'border-gray-200 opacity-50'
                              }`}
                              style={{ backgroundColor: color_code || '#ccc' }}
                            />
                            {color}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                
                {/* Storage Selector */}
                {uniqueStorages.length > 0 && (
                  <div className="mb-6">
                    <label className="mb-2 block text-sm text-gray-500">Накопитель</label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueStorages.map(storage => {
                        const isSelected = apiProduct.storage === storage
                        const isAvailable = isVariantAvailable(apiProduct.color, storage)
                        return (
                          <button
                            key={storage}
                            onClick={() => handleStorageSelect(storage)}
                            disabled={!isAvailable}
                            className={`rounded-full border-2 px-4 py-2 text-sm font-medium transition-all ${
                              isSelected
                                ? 'border-yellow-400 bg-yellow-50'
                                : isAvailable
                                ? 'border-gray-200 bg-white hover:border-gray-300'
                                : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {storage}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                
                {/* Price */}
                <div className="mb-6 flex items-end gap-3">
                  <span className="text-3xl font-bold text-gray-900 sm:text-4xl">
                    {formatPrice(apiProduct.price)}
                  </span>
                  {apiProduct.old_price && (
                    <span className="mb-1 text-xl text-gray-400 line-through">
                      {formatPrice(apiProduct.old_price)}
                    </span>
                  )}
                </div>
                
                {/* Description */}
                {apiProduct.description && (
                  <p className="mb-6 text-gray-600">{apiProduct.description}</p>
                )}
                
                {/* Actions */}
                <div className="mb-8 flex flex-wrap items-center gap-3">
                  {/* Quantity */}
                  <div className="flex items-center rounded-xl border border-gray-200 bg-white">
                    <button
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="flex h-12 w-12 items-center justify-center text-xl font-medium text-gray-500 transition-colors hover:text-gray-900"
                      disabled={quantity <= 1}
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-lg font-semibold">{quantity}</span>
                    <button
                      onClick={() => setQuantity(q => q + 1)}
                      className="flex h-12 w-12 items-center justify-center text-xl font-medium text-gray-500 transition-colors hover:text-gray-900"
                    >
                      +
                    </button>
                  </div>
                  
                  {/* Buy now button */}
                  <button 
                    onClick={handleAddToCart}
                    disabled={!apiProduct.in_stock}
                    className="rounded-xl bg-yellow-400 px-8 py-3 text-base font-semibold text-gray-900 shadow-sm transition-all hover:bg-yellow-500 hover:shadow-md active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                  >
                    Купить сейчас
                  </button>
                  
                  {/* Add to cart */}
                  <button 
                    onClick={handleAddToCart}
                    disabled={!apiProduct.in_stock}
                    className="flex items-center gap-2 rounded-xl border-2 border-yellow-400 bg-white px-6 py-2.5 text-base font-semibold text-gray-900 transition-all hover:bg-yellow-50 active:scale-[0.98] disabled:border-gray-200 disabled:text-gray-400"
                  >
                    В корзину 🛒
                  </button>
                </div>
                
                {/* Disclaimer */}
                <p className="mb-6 text-xs text-gray-400">
                  Товар имеет недостаток: невозможно установить и использовать RuStore
                  <br />
                  Цена действительна только для интернет-магазина и может отличаться от цен в розничных магазинах, 
                  а также в зависимости от версии приобретаемого устройства
                </p>
                
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
                      <div className="font-semibold text-gray-900">Гарантия 1 год</div>
                      <div className="text-sm text-gray-500">Официальная</div>
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
              {[
                { id: 'description', label: 'Описание' },
                { id: 'specs', label: 'Характеристики' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex-1 whitespace-nowrap rounded-lg px-6 py-3 text-sm font-semibold transition-colors ${
                    activeTab === tab.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            
            {/* Tab content */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6">
              {activeTab === 'description' && (
                <div className="prose max-w-none">
                  <p className="text-gray-600 leading-relaxed">{apiProduct.description}</p>
                  <p className="mt-4 text-gray-600 leading-relaxed">
                    {apiProduct.brand} — один из ведущих мировых брендов электроники. 
                    Продукция отличается высоким качеством сборки, инновационными технологиями 
                    и долгим сроком службы.
                  </p>
                </div>
              )}
              
              {activeTab === 'specs' && (
                <div className="divide-y divide-gray-100">
                  {apiProduct.specs?.map((spec, i) => (
                    <div key={i} className="flex justify-between py-4 first:pt-0 last:pb-0">
                      <span className="text-gray-500">{spec.label || spec.key}</span>
                      <span className="font-medium text-gray-900">{spec.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Container>
        </section>
        
        {/* CTA */}
        <section className="bg-gradient-to-r from-yellow-400 to-amber-400 py-12">
          <Container>
            <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
              <div>
                <h2 className="mb-2 text-2xl font-bold text-gray-900">Нужна консультация?</h2>
                <p className="text-gray-800">Наши специалисты ответят на все ваши вопросы</p>
              </div>
              <Button to="/cart" variant="secondary" size="lg">
                Оставить заявку
              </Button>
            </div>
          </Container>
        </section>
      </div>
    )
  }
  
  // Original local product render (fallback)
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumbs */}
      <div className="border-b border-gray-100 bg-white">
        <Container className="py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-gray-500 hover:text-yellow-600">Главная</Link>
            <span className="text-gray-300">/</span>
            <Link to="/catalog" className="text-gray-500 hover:text-yellow-600">Каталог</Link>
            <span className="text-gray-300">/</span>
            <Link to={`/catalog?category=${product!.categorySlug}`} className="text-gray-500 hover:text-yellow-600">
              {product!.category}
            </Link>
            <span className="text-gray-300">/</span>
            <span className="truncate text-gray-900">{product!.name}</span>
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
                {/* Badge */}
                {product!.badge && (
                  <div className="absolute left-4 top-4 z-10">
                    <span className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                      product!.badge === 'hit' 
                        ? 'bg-yellow-400 text-gray-900'
                        : product!.badge === 'sale'
                        ? 'bg-red-500 text-white'
                        : 'bg-green-500 text-white'
                    }`}>
                      {getBadgeText(product!.badge)}
                    </span>
                  </div>
                )}
                
                {/* Image */}
                <div className="flex aspect-square items-center justify-center p-12">
                  <span className="text-[12rem] transition-transform hover:scale-105">
                    {product!.image}
                  </span>
                </div>
                
                {/* Favorite button */}
                <button className="absolute right-4 top-4 rounded-full bg-white p-3 shadow-lg transition-colors hover:bg-yellow-50">
                  <HeartIcon className="h-6 w-6 text-gray-400 hover:text-red-500" />
                </button>
              </div>
            </div>
            
            {/* Product Info */}
            <div className="flex flex-col">
              {/* Category & Brand */}
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="text-yellow-600">{product!.category}</span>
                <span className="text-gray-300">•</span>
                <span className="text-gray-500">{product!.brand}</span>
              </div>
              
              {/* Name */}
              <h1 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">
                {product!.name}
              </h1>
              
              {/* Stock status */}
              <div className="mb-6">
                {product!.inStock ? (
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
                  {formatPrice(product!.price)}
                </span>
                {product!.oldPrice && (
                  <span className="mb-1 text-xl text-gray-400 line-through">
                    {formatPrice(product!.oldPrice)}
                  </span>
                )}
              </div>
              
              {/* Description */}
              <p className="mb-6 text-gray-600">{product!.description}</p>
              
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
                  disabled={!product!.inStock}
                >
                  {product!.inStock ? 'Заказать' : 'Нет в наличии'}
                </Button>
                
                {/* One-click order */}
                <button className="rounded-xl border-2 border-gray-200 px-6 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-yellow-400 hover:text-yellow-600">
                  Купить в 1 клик
                </button>
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
                    <div className="font-semibold text-gray-900">Гарантия 1 год</div>
                    <div className="text-sm text-gray-500">Официальная</div>
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
            {[
              { id: 'description', label: 'Описание' },
              { id: 'specs', label: 'Характеристики' },
              { id: 'reviews', label: 'Отзывы' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex-1 whitespace-nowrap rounded-lg px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          
          {/* Tab content */}
          <div className="rounded-2xl border border-gray-100 bg-white p-6">
            {activeTab === 'description' && (
              <div className="prose max-w-none">
                <p className="text-gray-600 leading-relaxed">{product!.description}</p>
                <p className="mt-4 text-gray-600 leading-relaxed">
                  {product!.brand} — один из ведущих мировых брендов электроники. 
                  Продукция отличается высоким качеством сборки, инновационными технологиями 
                  и долгим сроком службы.
                </p>
              </div>
            )}
            
            {activeTab === 'specs' && (
              <div className="divide-y divide-gray-100">
                {product!.specs.map((spec, i) => (
                  <div key={i} className="flex justify-between py-4 first:pt-0 last:pb-0">
                    <span className="text-gray-500">{spec.label}</span>
                    <span className="font-medium text-gray-900">{spec.value}</span>
                  </div>
                ))}
              </div>
            )}
            
            {activeTab === 'reviews' && (
              <div className="text-center py-12">
                <div className="mb-4 text-5xl">💬</div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">Отзывов пока нет</h3>
                <p className="text-gray-500">Будьте первым, кто оставит отзыв!</p>
              </div>
            )}
          </div>
        </Container>
      </section>
      
      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <section className="py-12">
          <Container>
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Похожие товары</h2>
              <Link 
                to={`/catalog?category=${product!.categorySlug}`}
                className="text-sm font-semibold text-yellow-600 hover:text-yellow-700"
              >
                Смотреть все →
              </Link>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {relatedProducts.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </Container>
        </section>
      )}
      
      {/* CTA */}
      <section className="bg-gradient-to-r from-yellow-400 to-amber-400 py-12">
        <Container>
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h2 className="mb-2 text-2xl font-bold text-gray-900">Нужна консультация?</h2>
              <p className="text-gray-800">Наши специалисты ответят на все ваши вопросы</p>
            </div>
            <Button to="/cart" variant="secondary" size="lg">
              Оставить заявку
            </Button>
          </div>
        </Container>
      </section>
    </div>
  )
}
