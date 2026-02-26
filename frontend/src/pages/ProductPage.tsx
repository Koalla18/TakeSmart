import { useState, useEffect, useCallback, useRef } from 'react'
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

/* ───────────────────── Image Lightbox ───────────────────── */
function ImageLightbox({
  images,
  startIndex,
  getUrl,
  onClose,
}: {
  images: string[]
  startIndex: number
  getUrl: (src: string) => string
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [zoomed, setZoomed] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [origin, setOrigin] = useState({ x: 50, y: 50 })
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const multi = images.length > 1
  const src = getUrl(images[index])

  const goPrev = useCallback(() => {
    setZoomed(false)
    setTranslate({ x: 0, y: 0 })
    setIndex((p) => (p === 0 ? images.length - 1 : p - 1))
  }, [images.length])

  const goNext = useCallback(() => {
    setZoomed(false)
    setTranslate({ x: 0, y: 0 })
    setIndex((p) => (p === images.length - 1 ? 0 : p + 1))
  }, [images.length])

  // Keyboard handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && multi) goPrev()
      if (e.key === 'ArrowRight' && multi) goNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, goPrev, goNext, multi])

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Swipe support
  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoomed) return
    setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY })
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!dragStart || zoomed) return
    const dx = e.changedTouches[0].clientX - dragStart.x
    if (Math.abs(dx) > 60 && multi) {
      dx > 0 ? goPrev() : goNext()
    }
    setDragStart(null)
  }

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation()
    if (zoomed) {
      setZoomed(false)
      setTranslate({ x: 0, y: 0 })
    } else {
      // Set zoom origin to click position
      const rect = (e.target as HTMLElement).getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      setOrigin({ x, y })
      setZoomed(true)
    }
  }

  // Drag panning when zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!zoomed) return
    e.preventDefault()
    setDragStart({ x: e.clientX - translate.x, y: e.clientY - translate.y })
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!zoomed || !dragStart) return
    setTranslate({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }
  const handleMouseUp = () => {
    if (zoomed) setDragStart(null)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        aria-label="Закрыть"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Counter */}
      {multi && (
        <span className="absolute left-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white">
          {index + 1} / {images.length}
        </span>
      )}

      {/* Prev */}
      {multi && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev() }}
          className="absolute left-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:left-4"
          aria-label="Предыдущее фото"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Main image */}
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoomed ? 'grab' : 'zoom-in' }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          onClick={handleImageClick}
          draggable={false}
          className="max-h-[85vh] max-w-[90vw] select-none object-contain transition-transform duration-200"
          style={{
            transform: zoomed
              ? `scale(2.5) translate(${translate.x / 2.5}px, ${translate.y / 2.5}px)`
              : 'scale(1)',
            transformOrigin: `${origin.x}% ${origin.y}%`,
          }}
        />
      </div>

      {/* Next */}
      {multi && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext() }}
          className="absolute right-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:right-4"
          aria-label="Следующее фото"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Thumbnails strip */}
      {multi && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2 rounded-2xl bg-black/40 p-2">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setZoomed(false); setTranslate({ x: 0, y: 0 }); setIndex(i) }}
              className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === index ? 'border-yellow-400' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              <img src={getUrl(img)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
/* ───────────────────── End Lightbox ───────────────────── */

interface ProductImage {
  id: string
  product_id: string
  file_path: string
  url: string
  original_filename: string
  mime_type: string
  file_size: number
  sort_order: number
  is_main: boolean
}

interface ApiProduct {
  id: string
  name: string
  slug: string
  brand: string | null
  category_id: string | null
  price: number
  discount_price: number | null
  stock_quantity: number
  is_active: boolean
  is_featured: boolean
  main_image_url: string | null
  images?: ProductImage[]
  description: string | null
  short_description: string | null
  sku: string | null
  model: string | null
  color: string | null
  warranty_months: number | null
  created_at: string
  updated_at: string
}

function isImageUrl(url?: string): boolean {
  if (!url) return false
  return url.startsWith('http') || url.startsWith('/products') || url.startsWith('/uploads') || url.startsWith('/static')
}

function getImageUrl(url?: string): string {
  if (!url) return ''
  if (url.startsWith('/uploads') || url.startsWith('/static')) return `${API_BASE_URL}${url}`
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
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxStartIndex, setLightboxStartIndex] = useState(0)
  
  // Load from API — always try slug first (reliable), then fallback to numeric id
  useEffect(() => {
    async function loadProduct() {
      try {
        // Try by slug first — this is the reliable way
        let res = await fetch(`${API_BASE_URL}/api/products/slug/${id}`)
        if (!res.ok) {
          // Fallback: maybe it's a numeric id
          res = await fetch(`${API_BASE_URL}/api/products/${id}`)
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
  
  // Render for API product
  if (hasApiProduct) {
    const handleAddToCart = () => {
      const cartProduct: CartProduct = {
        id: apiProduct!.id,
        slug: apiProduct!.slug,
        name: apiProduct!.name,
        brand: apiProduct!.brand || '',
        category: '',
        categorySlug: '',
        price: apiProduct!.discount_price || apiProduct!.price,
        oldPrice: apiProduct!.discount_price ? apiProduct!.price : undefined,
        inStock: apiProduct!.stock_quantity > 0,
        image: apiProduct!.main_image_url || '📦',
        description: apiProduct!.description || '',
        specs: [
          apiProduct!.brand && { label: 'Бренд', value: apiProduct!.brand },
          apiProduct!.model && { label: 'Модель', value: apiProduct!.model },
          apiProduct!.color && { label: 'Цвет', value: apiProduct!.color },
        ].filter(Boolean) as Array<{label: string; value: string}>
      }
    
      for (let i = 0; i < quantity; i++) {
        addItem(cartProduct)
      }
    
      navigate('/cart')
    }

    // Build image URL list from ProductDetailOut images array
    const images: string[] = apiProduct.images?.length 
      ? apiProduct.images.map(img => img.url || img.file_path)
      : apiProduct.main_image_url ? [apiProduct.main_image_url] : []
    
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
                  {apiProduct.is_featured && (
                    <div className="absolute left-4 top-4 z-10">
                      <span className="rounded-full bg-yellow-400 px-4 py-1.5 text-sm font-semibold text-gray-900">
                        Хит
                      </span>
                    </div>
                  )}
                  {apiProduct.discount_price && (
                    <div className={`absolute left-4 ${apiProduct.is_featured ? 'top-14' : 'top-4'} z-10`}>
                      <span className="rounded-full bg-red-500 px-4 py-1.5 text-sm font-semibold text-white">
                        -{Math.round((1 - apiProduct.discount_price / apiProduct.price) * 100)}%
                      </span>
                    </div>
                  )}
                  
                  {/* Main Image */}
                  <div
                    className="flex aspect-square cursor-pointer items-center justify-center p-8"
                    onClick={() => {
                      if (isImageUrl(images[activeImageIndex])) {
                        setLightboxStartIndex(activeImageIndex)
                        setLightboxOpen(true)
                      }
                    }}
                  >
                    {isImageUrl(images[activeImageIndex]) ? (
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
                        {isImageUrl(img) ? (
                          <img src={getImageUrl(img)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-3xl bg-gray-100">{img}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Zoom hint */}
                {isImageUrl(images[activeImageIndex]) && (
                  <p className="mt-2 text-center text-xs text-gray-400">Нажмите на фото для увеличения</p>
                )}

                {/* Lightbox */}
                {lightboxOpen && (
                  <ImageLightbox
                    images={images.filter(isImageUrl)}
                    startIndex={Math.min(lightboxStartIndex, images.filter(isImageUrl).length - 1)}
                    getUrl={getImageUrl}
                    onClose={() => setLightboxOpen(false)}
                  />
                )}
              </div>
              
              {/* Product Info */}
              <div className="flex flex-col">
                {/* Brand */}
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="text-yellow-600">{apiProduct.brand || ''}</span>
                </div>
                
                {/* Name */}
                <h1 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">
                  {apiProduct.name}
                </h1>
                
                {/* Stock status */}
                <div className="mb-4">
                  {apiProduct.stock_quantity > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                      <CheckIcon className="h-4 w-4" />
                      В наличии
                    </span>
                  ) : (
                    <span className="text-sm text-red-500">Нет в наличии</span>
                  )}
                </div>
                
                {/* Color info */}
                {apiProduct.color && (
                  <div className="mb-4">
                    <span className="text-sm text-gray-500">Цвет: </span>
                    <span className="text-sm font-medium text-gray-900">{apiProduct.color}</span>
                  </div>
                )}
                
                {/* Price */}
                <div className="mb-6 flex items-end gap-3">
                  <span className="text-3xl font-bold text-gray-900 sm:text-4xl">
                    {formatPrice(apiProduct.discount_price || apiProduct.price)}
                  </span>
                  {apiProduct.discount_price && (
                    <span className="mb-1 text-xl text-gray-400 line-through">
                      {formatPrice(apiProduct.price)}
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
                    disabled={apiProduct.stock_quantity <= 0}
                    className="rounded-xl bg-yellow-400 px-8 py-3 text-base font-semibold text-gray-900 shadow-sm transition-all hover:bg-yellow-500 hover:shadow-md active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                  >
                    Купить сейчас
                  </button>
                  
                  {/* Add to cart */}
                  <button 
                    onClick={handleAddToCart}
                    disabled={apiProduct.stock_quantity <= 0}
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
                    <a href="tel:+79998021022" className="text-lg font-semibold text-gray-900 hover:text-yellow-600">
                      +7 (999) 802-10-22
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
                  {([
                    apiProduct.brand ? { label: 'Бренд', value: apiProduct.brand } : null,
                    apiProduct.model ? { label: 'Модель', value: apiProduct.model } : null,
                    apiProduct.color ? { label: 'Цвет', value: apiProduct.color } : null,
                    apiProduct.sku ? { label: 'Артикул', value: apiProduct.sku } : null,
                    apiProduct.warranty_months ? { label: 'Гарантия', value: `${apiProduct.warranty_months} мес.` } : null,
                  ] as Array<{label: string; value: string} | null>).filter((x): x is {label: string; value: string} => x !== null).map((spec, i) => (
                    <div key={i} className="flex justify-between py-4 first:pt-0 last:pb-0">
                      <span className="text-gray-500">{spec.label}</span>
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
                <div
                  className="flex aspect-square cursor-pointer items-center justify-center p-12"
                  onClick={() => {
                    if (isImageUrl(product!.image)) {
                      setLightboxStartIndex(0)
                      setLightboxOpen(true)
                    }
                  }}
                >
                  {isImageUrl(product!.image) ? (
                    <img
                      src={getImageUrl(product!.image)}
                      alt={product!.name}
                      className="max-h-full max-w-full object-contain transition-transform hover:scale-105"
                    />
                  ) : (
                    <span className="text-[12rem] transition-transform hover:scale-105">
                      {product!.image}
                    </span>
                  )}
                </div>
                
                {/* Favorite button */}
                <button className="absolute right-4 top-4 rounded-full bg-white p-3 shadow-lg transition-colors hover:bg-yellow-50">
                  <HeartIcon className="h-6 w-6 text-gray-400 hover:text-red-500" />
                </button>
              </div>

              {/* Zoom hint */}
              {isImageUrl(product!.image) && (
                <p className="mt-2 text-center text-xs text-gray-400">Нажмите на фото для увеличения</p>
              )}

              {/* Lightbox */}
              {lightboxOpen && isImageUrl(product!.image) && (
                <ImageLightbox
                  images={[product!.image]}
                  startIndex={0}
                  getUrl={getImageUrl}
                  onClose={() => setLightboxOpen(false)}
                />
              )}
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
                  onClick={() => { addItem(product!); navigate('/cart') }}
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
                  <a href="tel:+79998021022" className="text-lg font-semibold text-gray-900 hover:text-yellow-600">
                    +7 (999) 802-10-22
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
