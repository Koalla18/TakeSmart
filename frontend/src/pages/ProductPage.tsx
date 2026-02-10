import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard } from '../components/ProductCard'
import { getProductById, products, formatPrice, getBadgeText, type Product } from '../data/products'
import { 
  ChevronLeftIcon, 
  ShieldIcon, 
  TruckIcon, 
  CheckIcon, 
  HeartIcon,
  PhoneIcon
} from '../components/ui/Icons'

export function ProductPage() {
  const params = useParams()
  const navigate = useNavigate()
  const id = params.id ?? ''
  const product = getProductById(id)
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<'description' | 'specs' | 'reviews'>('description')
  
  if (!product) {
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
  
  // Get related products from the same category
  const relatedProducts = products
    .filter(p => p.categorySlug === product.categorySlug && p.id !== product.id)
    .slice(0, 4)
  
  const handleOrder = () => {
    // Navigate to cart with product info
    navigate('/cart', { state: { product, quantity } })
  }
  
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
            <Link to={`/catalog?category=${product.categorySlug}`} className="text-gray-500 hover:text-yellow-600">
              {product.category}
            </Link>
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
                {/* Badge */}
                {product.badge && (
                  <div className="absolute left-4 top-4 z-10">
                    <span className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                      product.badge === 'hit' 
                        ? 'bg-yellow-400 text-gray-900'
                        : product.badge === 'sale'
                        ? 'bg-red-500 text-white'
                        : 'bg-green-500 text-white'
                    }`}>
                      {getBadgeText(product.badge)}
                    </span>
                  </div>
                )}
                
                {/* Image */}
                <div className="flex aspect-square items-center justify-center p-12">
                  <span className="text-[12rem] transition-transform hover:scale-105">
                    {product.image}
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
                <span className="text-yellow-600">{product.category}</span>
                <span className="text-gray-300">•</span>
                <span className="text-gray-500">{product.brand}</span>
              </div>
              
              {/* Name */}
              <h1 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">
                {product.name}
              </h1>
              
              {/* Stock status */}
              <div className="mb-6">
                {product.inStock ? (
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
                {product.oldPrice && (
                  <span className="mb-1 text-xl text-gray-400 line-through">
                    {formatPrice(product.oldPrice)}
                  </span>
                )}
              </div>
              
              {/* Description */}
              <p className="mb-6 text-gray-600">{product.description}</p>
              
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
                  onClick={handleOrder}
                  size="lg"
                  className="flex-1 sm:flex-initial"
                  disabled={!product.inStock}
                >
                  {product.inStock ? 'Заказать' : 'Нет в наличии'}
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
                  <a href="tel:+79991234567" className="text-lg font-semibold text-gray-900 hover:text-yellow-600">
                    +7 (999) 123-45-67
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
                <p className="text-gray-600 leading-relaxed">{product.description}</p>
                <p className="mt-4 text-gray-600 leading-relaxed">
                  {product.brand} — один из ведущих мировых брендов электроники. 
                  Продукция отличается высоким качеством сборки, инновационными технологиями 
                  и долгим сроком службы.
                </p>
              </div>
            )}
            
            {activeTab === 'specs' && (
              <div className="divide-y divide-gray-100">
                {product.specs.map((spec, i) => (
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
                to={`/catalog?category=${product.categorySlug}`}
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
