import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard } from '../components/ProductCard'
import { getFeaturedProducts, products } from '../data/products'
import type { Product } from '../data/products'
import { useCart } from '../lib/cart'
import { API_BASE_URL } from '../lib/config'
import { 
  ShieldIcon, 
  TruckIcon, 
  CardIcon, 
  PhoneIcon, 
  ArrowRightIcon, 
  SmartphoneIcon
} from '../components/ui/Icons'

// Scroll animation hook
function useScrollAnimation(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.unobserve(element)
        }
      },
      { threshold, rootMargin: '0px 0px -50px 0px' }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])

  return { ref, isVisible }
}

// Animated section wrapper
function AnimatedSection({ 
  children, 
  className = '',
  delay = 0 
}: { 
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const { ref, isVisible } = useScrollAnimation()
  
  return (
    <div 
      ref={ref}
      className={`transition-all duration-1000 ease-out ${className}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(40px)',
        transitionDelay: `${delay}ms`
      }}
    >
      {children}
    </div>
  )
}

const benefits = [
  { 
    icon: <ShieldIcon className="h-8 w-8" />, 
    title: 'Гарантия до 3 лет', 
    description: 'Официальная гарантия на всю технику'
  },
  { 
    icon: <TruckIcon className="h-8 w-8" />, 
    title: 'Доставка за 2 часа', 
    description: 'Бесплатная доставка по Москве'
  },
  { 
    icon: <CardIcon className="h-8 w-8" />, 
    title: 'Рассрочка 0%', 
    description: 'Без первого взноса и переплат'
  },
  { 
    icon: <PhoneIcon className="h-8 w-8" />, 
    title: 'Поддержка 24/7', 
    description: 'Ответим на любой вопрос'
  },
]

export function HomePage() {
  const featuredProducts = getFeaturedProducts()
  const [heroProduct, setHeroProduct] = useState<Product>(products[0]) // fallback
  const { addItem, isInCart } = useCart()
  const videoRef = useRef<HTMLVideoElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const [videoProgress, setVideoProgress] = useState(0)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Load featured product from API
  useEffect(() => {
    async function loadFeatured() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/products/featured`)
        if (res.ok) {
          const data = await res.json()
          if (data) {
            // Convert API format to local format
            setHeroProduct({
              id: String(data.id),
              name: data.name,
              brand: data.brand || '',
              category: '',
              categorySlug: '',
              price: data.price,
              oldPrice: data.old_price,
              badge: data.badge as Product['badge'],
              inStock: data.in_stock,
              image: data.images?.[0] || data.image || '📱',
              description: data.description || '',
              specs: data.specs?.map((s: {label?: string; key?: string; value: string}) => ({
                label: s.label || s.key || '',
                value: s.value
              })) || []
            })
          }
        }
      } catch (err) {
        console.error('Error loading featured product:', err)
      }
    }
    loadFeatured()
  }, [])

  // Video scroll sync (Apple-style)
  useEffect(() => {
    const video = videoRef.current
    const hero = heroRef.current
    if (!video || !hero) return

    const handleScroll = () => {
      const rect = hero.getBoundingClientRect()
      const heroHeight = hero.offsetHeight
      const scrolled = Math.max(0, -rect.top)
      const progress = Math.min(1, scrolled / heroHeight)
      setVideoProgress(progress)
      
      if (video.duration) {
        video.currentTime = progress * video.duration
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Mouse parallax effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  return (
    <div className="overflow-hidden">
      {/* Video Hero Section - Apple Style */}
      <section 
        ref={heroRef}
        className="relative min-h-[200vh] bg-black"
      >
        {/* Sticky video container */}
        <div className="sticky top-0 h-screen overflow-hidden">
          {/* Video background */}
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            src="/hero-video.mp4"
            muted
            playsInline
            preload="auto"
          />
          
          {/* Dark overlay that fades based on scroll */}
          <div 
            className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80 transition-opacity duration-300"
            style={{ opacity: 1 - videoProgress * 0.3 }}
          />
          
          {/* Content overlay */}
          <div className="relative z-10 flex h-full items-center justify-center">
            <Container>
              <div 
                className="text-center transition-all duration-500"
                style={{
                  opacity: 1 - videoProgress * 1.5,
                  transform: `translateY(${videoProgress * -100}px) scale(${1 - videoProgress * 0.1})`
                }}
              >
                {/* Badge */}
                <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-5 py-2.5 text-sm font-medium text-white border border-white/20">
                  <span className="flex h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                  Новая коллекция 2026
                </div>
                
                {/* Main heading */}
                <h1 className="mb-6 text-5xl font-bold leading-tight text-white sm:text-6xl lg:text-8xl">
                  <span className="block">Умная техника</span>
                  <span className="block bg-gradient-to-r from-yellow-400 to-amber-300 bg-clip-text text-transparent">
                    будущего
                  </span>
                </h1>
                
                <p className="mx-auto mb-10 max-w-2xl text-lg text-gray-300 sm:text-xl">
                  Откройте мир инновационных технологий. Смартфоны, ноутбуки и аксессуары от ведущих брендов с официальной гарантией.
                </p>
                
                <div className="flex flex-col justify-center gap-4 sm:flex-row">
                  <Button to="/catalog" size="lg" className="shadow-2xl shadow-yellow-400/30">
                    Смотреть каталог
                    <ArrowRightIcon className="ml-2 h-5 w-5" />
                  </Button>
                  <Button to="/cart" variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10 backdrop-blur-sm">
                    Оставить заявку
                  </Button>
                </div>
              </div>
            </Container>
          </div>
          
          {/* Scroll indicator */}
          <div 
            className="absolute bottom-10 left-1/2 -translate-x-1/2 transition-opacity duration-300"
            style={{ opacity: 1 - videoProgress * 3 }}
          >
            <div className="flex flex-col items-center gap-2 text-white/60">
              <span className="text-sm">Листайте вниз</span>
              <div className="h-12 w-6 rounded-full border-2 border-white/30 p-1">
                <div className="h-2 w-2 rounded-full bg-white animate-bounce" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Brands Carousel - Infinite Loop */}
      <section className="relative -mt-20 z-20">
        <Container>
          <AnimatedSection>
            <div className="rounded-3xl bg-white p-8 shadow-2xl shadow-black/10 sm:p-10 overflow-hidden">
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Официальный партнёр ведущих брендов</h2>
              </div>
              
              {/* Infinite Carousel */}
              <div className="relative">
                <div className="flex animate-marquee gap-12 whitespace-nowrap">
                  {[
                    { name: 'Apple', icon: '' },
                    { name: 'Samsung', icon: '📱' },
                    { name: 'Sony', icon: '🎮' },
                    { name: 'PlayStation', icon: '🎯' },
                    { name: 'Xbox', icon: '🕹️' },
                    { name: 'Яндекс', icon: '🔴' },
                    { name: 'JBL', icon: '🔊' },
                    { name: 'Xiaomi', icon: '📲' },
                    { name: 'Nintendo', icon: '🎲' },
                    { name: 'Huawei', icon: '📡' },
                    { name: 'DJI', icon: '🚁' },
                    { name: 'GoPro', icon: '📷' },
                    { name: 'Apple', icon: '' },
                    { name: 'Samsung', icon: '📱' },
                    { name: 'Sony', icon: '🎮' },
                    { name: 'PlayStation', icon: '🎯' },
                    { name: 'Xbox', icon: '🕹️' },
                    { name: 'Яндекс', icon: '🔴' },
                    { name: 'JBL', icon: '🔊' },
                    { name: 'Xiaomi', icon: '📲' },
                    { name: 'Nintendo', icon: '🎲' },
                    { name: 'Huawei', icon: '📡' },
                    { name: 'DJI', icon: '🚁' },
                    { name: 'GoPro', icon: '📷' },
                  ].map((brand, i) => (
                    <div key={i} className="flex items-center gap-3 text-gray-400 hover:text-gray-900 transition-colors cursor-pointer">
                      <span className="text-2xl">{brand.icon}</span>
                      <span className="text-xl font-semibold">{brand.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AnimatedSection>
        </Container>
      </section>
      
      {/* Stats Section */}
      <section className="py-16">
        <Container>
          <AnimatedSection>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { value: '10+', label: 'лет на рынке', color: 'text-yellow-500', icon: '🏆' },
                { value: '50K+', label: 'довольных клиентов', color: 'text-green-500', icon: '👥' },
                { value: '1000+', label: 'товаров в каталоге', color: 'text-blue-500', icon: '📦' },
                { value: '99%', label: 'положительных отзывов', color: 'text-purple-500', icon: '⭐' },
              ].map((stat, i) => (
                <div key={i} className="text-center rounded-2xl bg-white p-6 shadow-lg">
                  <div className="text-4xl mb-2">{stat.icon}</div>
                  <div className={`text-4xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="mt-2 text-gray-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </Container>
      </section>

      {/* Featured Product Hero - Apple Style */}
      <Section className="py-32 overflow-hidden">
        <Container>
          <AnimatedSection>
            <div className="relative">
              {/* Background glow */}
              <div 
                className="absolute inset-0 bg-gradient-to-r from-yellow-400/20 via-transparent to-amber-400/20 blur-3xl opacity-50"
                style={{
                  transform: `translate(${mousePosition.x}px, ${mousePosition.y}px)`
                }}
              />
              
              <div className="relative grid lg:grid-cols-2 gap-12 items-center">
                {/* Content */}
                <div className="order-2 lg:order-1">
                  <div className="inline-flex items-center gap-2 rounded-full bg-yellow-400/10 border border-yellow-400/20 px-4 py-2 text-sm font-medium text-yellow-600 mb-6">
                    <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                    Хит продаж
                  </div>
                  
                  <h2 className="text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                    {heroProduct.name}
                  </h2>
                  
                  <p className="text-xl text-gray-500 mb-8 max-w-lg">
                    {heroProduct.description}
                  </p>
                  
                  {/* Specs */}
                  <div className="grid grid-cols-2 gap-4 mb-8">
                    {heroProduct.specs.slice(0, 4).map((spec, i) => (
                      <div key={i} className="rounded-2xl bg-gray-50 p-4">
                        <div className="text-sm text-gray-400 mb-1">{spec.label}</div>
                        <div className="font-semibold text-gray-900">{spec.value}</div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Price & CTA */}
                  <div className="flex items-end gap-6 mb-8">
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Цена</div>
                      <div className="text-4xl font-bold text-gray-900">
                        {heroProduct.price.toLocaleString('ru-RU')} ₽
                      </div>
                    </div>
                    {heroProduct.oldPrice && (
                      <div className="pb-1">
                        <span className="text-xl text-gray-400 line-through">
                          {heroProduct.oldPrice.toLocaleString('ru-RU')} ₽
                        </span>
                        <span className="ml-2 text-green-500 font-medium">
                          -{Math.round((1 - heroProduct.price / heroProduct.oldPrice) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex gap-4">
                    <Button 
                      size="lg" 
                      className="shadow-xl shadow-yellow-400/30"
                      onClick={() => addItem(heroProduct)}
                    >
                      {isInCart(heroProduct.id) ? '✓ В корзине' : 'В корзину'}
                    </Button>
                    <Button to={`/product/${heroProduct.id}`} variant="outline" size="lg">
                      Подробнее
                    </Button>
                  </div>
                </div>
                
                {/* Product Image */}
                <div className="order-1 lg:order-2 relative">
                  <div 
                    className="relative flex items-center justify-center"
                    style={{
                      transform: `translate(${mousePosition.x * 0.5}px, ${mousePosition.y * 0.5}px)`
                    }}
                  >
                    {/* Glow effect */}
                    <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/30 to-amber-400/30 rounded-full blur-3xl scale-75" />
                    
                    {/* Product image or emoji */}
                    {heroProduct.image?.startsWith('http') || heroProduct.image?.startsWith('/uploads') ? (
                      <img 
                        src={heroProduct.image?.startsWith('/uploads') ? `${API_BASE_URL}${heroProduct.image}` : heroProduct.image} 
                        alt={heroProduct.name}
                        className="relative z-10 w-80 h-80 object-contain drop-shadow-2xl transition-transform duration-500 hover:scale-105"
                      />
                    ) : (
                      <span className="text-[20rem] relative z-10 drop-shadow-2xl transition-transform duration-500 hover:scale-105">
                        {heroProduct.image}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </Container>
      </Section>

      {/* Premium Categories Showcase */}
      <Section className="py-24 bg-gradient-to-b from-white to-gray-50">
        <Container>
          <AnimatedSection>
            <div className="mb-16 text-center">
              <span className="inline-block mb-4 rounded-full bg-yellow-100 px-4 py-2 text-sm font-semibold text-yellow-700">
                🛍️ Каталог
              </span>
              <h2 className="mb-4 text-5xl font-bold text-gray-900">
                Найдите свой <span className="text-yellow-500">идеальный</span> гаджет
              </h2>
              <p className="mx-auto max-w-2xl text-xl text-gray-500">
                Выберите категорию и откройте мир технологий с Take Smart
              </p>
            </div>
          </AnimatedSection>
          
          {/* Bento Grid Layout */}
          <div className="grid gap-4 lg:gap-6 auto-rows-[180px] lg:auto-rows-[200px] grid-cols-2 lg:grid-cols-4">
            {/* Large Featured - Smartphones */}
            <AnimatedSection delay={0} className="col-span-2 row-span-2">
              <Link
                to="/catalog?category=smartphones"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8 transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl"
              >
                <div className="relative z-10">
                  <div className="mb-4 inline-flex rounded-2xl bg-yellow-400 p-3">
                    <SmartphoneIcon className="h-6 w-6 text-gray-900" />
                  </div>
                  <h3 className="text-3xl font-bold text-white mb-2">Смартфоны</h3>
                  <p className="text-gray-400 max-w-xs">iPhone, Samsung Galaxy, Xiaomi и другие флагманы</p>
                </div>
                <div className="flex items-center gap-2 text-yellow-400 font-semibold">
                  <span>Смотреть все</span>
                  <ArrowRightIcon className="h-5 w-5 transition-transform group-hover:translate-x-2" />
                </div>
                <div className="absolute -right-8 -bottom-8 text-[12rem] opacity-10 transition-all duration-500 group-hover:opacity-20 group-hover:scale-110">
                  📱
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              </Link>
            </AnimatedSection>
            
            {/* Laptops */}
            <AnimatedSection delay={100}>
              <Link
                to="/catalog?category=laptops"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 to-purple-600 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-5xl">💻</div>
                <div>
                  <h3 className="text-xl font-bold text-white">Ноутбуки</h3>
                  <p className="text-white/70 text-sm">MacBook, Ultrabook</p>
                </div>
              </Link>
            </AnimatedSection>
            
            {/* Tablets */}
            <AnimatedSection delay={150}>
              <Link
                to="/catalog?category=tablets"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-green-400 to-emerald-600 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-5xl">📱</div>
                <div>
                  <h3 className="text-xl font-bold text-white">Планшеты</h3>
                  <p className="text-white/70 text-sm">iPad, Galaxy Tab</p>
                </div>
              </Link>
            </AnimatedSection>
            
            {/* Headphones */}
            <AnimatedSection delay={200}>
              <Link
                to="/catalog?category=headphones"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-pink-500 to-rose-600 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-5xl">🎧</div>
                <div>
                  <h3 className="text-xl font-bold text-white">Наушники</h3>
                  <p className="text-white/70 text-sm">AirPods, Sony</p>
                </div>
              </Link>
            </AnimatedSection>
            
            {/* Watches */}
            <AnimatedSection delay={250}>
              <Link
                to="/catalog?category=watches"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-orange-400 to-amber-600 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-5xl">⌚</div>
                <div>
                  <h3 className="text-xl font-bold text-white">Часы</h3>
                  <p className="text-white/70 text-sm">Apple Watch</p>
                </div>
              </Link>
            </AnimatedSection>
            
            {/* Gaming - Wide */}
            <AnimatedSection delay={300} className="col-span-2">
              <Link
                to="/catalog?category=gaming"
                className="group relative flex h-full items-center gap-6 overflow-hidden rounded-3xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-7xl">🎮</div>
                <div>
                  <h3 className="text-2xl font-bold text-white mb-1">Игровые консоли</h3>
                  <p className="text-white/70">PlayStation 5, Nintendo Switch, Xbox</p>
                </div>
                <ArrowRightIcon className="ml-auto h-8 w-8 text-white/50 transition-transform group-hover:translate-x-2 group-hover:text-white" />
              </Link>
            </AnimatedSection>
            
            {/* Accessories */}
            <AnimatedSection delay={350}>
              <Link
                to="/catalog?category=accessories"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-400 to-sky-600 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-5xl">🔌</div>
                <div>
                  <h3 className="text-xl font-bold text-white">Аксессуары</h3>
                  <p className="text-white/70 text-sm">Чехлы, зарядки</p>
                </div>
              </Link>
            </AnimatedSection>
            
            {/* TV */}
            <AnimatedSection delay={400}>
              <Link
                to="/catalog?category=tv"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-slate-600 to-slate-800 p-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="text-5xl">📺</div>
                <div>
                  <h3 className="text-xl font-bold text-white">ТВ и аудио</h3>
                  <p className="text-white/70 text-sm">Samsung, LG, Sony</p>
                </div>
              </Link>
            </AnimatedSection>
          </div>
          
          {/* CTA */}
          <AnimatedSection delay={500}>
            <div className="mt-12 text-center">
              <Link 
                to="/catalog"
                className="inline-flex items-center gap-3 rounded-full bg-gray-900 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-yellow-400 hover:text-gray-900 hover:scale-105"
              >
                Посмотреть весь каталог
                <ArrowRightIcon className="h-5 w-5" />
              </Link>
            </div>
          </AnimatedSection>
        </Container>
      </Section>

      {/* Featured Products with Horizontal Scroll Feel */}
      <Section className="bg-gray-50 py-24">
        <Container>
          <AnimatedSection>
            <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h2 className="mb-2 text-4xl font-bold text-gray-900">Хиты продаж</h2>
                <p className="text-xl text-gray-500">Самые популярные товары</p>
              </div>
              <Link to="/catalog" className="group flex items-center gap-2 text-yellow-600 font-semibold hover:text-yellow-700">
                Весь каталог
                <ArrowRightIcon className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </AnimatedSection>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featuredProducts.map((product, i) => (
              <AnimatedSection key={product.id} delay={i * 100}>
                <ProductCard product={product} />
              </AnimatedSection>
            ))}
          </div>
        </Container>
      </Section>

      {/* Benefits Section - Apple Style Cards */}
      <Section className="py-24">
        <Container>
          <AnimatedSection>
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-4xl font-bold text-gray-900">Почему выбирают нас</h2>
              <p className="text-xl text-gray-500">Гарантия качества на каждом этапе</p>
            </div>
          </AnimatedSection>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((benefit, i) => (
              <AnimatedSection key={i} delay={i * 100}>
                <div className="group rounded-3xl bg-white p-8 shadow-lg transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 border border-gray-100">
                  <div className="mb-6 inline-flex rounded-2xl bg-yellow-400 p-4 text-gray-900 transition-transform duration-500 group-hover:scale-110">
                    {benefit.icon}
                  </div>
                  <h3 className="mb-3 text-xl font-bold text-gray-900">{benefit.title}</h3>
                  <p className="text-gray-500">{benefit.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </Container>
      </Section>

      {/* Store Location & Contacts */}
      <Section className="bg-gray-50 py-24">
        <Container>
          <AnimatedSection>
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-4xl font-bold text-gray-900">Адрес магазина</h2>
              <p className="text-xl text-gray-500">Приходите к нам в гости</p>
            </div>
          </AnimatedSection>
          
          <AnimatedSection delay={200}>
            <div className="grid gap-8 lg:grid-cols-5 overflow-hidden rounded-3xl bg-white shadow-xl">
              {/* Contacts */}
              <div className="lg:col-span-2 p-8 lg:p-10">
                <h3 className="mb-6 text-xl font-bold text-gray-900">
                  г. Москва, ул. Барклая, д. 10, ТЦ "Багратионовский", 1 этаж, магазин А-27
                </h3>
                
                <div className="space-y-6">
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-1">МЕТРО</div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">М</span>
                      <span className="font-medium">Багратионовская</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-1">РЕЖИМ РАБОТЫ</div>
                    <div className="font-medium">Пн - Вс: 10:00 - 20:00</div>
                    <div className="text-gray-500">Без выходных</div>
                  </div>
                  
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-1">ТЕЛЕФОН</div>
                    <a href="tel:+74952557362" className="block font-medium text-lg hover:text-yellow-600">+7 (495) 255-73-62</a>
                    <a href="tel:+74952557362" className="block font-medium text-lg hover:text-yellow-600">+7 (495) 255-73-62</a>
                  </div>
                  
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-1">E-MAIL</div>
                    <a href="mailto:info@takesmart.ru" className="font-medium hover:text-yellow-600">info@takesmart.ru</a>
                  </div>
                  
                  <Button to="/cart" variant="outline" size="md" className="mt-4 border-yellow-400 text-yellow-600 hover:bg-yellow-400 hover:text-gray-900">
                    Написать сообщение
                  </Button>
                </div>
              </div>
              
              {/* Map */}
              <div className="lg:col-span-3 min-h-[400px]">
                <iframe
                  src="https://yandex.ru/map-widget/v1/?um=constructor%3A7a88a9b3b8e4c9d5f6123456789abcdef&amp;source=constructor&ll=37.495983%2C55.743749&z=16"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  className="min-h-[400px]"
                />
              </div>
            </div>
          </AnimatedSection>
        </Container>
      </Section>

      {/* Customer Reviews */}
      <Section className="py-24">
        <Container>
          <AnimatedSection>
            <div className="mb-8 text-center">
              <h2 className="mb-4 text-4xl font-bold text-gray-900">Мнение наших клиентов</h2>
            </div>
            
            <div className="mb-8 flex flex-wrap items-center justify-center gap-6 text-center">
              <div className="flex items-center gap-2 rounded-full bg-yellow-100 px-4 py-2">
                <span className="text-xl font-bold text-yellow-600">5.0</span>
                <span className="text-yellow-500">★</span>
                <span className="text-gray-500">| 3710 отзывов</span>
              </div>
              <div className="flex gap-6 text-sm text-gray-600">
                <span>Яндекс <span className="font-bold">5.0</span></span>
                <span>2Gis <span className="font-bold">5.0</span></span>
                <span>Авито <span className="font-bold">4.9</span></span>
              </div>
            </div>
            
            <div className="mb-8 flex flex-wrap justify-center gap-2">
              {['цена', 'сервис', 'доставка', 'магазин', 'продукт', 'товар', 'персонал'].map(tag => (
                <span key={tag} className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:border-yellow-400 cursor-pointer transition-colors">
                  {tag}
                </span>
              ))}
            </div>
          </AnimatedSection>
          
          <AnimatedSection delay={200}>
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  name: 'Дима ROFL',
                  date: '10 февраля',
                  source: 'Яндекс',
                  rating: 5,
                  text: 'Номер заказа 203228175C 16.12.25 Покупал IPhone 17. Все прошло отлично, заводская упаковка, оригинал. Доставили до двери в день заказа. Рекомендую!'
                },
                {
                  name: 'Елена Сухарева',
                  date: '10 февраля',
                  source: 'Яндекс',
                  rating: 5,
                  text: 'Мне понравилось покупать в этом магазине. Брали пылесос Дайсон в сентябре 2025. Персонал вежливый, пылесос идеальный, работает исправно.'
                },
                {
                  name: 'Виктор',
                  date: '9 февраля',
                  source: 'Яндекс',
                  rating: 5,
                  text: 'Заказал через сайт PS5slim, привезли день в день. Все оригинальное. Рекомендую!'
                }
              ].map((review, i) => (
                <div key={i} className="rounded-2xl bg-white border border-gray-100 p-6 shadow-sm">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center">
                      <span className="text-red-500 text-2xl">📍</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{review.name}</div>
                      <div className="text-sm text-gray-500">
                        {review.date} на <span className="text-yellow-600">{review.source}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mb-3 flex text-yellow-400">
                    {'★'.repeat(review.rating)}
                  </div>
                  <p className="text-gray-700 line-clamp-4">{review.text}</p>
                  <button className="mt-3 text-sm font-medium text-gray-900 hover:text-yellow-600">
                    Читать дальше
                  </button>
                </div>
              ))}
            </div>
            
            <div className="mt-8 text-center">
              <a 
                href="https://yandex.ru/maps" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-6 py-3 font-semibold text-white hover:bg-green-600 transition-colors"
              >
                Оставить отзыв
              </a>
            </div>
          </AnimatedSection>
        </Container>
      </Section>

      {/* CTA Section */}
      <Section className="py-24">
        <Container>
          <AnimatedSection>
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-yellow-400 to-amber-400 p-12 text-center sm:p-16">
              {/* Background decorations */}
              <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-white/20" />
              <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-white/20" />
              
              <div className="relative z-10">
                <h2 className="mb-4 text-4xl font-bold text-gray-900 sm:text-5xl">
                  Готовы к покупкам?
                </h2>
                <p className="mx-auto mb-8 max-w-2xl text-xl text-gray-800">
                  Оставьте заявку и получите персональную скидку 10% на первый заказ
                </p>
                <div className="flex flex-col justify-center gap-4 sm:flex-row">
                  <Button to="/cart" variant="secondary" size="lg">
                    Оставить заявку
                  </Button>
                  <Button to="/catalog" variant="outline" size="lg" className="border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white">
                    Смотреть каталог
                  </Button>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </Container>
      </Section>

      {/* Trust Badges */}
      <Section className="border-t border-gray-100 py-12">
        <Container>
          <AnimatedSection>
            <div className="flex flex-wrap items-center justify-center gap-8 text-center text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <ShieldIcon className="h-5 w-5 text-green-500" />
                Безопасная оплата
              </div>
              <div className="flex items-center gap-2">
                <TruckIcon className="h-5 w-5 text-blue-500" />
                Бесплатная доставка
              </div>
              <div className="flex items-center gap-2">
                <CardIcon className="h-5 w-5 text-purple-500" />
                Рассрочка без %
              </div>
              <div className="flex items-center gap-2">
                <PhoneIcon className="h-5 w-5 text-yellow-500" />
                Поддержка 24/7
              </div>
            </div>
          </AnimatedSection>
        </Container>
      </Section>
    </div>
  )
}
