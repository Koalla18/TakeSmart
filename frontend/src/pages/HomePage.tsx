import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard } from '../components/ProductCard'
import {
  type ApiProductOut,
  mapApiProduct,
  type Product,
} from '../data/products'
import { API_BASE_URL } from '../lib/config'
import { 
  ShieldIcon, 
  TruckIcon, 
  CardIcon, 
  PhoneIcon, 
  ArrowRightIcon,
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
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const [videoProgress, setVideoProgress] = useState(0)

  // Load featured products from API
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/products/featured?limit=8`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((data: ApiProductOut[]) => {
        if (data.length > 0) setFeaturedProducts(data.map(p => mapApiProduct(p)))
      })
      .catch(() => { /* API error — section stays hidden */ })
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

  return (
    <div className="overflow-hidden">
      {/* Video Hero Section - Apple Style */}
      <section 
        ref={heroRef}
        className="relative min-h-[70vh] sm:min-h-[130vh] bg-gradient-to-b from-black via-black to-gray-900"
      >
        {/* Sticky video container */}
        <div className="sticky top-0 h-[70svh] sm:h-[100svh] overflow-hidden">
          {/* Video background */}
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover object-center"
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
          <div className="relative z-10 flex h-full items-end sm:items-center justify-center pb-28 sm:pb-0">
            <Container>
              <div 
                className="text-center transition-all duration-500"
                style={{
                  opacity: 1 - videoProgress * 1.5,
                  transform: `translateY(${videoProgress * -100}px) scale(${1 - videoProgress * 0.1})`
                }}
              >
                {/* Badge */}
                <div className="mb-4 sm:mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-medium text-white border border-white/20">
                  <span className="flex h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                  Новая коллекция 2026
                </div>
                
                {/* Main heading */}
                <h1 className="mb-4 sm:mb-6 text-4xl font-bold leading-tight text-white sm:text-6xl lg:text-8xl">
                  <span className="block drop-shadow-lg">Умная техника</span>
                  <span className="block bg-gradient-to-r from-yellow-400 to-amber-300 bg-clip-text text-transparent pb-2">
                    будущего
                  </span>
                </h1>
                
                <p className="mx-auto mb-6 sm:mb-10 max-w-2xl text-base sm:text-lg text-gray-300 lg:text-xl">
                  Откройте мир инновационных технологий. Смартфоны, ноутбуки и аксессуары от ведущих брендов с официальной гарантией.
                </p>
                
                <div className="flex flex-col justify-center gap-3 sm:gap-4 sm:flex-row">
                  <Button to="/catalog" size="lg" className="shadow-2xl shadow-yellow-400/30">
                    Смотреть каталог
                    <ArrowRightIcon className="ml-2 h-5 w-5" />
                  </Button>
                  <Button href="https://t.me/takesmart_manager" variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10 backdrop-blur-sm">
                    Написать менеджеру
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
              <div className="text-center mb-8">
                <h2 className="text-lg font-semibold text-gray-900">Официальный партнёр ведущих брендов</h2>
              </div>
              
              {/* Infinite Carousel */}
              <div className="relative overflow-hidden">
                
                <div className="flex animate-marquee gap-12 sm:gap-16 whitespace-nowrap py-4">
                  {[
                    { name: 'Apple', logo: '/logos/apple.svg' },
                    { name: 'Samsung', logo: '/logos/samsung.svg' },
                    { name: 'Sony', logo: '/logos/sony.svg' },
                    { name: 'PlayStation', logo: '/logos/playstation.svg' },
                    { name: 'Xbox', logo: '/logos/xbox.svg' },
                    { name: 'Яндекс', logo: '/logos/yandex.svg' },
                    { name: 'JBL', logo: '/logos/jbl.svg' },
                    { name: 'Xiaomi', logo: '/logos/xiaomi.svg' },
                    { name: 'Nintendo', logo: '/logos/nintendo.svg' },
                    { name: 'Huawei', logo: '/logos/huawei.svg' },
                    { name: 'DJI', logo: '/logos/dji.svg' },
                    { name: 'GoPro', logo: '/logos/gopro.svg' },
                    // Дубликат для бесшовной анимации
                    { name: 'Apple', logo: '/logos/apple.svg' },
                    { name: 'Samsung', logo: '/logos/samsung.svg' },
                    { name: 'Sony', logo: '/logos/sony.svg' },
                    { name: 'PlayStation', logo: '/logos/playstation.svg' },
                    { name: 'Xbox', logo: '/logos/xbox.svg' },
                    { name: 'Яндекс', logo: '/logos/yandex.svg' },
                    { name: 'JBL', logo: '/logos/jbl.svg' },
                    { name: 'Xiaomi', logo: '/logos/xiaomi.svg' },
                    { name: 'Nintendo', logo: '/logos/nintendo.svg' },
                    { name: 'Huawei', logo: '/logos/huawei.svg' },
                    { name: 'DJI', logo: '/logos/dji.svg' },
                    { name: 'GoPro', logo: '/logos/gopro.svg' },
                  ].map((brand, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-center flex-shrink-0 w-[100px] h-[40px] grayscale hover:grayscale-0 opacity-50 hover:opacity-100 transition-all duration-300 cursor-pointer hover:scale-110"
                      title={brand.name}
                    >
                      <img 
                        src={brand.logo} 
                        alt={brand.name}
                        className="max-h-[32px] max-w-[90px] w-auto h-auto object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                          if (fallback) fallback.classList.remove('hidden');
                        }}
                      />
                      <span className="hidden text-lg font-semibold text-gray-500">{brand.name}</span>
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

      {/* Featured Product Hero - HeyApple Style Carousel */}
      <Section className="py-8 lg:py-16 overflow-hidden bg-gray-50">
        <Container>
          <AnimatedSection>
            {(() => {
              type Slide = { badge: string; title: string; description: string; price: string; image: string; color: string; tags: string[]; isNew: boolean }
              const [currentSlide, setCurrentSlide] = useState(0);
              const [slides, setSlides] = useState<Slide[]>([]);

              // Fetch slides from API
              useEffect(() => {
                fetch(`${API_BASE_URL}/api/weekly-slides`)
                  .then(res => res.ok ? res.json() : Promise.reject())
                  .then((data: any[]) => {
                    if (data.length > 0) {
                      setSlides(data.map(s => ({
                        badge: s.badge || '',
                        title: s.title,
                        description: s.description || '',
                        price: s.price,
                        image: s.image || '',
                        color: s.color || 'bg-gradient-to-br from-gray-50 via-white to-gray-100',
                        tags: s.tags || [],
                        isNew: s.is_new || false,
                      })));
                    }
                  })
                  .catch(() => { /* use defaults */ });
              }, []);
              
              const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % slides.length);
              const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
              
              // Auto-slide every 6 seconds
              useEffect(() => {
                const timer = setInterval(() => {
                  setCurrentSlide((prev) => (prev + 1) % slides.length);
                }, 6000);
                return () => clearInterval(timer);
              }, [slides.length]);
              
              if (slides.length === 0) return null;

              return (
                <div className="relative">
                  {/* Section Title */}
                  <div className="mb-8 flex items-center justify-between">
                    <div>
                      <h2 className="text-3xl lg:text-4xl font-bold text-gray-900">Товары недели</h2>
                      <p className="mt-2 text-gray-500">Лучшие предложения от TakeSmart</p>
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Slide counter */}
                      <span className="text-sm text-gray-400 font-medium hidden sm:block">
                        {String(currentSlide + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
                      </span>
                      {/* Navigation Arrows */}
                      <div className="flex gap-3">
                        <button 
                          onClick={prevSlide}
                          className="w-12 h-12 rounded-2xl bg-white/90 backdrop-blur border border-gray-200 flex items-center justify-center hover:bg-gray-900 hover:border-gray-900 transition-all duration-300 group shadow-sm"
                        >
                          <svg className="w-5 h-5 text-gray-700 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <button 
                          onClick={nextSlide}
                          className="w-12 h-12 rounded-2xl bg-white/90 backdrop-blur border border-gray-200 flex items-center justify-center hover:bg-gray-900 hover:border-gray-900 transition-all duration-300 group shadow-sm"
                        >
                          <svg className="w-5 h-5 text-gray-700 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Main Card — crossfade */}
                  <div className="relative rounded-[2rem] overflow-hidden">
                    {/* "Товар недели" rotating badge */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none hidden lg:block">
                      <div className="relative w-28 h-28">
                        <div className="absolute inset-0 rounded-full border border-gray-200/60 bg-white/80 backdrop-blur-md shadow-lg" />
                        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full animate-spin-slow">
                          <defs>
                            <path id="circlePath" d="M 50, 50 m -38, 0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0"/>
                          </defs>
                          <text className="fill-gray-500" style={{ fontSize: '9.5px', letterSpacing: '3px', textTransform: 'uppercase' }}>
                            <textPath href="#circlePath">
                              • товар недели • товар недели 
                            </textPath>
                          </text>
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-3.5 h-3.5 rounded-full bg-gray-900" />
                        </div>
                      </div>
                    </div>

                    {/* Stacked slides — smooth crossfade */}
                    {slides.map((s, idx) => (
                      <div
                        key={idx}
                        aria-hidden={idx !== currentSlide}
                        className={`${idx === 0 ? '' : 'absolute inset-0'} ${s.color} carousel-slide ${
                          idx === currentSlide ? 'carousel-slide-active' : 'carousel-slide-hidden'
                        }`}
                      >
                        <div className="grid lg:grid-cols-2 min-h-[480px] sm:min-h-[580px]">
                          {/* Left - Content */}
                          <div className="relative p-6 sm:p-8 lg:p-12 flex flex-col justify-between">
                            <div className="mb-2 sm:mb-auto">
                              <span className="inline-block rounded-full border border-gray-300 bg-white/80 backdrop-blur px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm text-gray-600">
                                {s.badge}
                              </span>
                            </div>
                            
                            <div className="my-auto">
                              <h2 className="text-3xl sm:text-4xl lg:text-6xl font-bold text-gray-900 mb-3 sm:mb-6 leading-[1.1]">
                                {s.title}
                              </h2>
                              <p className="text-gray-500 mb-4 sm:mb-8 whitespace-pre-line leading-relaxed max-w-md text-sm sm:text-[15px] line-clamp-3 sm:line-clamp-none">
                                {s.description}
                              </p>
                              <div className="flex items-center gap-4 sm:gap-6">
                                <span className="text-xl sm:text-2xl lg:text-3xl font-semibold text-gray-900">
                                  от {s.price} ₽
                                </span>
                                <Link 
                                  to="/catalog"
                                  className="inline-flex items-center justify-center rounded-full bg-blue-500 hover:bg-blue-600 px-6 py-3 sm:px-8 sm:py-3.5 text-sm sm:text-base text-white font-medium transition-all hover:shadow-lg hover:shadow-blue-500/25"
                                >
                                  Подробнее
                                </Link>
                              </div>
                            </div>
                            
                            <div className="hidden sm:grid grid-cols-2 gap-4 mt-8">
                              <Link to="/delivery" className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-lg hover:border-gray-200 transition-all group">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="font-semibold text-gray-900">Доставка и оплата</h4>
                                  <div className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center group-hover:bg-gray-900 group-hover:border-gray-900 transition-all">
                                    <svg className="w-4 h-4 text-gray-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
                                    </svg>
                                  </div>
                                </div>
                                <div className="border-t border-gray-100 pt-3">
                                  <p className="text-sm text-gray-500">Выбирайте подходящий вариант именно для вас.</p>
                                </div>
                              </Link>
                              <Link to="/trade-in" className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-lg hover:border-gray-200 transition-all group">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="font-semibold text-gray-900">Trade-in</h4>
                                  <div className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center group-hover:bg-gray-900 group-hover:border-gray-900 transition-all">
                                    <svg className="w-4 h-4 text-gray-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
                                    </svg>
                                  </div>
                                </div>
                                <div className="border-t border-gray-100 pt-3">
                                  <p className="text-sm text-gray-500">Обменяйте своё старое устройство на новое и получите скидку.</p>
                                </div>
                              </Link>
                            </div>
                          </div>
                          
                          {/* Right - Product Image */}
                          <div className="relative px-6 py-6 sm:py-4 lg:p-12 flex items-center justify-center min-h-[200px] sm:min-h-0">
                            <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex flex-wrap gap-1.5 sm:gap-2 justify-end max-w-[200px] sm:max-w-[300px] z-10">
                              {s.tags.map((tag, j) => (
                                <span 
                                  key={j}
                                  className={`rounded-full px-3 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium ${
                                    tag === 'новинка' || tag === 'хит'
                                      ? 'bg-gray-900 text-white' 
                                      : 'border border-gray-300 bg-white/80 backdrop-blur text-gray-700'
                                  }`}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <img 
                              src={s.image}
                              alt={s.title}
                              className="relative z-0 max-w-[200px] sm:max-w-[280px] lg:max-w-[380px] h-auto object-contain drop-shadow-2xl"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Slide Indicators */}
                  <div className="flex justify-center gap-2 mt-6">
                    {slides.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentSlide(i)}
                        className={`h-1.5 rounded-full transition-all duration-500 ${
                          i === currentSlide ? 'w-10 bg-gray-900' : 'w-4 bg-gray-300 hover:bg-gray-400'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </AnimatedSection>
        </Container>
      </Section>

      {/* Categories Grid — как на скриншоте */}
      <Section className="py-16 sm:py-24 bg-white">
        <Container>
          <AnimatedSection>
            <div className="mb-10 sm:mb-14 text-center">
              <h2 className="mb-3 text-3xl sm:text-5xl font-bold text-gray-900">
                Каталог товаров
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-gray-500">
                Выберите категорию и найдите то, что вам нужно
              </p>
            </div>
          </AnimatedSection>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {[
              { name: 'Смартфоны Apple',      image: '/categories/apple-iphones.png',    link: '/catalog?category=smartphones&brand=apple',   bg: 'bg-blue-50',   hover: 'hover:bg-blue-100' },
              { name: 'Смартфоны на Android', image: '/categories/android-phones.png',   link: '/catalog?category=smartphones',               bg: 'bg-green-50',  hover: 'hover:bg-green-100' },
              { name: 'Ноутбуки, компьютеры', image: '/categories/laptops.png',           link: '/catalog?category=laptops',                   bg: 'bg-purple-50', hover: 'hover:bg-purple-100' },
              { name: 'Планшеты',             image: '/categories/tablets.png',            link: '/catalog?category=tablets',                   bg: 'bg-yellow-50', hover: 'hover:bg-yellow-100' },
              { name: 'Умные часы',           image: '/categories/watches.png',            link: '/catalog?category=watches',                   bg: 'bg-orange-50', hover: 'hover:bg-orange-100' },
              { name: 'Наушники, колонки',    image: '/categories/headphones.png',         link: '/catalog?category=headphones',                bg: 'bg-sky-50',    hover: 'hover:bg-sky-100' },
              { name: 'Аксессуары',           image: '/categories/accessories.png',        link: '/catalog?category=accessories',               bg: 'bg-pink-50',   hover: 'hover:bg-pink-100' },
              { name: 'Игровые приставки',    image: '/categories/gaming.png',             link: '/catalog?category=gaming',                    bg: 'bg-indigo-50', hover: 'hover:bg-indigo-100' },
              { name: 'Все для дома',         image: '/categories/home.png',               link: '/catalog?category=home',                      bg: 'bg-teal-50',   hover: 'hover:bg-teal-100' },
              { name: 'Активный отдых',       image: '/categories/outdoor.png',            link: '/catalog?category=outdoor',                   bg: 'bg-lime-50',   hover: 'hover:bg-lime-100' },
              { name: 'Красота и уход',       image: '/categories/beauty.png',             link: '/catalog?category=beauty',                    bg: 'bg-rose-50',   hover: 'hover:bg-rose-100' },
            ].map((cat, i) => (
              <AnimatedSection key={cat.name} delay={i * 60}>
                <Link
                  to={cat.link}
                  className={`group flex flex-col items-center rounded-2xl sm:rounded-3xl ${cat.bg} ${cat.hover} p-4 sm:p-6 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5`}
                >
                  <div className="w-full aspect-square flex items-center justify-center mb-3 overflow-hidden">
                    <img
                      src={cat.image}
                      alt={cat.name}
                      className="w-full h-full object-contain drop-shadow-sm transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <span className="text-[11px] sm:text-xs font-bold text-gray-800 uppercase tracking-wider text-center leading-tight">
                    {cat.name}
                  </span>
                </Link>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection delay={700}>
            <div className="mt-10 sm:mt-14 text-center">
              <Link
                to="/catalog"
                className="inline-flex items-center gap-3 rounded-full bg-gray-900 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-yellow-400 hover:text-gray-900 hover:scale-105"
              >
                Весь каталог
                <ArrowRightIcon className="h-5 w-5" />
              </Link>
            </div>
          </AnimatedSection>
        </Container>
      </Section>

      {/* Featured Products with Horizontal Scroll Feel */}
      {featuredProducts.length > 0 && (
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
      )}

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
                <div className="group h-full rounded-3xl bg-white p-8 shadow-lg transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 border border-gray-100">
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
      <Section id="contacts" className="bg-gray-50 py-24">
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
                  г. Москва, ул. Барклая, д. 10, ТЦ «Багратионовский», павильон А60
                </h3>
                
                <div className="space-y-6">
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-1">МЕТРО</div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] text-white">М</span>
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
                    <a href="tel:+79998021022" className="block font-medium text-lg hover:text-yellow-600">+7 (999) 802-10-22</a>
                  </div>
                  
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-1">E-MAIL</div>
                    <a href="mailto:takesmart99@gmail.com" className="font-medium hover:text-yellow-600">takesmart99@gmail.com</a>
                  </div>
                  
                  <Button to="/cart" variant="outline" size="md" className="mt-4 border-yellow-400 text-yellow-600 hover:bg-yellow-400 hover:text-gray-900">
                    Написать сообщение
                  </Button>
                </div>
              </div>
              
              {/* Map */}
              <div className="lg:col-span-3 min-h-[400px]">
                <iframe
                  src="https://yandex.ru/map-widget/v1/?ll=37.499283%2C55.743401&z=17&l=map&pt=37.499283%2C55.743401%2Corg"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  className="min-h-[400px] rounded-2xl"
                  title="TakeSmart на карте"
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
                <span className="text-gray-500">| 1518 отзывов</span>
              </div>
              <div className="flex gap-6 text-sm text-gray-600">
                <a href="https://yandex.ru/maps/org/takesmart/159717386486" target="_blank" rel="noopener noreferrer" className="hover:text-yellow-600">
                  Яндекс <span className="font-bold">5.0</span>
                </a>
                <a href="https://www.avito.ru/brands/takesmart/all?sellerId=a434514ec122f52f3718339ace6d3b4d" target="_blank" rel="noopener noreferrer" className="hover:text-[#00aaff]">
                  Авито <span className="font-bold">5.0</span>
                </a>
              </div>
            </div>
          </AnimatedSection>
          
          <AnimatedSection delay={200}>
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  name: 'Артём Киц-Ковязин',
                  date: '1 декабря 2025',
                  source: 'Яндекс Карты',
                  rating: 5,
                  text: 'Брал тут 2 айфона 17 про макс на 512. Все супер. Быстро договорились, продавцы очень профессиональные и приятные! Бонусом поклеили защитное стекло и подарили чехлы.'
                },
                {
                  name: 'Анна С.',
                  date: '26 октября 2025',
                  source: 'Яндекс Карты',
                  rating: 5,
                  text: 'Совершила сегодня свою долгожданную покупку нового телефона в этом замечательном месте! Помимо приятнейших цен и большого ассортимента, хочется отметить отношение внимательных и приветливых молодых людей к каждому клиенту!'
                },
                {
                  name: 'Влад',
                  date: '27 января 2026',
                  source: 'Яндекс Карты',
                  rating: 5,
                  text: 'Магазин просто бомбовый, обслуживание на наивысшем уровне, дали вкусных конфет, обслужили юмором, позитивным настроением, а главное — быстрым и чётким обслуживанием!🙏'
                },
                {
                  name: 'Александр Д.',
                  date: '29 ноября 2025',
                  source: 'Яндекс Карты',
                  rating: 5,
                  text: 'На днях покупал iPhone 16 чёрный на 128гб, все сделали хорошо, на упаковке айфона были все пломбы + проверил по серийному номеру на сайте. Приятная цена и отличное обслуживание!'
                },
                {
                  name: 'Антон Аношкин',
                  date: '3 ноября 2025',
                  source: 'Яндекс Карты',
                  rating: 5,
                  text: 'Купил сегодня жене 17 pro max и Apple Watch 11. Товар оригинальный, цены хорошие. Есть возможность оплатить по карте. Могу советовать данный магазин!'
                },
                {
                  name: 'Регина Хамзина',
                  date: '1 августа 2025',
                  source: 'Яндекс Карты',
                  rating: 5,
                  text: 'Огромное спасибо ребятам! Приобрела новенький iPhone 16 pro, сдав свой 12 по трейд-ин. Самая адекватная цена, без накруток. Телефон оригинальный!'
                },
                {
                  name: 'Дмитрий К.',
                  date: '14 января 2026',
                  source: 'Авито',
                  rating: 5,
                  text: 'Отличный магазин! Брал iPhone 15 Pro Max, всё оформили быстро, упаковка запечатана. Цена ниже чем в официальных магазинах. Меняли 12 про на 15 про макс по хорошему курсу трейд-ин — всё честно и прозрачно.'
                },
                {
                  name: 'Марина Соколова',
                  date: '3 февраля 2026',
                  source: 'Авито',
                  rating: 5,
                  text: 'Покупала AirPods Pro 2 — доставили на следующий день, аксессуары оригинальные. Ребята очень внимательные, ответили на все вопросы. Буду обращаться ещё!'
                }
              ].map((review, i) => (
                <div key={i} className="rounded-2xl bg-white border border-gray-100 p-6 shadow-sm">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center">
                      {review.source === 'Авито' ? (
                        <span className="text-[10px] font-black text-white rounded px-1 py-0.5" style={{background:'#00aaff'}}>АВИТО</span>
                      ) : (
                        <span className="text-red-500 text-2xl">📍</span>
                      )}
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
                  <p className="text-gray-700">{review.text}</p>
                </div>
              ))}
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
                  <Button href="https://t.me/takesmart_manager" variant="secondary" size="lg">
                    Написать менеджеру
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
