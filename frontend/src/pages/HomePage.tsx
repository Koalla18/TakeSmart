import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
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

// ─────────────────────────────────────────────────────────────────────────────
// Анимированная секция (fade-in при скролле). Используется ТОЛЬКО ниже первого
// экрана — первый экран (hero + Топ-10) рендерится сразу видимым, чтобы не
// задерживать LCP.
// ─────────────────────────────────────────────────────────────────────────────
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

function AnimatedSection({
  children,
  className = '',
  delay = 0,
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
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO: слайдер промо-баннеров (заменил видео-блок).
// Палитра — текущая takesmart: белый фон, чёрный текст, жёлтый акцент.
// Контейнер фиксированной высоты (первый слайд задаёт высоту) → CLS = 0.
// ─────────────────────────────────────────────────────────────────────────────
interface Banner {
  badge: string
  title: string
  highlight: string
  description: string
  image: string
  cta: { label: string; to?: string; href?: string }
  secondary?: { label: string; to?: string; href?: string }
}

const HERO_BANNERS: Banner[] = [
  {
    badge: 'Новая коллекция 2026',
    title: 'Умная техника',
    highlight: 'будущего',
    description:
      'Смартфоны, ноутбуки и аксессуары от ведущих брендов с официальной гарантией.',
    image: '/iphone-17-pro.png',
    cta: { label: 'Смотреть каталог', to: '/catalog' },
    secondary: { label: 'Написать менеджеру', href: 'https://t.me/takesmart_manager' },
  },
  {
    badge: 'Trade-in',
    title: 'Обменяй старое',
    highlight: 'на новое',
    description:
      'Сдайте свой гаджет и получите скидку на новую технику. Оценка за пару минут.',
    image: '/watch-ultra-2.png',
    cta: { label: 'Узнать про Trade-in', to: '/trade-in' },
    secondary: { label: 'В каталог', to: '/catalog' },
  },
  {
    badge: 'Доставка по Москве',
    title: 'Привезём',
    highlight: 'за 30 минут',
    description:
      'Быстрая доставка и удобные способы оплаты — наличными, картой или в рассрочку.',
    image: '/iphone-15-blue.png',
    cta: { label: 'Доставка и оплата', to: '/delivery' },
    secondary: { label: 'В каталог', to: '/catalog' },
  },
]

function HeroBannerSlider() {
  const [current, setCurrent] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const count = HERO_BANNERS.length

  const next = useCallback(() => setCurrent(p => (p + 1) % count), [count])
  const prev = useCallback(() => setCurrent(p => (p - 1 + count) % count), [count])

  useEffect(() => {
    const timer = setInterval(next, 6000)
    return () => clearInterval(timer)
  }, [next])

  const onTouchEnd = (endX: number) => {
    if (touchStartX === null) return
    const dx = endX - touchStartX
    if (Math.abs(dx) > 50) (dx < 0 ? next : prev)()
    setTouchStartX(null)
  }

  return (
    <section className="bg-white pt-4 sm:pt-6">
      <Container>
        <div
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-50 via-white to-gray-100 ring-1 ring-gray-100"
          onTouchStart={e => setTouchStartX(e.touches[0].clientX)}
          onTouchEnd={e => onTouchEnd(e.changedTouches[0].clientX)}
        >
          {HERO_BANNERS.map((b, idx) => (
            <div
              key={idx}
              aria-hidden={idx !== current}
              className={`${idx === 0 ? '' : 'absolute inset-0'} carousel-slide ${
                idx === current ? 'carousel-slide-active' : 'carousel-slide-hidden'
              }`}
            >
              <div className="grid min-h-[440px] items-center gap-4 sm:min-h-[480px] lg:min-h-[520px] lg:grid-cols-2">
                {/* Текст */}
                <div className="order-2 px-6 pb-8 sm:px-10 lg:order-1 lg:py-12 lg:pl-14">
                  <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 sm:text-sm">
                    <span className="h-2 w-2 rounded-full bg-yellow-400" />
                    {b.badge}
                  </span>
                  <h1 className="mt-4 text-4xl font-bold leading-[1.05] text-gray-900 sm:mt-6 sm:text-5xl lg:text-6xl">
                    <span className="block">{b.title}</span>
                    <span className="block text-yellow-500">{b.highlight}</span>
                  </h1>
                  <p className="mt-4 max-w-md text-base leading-7 text-gray-500 sm:mt-6 sm:text-lg">
                    {b.description}
                  </p>
                  <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row">
                    <Button to={b.cta.to} href={b.cta.href} size="md" className="w-full sm:w-auto sm:px-8">
                      {b.cta.label}
                      <ArrowRightIcon className="ml-2 h-5 w-5" />
                    </Button>
                    {b.secondary && (
                      <Button
                        to={b.secondary.to}
                        href={b.secondary.href}
                        variant="outline"
                        size="md"
                        className="w-full border-gray-300 text-gray-900 hover:bg-gray-900 hover:text-white sm:w-auto sm:px-8"
                      >
                        {b.secondary.label}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Картинка */}
                <div className="order-1 flex items-center justify-center px-6 pt-8 lg:order-2 lg:py-12 lg:pr-14">
                  <img
                    src={b.image}
                    alt={`${b.title} ${b.highlight}`}
                    width={420}
                    height={420}
                    loading={idx === 0 ? 'eager' : 'lazy'}
                    fetchPriority={idx === 0 ? 'high' : 'low'}
                    decoding="async"
                    className="h-48 w-auto object-contain drop-shadow-2xl sm:h-64 lg:h-80"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Стрелки (десктоп) */}
          <button
            onClick={prev}
            aria-label="Предыдущий слайд"
            className="absolute left-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-gray-700 backdrop-blur transition-all hover:bg-gray-900 hover:text-white lg:flex"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={next}
            aria-label="Следующий слайд"
            className="absolute right-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-gray-700 backdrop-blur transition-all hover:bg-gray-900 hover:text-white lg:flex"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Точки */}
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2">
            {HERO_BANNERS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                aria-label={`Слайд ${i + 1}`}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === current ? 'w-8 bg-gray-900' : 'w-3 bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>
        </div>
      </Container>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Топ-10 популярных товаров (сетка карточек) + кнопка «Перейти в каталог».
// Данные — featured (is_featured) с бэкенда, limit=10.
// ─────────────────────────────────────────────────────────────────────────────
function TopProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/api/products/featured?limit=10`)
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: ApiProductOut[]) => {
        if (!cancelled && Array.isArray(data)) setProducts(data.map(p => mapApiProduct(p)))
      })
      .catch(() => { /* API offline — покажем только кнопку каталога */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <Section className="bg-white py-10 sm:py-14">
      <Container>
        <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:mb-8 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">Топ-10 популярных</h2>
            <p className="mt-2 text-gray-500">Самые востребованные товары этой недели</p>
          </div>
          <Link
            to="/catalog"
            className="group hidden items-center gap-2 font-semibold text-gray-900 hover:text-yellow-600 sm:flex"
          >
            Весь каталог
            <ArrowRightIcon className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : null}

        <div className="mt-8 text-center sm:mt-10">
          <Link
            to="/catalog"
            className="inline-flex items-center gap-3 rounded-full bg-gray-900 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-yellow-400 hover:text-gray-900 hover:scale-105"
          >
            Перейти в каталог
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
        </div>
      </Container>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Товары недели — карусель промо-слайдов (данные из админки, /api/weekly-slides).
// НЕ удалять без согласования владельца (см. ТЗ, п.4).
// ─────────────────────────────────────────────────────────────────────────────
interface Slide {
  badge: string
  title: string
  description: string
  price: string
  image: string
  color: string
  tags: string[]
  isNew: boolean
  link_url: string
}

function WeeklySlides() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [slides, setSlides] = useState<Slide[]>([])

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/weekly-slides`)
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: any[]) => {
        if (data.length > 0) {
          setSlides(
            data.map(s => ({
              badge: s.badge || '',
              title: s.title,
              description: s.description || '',
              price: s.price,
              image: s.image || '',
              color: s.color || 'bg-gradient-to-br from-gray-50 via-white to-gray-100',
              tags: s.tags || [],
              isNew: s.is_new || false,
              link_url: s.link_url || '',
            }))
          )
        }
      })
      .catch(() => { /* API offline — секция скрыта */ })
  }, [])

  const nextSlide = useCallback(() => setCurrentSlide(prev => (prev + 1) % slides.length), [slides.length])
  const prevSlide = useCallback(() => setCurrentSlide(prev => (prev - 1 + slides.length) % slides.length), [slides.length])

  useEffect(() => {
    if (slides.length === 0) return
    const timer = setInterval(nextSlide, 6000)
    return () => clearInterval(timer)
  }, [slides.length, nextSlide])

  if (slides.length === 0) return null

  return (
    <div className="relative">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 lg:text-4xl">Товары недели</h2>
          <p className="mt-2 text-gray-500">Лучшие предложения от TakeSmart</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm font-medium text-gray-400 sm:block">
            {String(currentSlide + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
          </span>
          <div className="flex gap-3">
            <button
              onClick={prevSlide}
              aria-label="Предыдущий"
              className="group flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-white/90 shadow-sm backdrop-blur transition-all duration-300 hover:border-gray-900 hover:bg-gray-900"
            >
              <svg className="h-5 w-5 text-gray-700 transition-colors group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={nextSlide}
              aria-label="Следующий"
              className="group flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-white/90 shadow-sm backdrop-blur transition-all duration-300 hover:border-gray-900 hover:bg-gray-900"
            >
              <svg className="h-5 w-5 text-gray-700 transition-colors group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[2rem]">
        {slides.map((s, idx) => (
          <div
            key={idx}
            aria-hidden={idx !== currentSlide}
            className={`${idx === 0 ? '' : 'absolute inset-0'} ${s.color} carousel-slide ${
              idx === currentSlide ? 'carousel-slide-active' : 'carousel-slide-hidden'
            }`}
          >
            <div className="grid min-h-[480px] sm:min-h-[580px] lg:grid-cols-2">
              <div className="relative flex flex-col justify-between p-6 sm:p-8 lg:p-12">
                <div className="mb-2 sm:mb-auto">
                  <span className="inline-block rounded-full border border-gray-300 bg-white/80 px-3 py-1.5 text-xs text-gray-600 backdrop-blur sm:px-4 sm:py-2 sm:text-sm">
                    {s.badge}
                  </span>
                </div>
                <div className="my-auto">
                  <h2 className="mb-3 text-3xl font-bold leading-[1.1] text-gray-900 sm:mb-6 sm:text-4xl lg:text-6xl">
                    {s.title}
                  </h2>
                  <p className="mb-4 max-w-md whitespace-pre-line text-sm leading-relaxed text-gray-500 line-clamp-3 sm:mb-8 sm:text-[15px] sm:line-clamp-none">
                    {s.description}
                  </p>
                  <div className="flex items-center gap-4 sm:gap-6">
                    <span className="text-xl font-semibold text-gray-900 sm:text-2xl lg:text-3xl">от {s.price} ₽</span>
                    <Link
                      to={s.link_url || '/catalog'}
                      className="inline-flex items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-all hover:bg-yellow-400 hover:text-gray-900 sm:px-8 sm:py-3.5 sm:text-base"
                    >
                      Подробнее
                    </Link>
                  </div>
                </div>
              </div>
              <div className="relative flex min-h-[200px] items-center justify-center px-6 py-6 sm:min-h-0 sm:py-4 lg:p-12">
                <div className="absolute right-4 top-4 z-10 flex max-w-[200px] flex-wrap justify-end gap-1.5 sm:right-6 sm:top-6 sm:max-w-[300px] sm:gap-2">
                  {s.tags.map((tag, j) => (
                    <span
                      key={j}
                      className={`rounded-full px-3 py-1 text-xs font-medium sm:px-4 sm:py-2 sm:text-sm ${
                        tag === 'новинка' || tag === 'хит'
                          ? 'bg-gray-900 text-white'
                          : 'border border-gray-300 bg-white/80 text-gray-700 backdrop-blur'
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <img
                  src={s.image}
                  alt={s.title}
                  loading="lazy"
                  decoding="async"
                  className="relative z-0 h-auto max-w-[200px] object-contain drop-shadow-2xl sm:max-w-[280px] lg:max-w-[380px]"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            aria-label={`Слайд ${i + 1}`}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i === currentSlide ? 'w-10 bg-gray-900' : 'w-4 bg-gray-300 hover:bg-gray-400'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

const benefits = [
  { icon: <ShieldIcon className="h-8 w-8" />, title: 'Гарантия до 3 лет', description: 'Официальная гарантия на всю технику' },
  { icon: <TruckIcon className="h-8 w-8" />, title: 'Доставка от 30 минут', description: 'Быстрая доставка по Москве' },
  { icon: <CardIcon className="h-8 w-8" />, title: 'Одобрение кредита от 5 мин', description: 'Без первого взноса' },
  { icon: <PhoneIcon className="h-8 w-8" />, title: 'Поддержка 24/7', description: 'Ответим на любой вопрос' },
]

const BRANDS = [
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
]

export function HomePage() {
  return (
    <div className="overflow-hidden">
      {/* 1. Слайдер баннеров (вместо видео) */}
      <HeroBannerSlider />

      {/* 2. Топ-10 популярных + кнопка «Перейти в каталог» */}
      <TopProducts />

      {/* 3. Бренды-партнёры (бесконечная лента) */}
      <section className="bg-white py-4">
        <Container>
          <AnimatedSection>
            <div className="overflow-hidden rounded-3xl bg-white p-8 shadow-xl shadow-black/5 ring-1 ring-gray-100 sm:p-10">
              <div className="mb-8 text-center">
                <h2 className="text-lg font-semibold text-gray-900">Официальный партнёр ведущих брендов</h2>
              </div>
              <div className="relative overflow-hidden">
                <div className="flex animate-marquee gap-12 whitespace-nowrap py-4 sm:gap-16">
                  {[...BRANDS, ...BRANDS].map((brand, i) => (
                    <div
                      key={i}
                      className="flex h-[40px] w-[100px] flex-shrink-0 cursor-pointer items-center justify-center opacity-50 grayscale transition-all duration-300 hover:scale-110 hover:opacity-100 hover:grayscale-0"
                      title={brand.name}
                    >
                      <img
                        src={brand.logo}
                        alt={brand.name}
                        loading="lazy"
                        decoding="async"
                        className="h-auto max-h-[32px] w-auto max-w-[90px] object-contain"
                        onError={e => {
                          e.currentTarget.style.display = 'none'
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement
                          if (fallback) fallback.classList.remove('hidden')
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

      {/* 4. Товары недели (НЕ удалять — согласование владельца) */}
      <Section className="overflow-hidden bg-gray-50 py-8 lg:py-16">
        <Container>
          <AnimatedSection>
            <WeeklySlides />
          </AnimatedSection>
        </Container>
      </Section>

      {/* Секция «Каталог товаров» (сетка категорий) убрана с лендинга по просьбе
          владельца — каталог теперь в мега-меню хедера. Код сохранён в памяти
          (landing-catalog-section-removed) и в git-истории, легко вернуть. */}

      {/* 6. Почему мы (гарантия/доставка/кредит/поддержка) */}
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
                <div className="group h-full rounded-3xl border border-gray-100 bg-white p-8 shadow-lg transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl">
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

      {/* 7. Статистика (после блока «Почему мы» — по просьбе владельца) */}
      <section className="py-16">
        <Container>
          <AnimatedSection>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { value: '10+', label: 'лет на рынке', color: 'text-yellow-500', icon: '🏆' },
                { value: '50K+', label: 'довольных клиентов', color: 'text-gray-900', icon: '👥' },
                { value: '1000+', label: 'товаров в каталоге', color: 'text-gray-900', icon: '📦' },
                { value: '99%', label: 'положительных отзывов', color: 'text-yellow-500', icon: '⭐' },
              ].map((stat, i) => (
                <div key={i} className="rounded-2xl bg-white p-6 text-center shadow-lg">
                  <div className="mb-2 text-4xl">{stat.icon}</div>
                  <div className={`text-4xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="mt-2 text-gray-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </Container>
      </section>

      {/* 8. Адрес и контакты */}
      <Section id="contacts" className="bg-gray-50 py-24">
        <Container>
          <AnimatedSection>
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-4xl font-bold text-gray-900">Адрес магазина</h2>
              <p className="text-xl text-gray-500">Приходите к нам в гости</p>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={200}>
            <div className="grid gap-8 overflow-hidden rounded-3xl bg-white shadow-xl lg:grid-cols-5">
              <div className="p-8 lg:col-span-2 lg:p-10">
                <h3 className="mb-6 text-xl font-bold text-gray-900">
                  г. Москва, ул. Барклая, д. 10, ТЦ «Багратионовский», павильон А60
                </h3>
                <div className="space-y-6">
                  <div>
                    <div className="mb-1 text-sm font-medium text-gray-500">МЕТРО</div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] text-white">М</span>
                      <span className="font-medium">Багратионовская</span>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-gray-500">РЕЖИМ РАБОТЫ</div>
                    <div className="font-medium">Пн - Вс: 10:00 - 20:00</div>
                    <div className="text-gray-500">Без выходных</div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-gray-500">ТЕЛЕФОН</div>
                    <a href="tel:+79998021022" className="block text-lg font-medium hover:text-yellow-600">+7 (999) 802-10-22</a>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-gray-500">E-MAIL</div>
                    <a href="mailto:takesmart99@gmail.com" className="font-medium hover:text-yellow-600">takesmart99@gmail.com</a>
                  </div>
                  <Button to="/cart" variant="outline" size="md" className="mt-4 border-yellow-400 text-yellow-600 hover:bg-yellow-400 hover:text-gray-900">
                    Написать сообщение
                  </Button>
                </div>
              </div>

              <div className="min-h-[400px] lg:col-span-3">
                <iframe
                  src="https://yandex.ru/map-widget/v1/?ll=37.499283%2C55.743401&z=17&l=map&pt=37.499283%2C55.743401%2Corg"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  loading="lazy"
                  className="min-h-[400px] rounded-2xl"
                  title="TakeSmart на карте"
                />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-center">
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
        </Container>
      </Section>

      {/* 9. CTA */}
      <Section className="py-24">
        <Container>
          <AnimatedSection>
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-yellow-400 to-amber-400 p-12 text-center sm:p-16">
              <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-white/20" />
              <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-white/20" />
              <div className="relative z-10">
                <h2 className="mb-8 text-4xl font-bold text-gray-900 sm:text-5xl">Готовы к покупкам?</h2>
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

      {/* 10. Trust badges */}
      <Section className="border-t border-gray-100 py-12">
        <Container>
          <AnimatedSection>
            <div className="flex flex-wrap items-center justify-center gap-8 text-center text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <ShieldIcon className="h-5 w-5 text-yellow-500" />
                Безопасная оплата
              </div>
              <div className="flex items-center gap-2">
                <TruckIcon className="h-5 w-5 text-gray-700" />
                Доставка от 500 ₽
              </div>
              <div className="flex items-center gap-2">
                <CardIcon className="h-5 w-5 text-gray-700" />
                Кредит
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
