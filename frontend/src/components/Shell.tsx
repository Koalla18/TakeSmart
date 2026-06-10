import type { PropsWithChildren } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from './Logo'
import { PhoneIcon, MailIcon, ClockIcon, MenuIcon, CloseIcon, TelegramIcon, ChevronRightIcon } from './ui/Icons'
import { Container } from './ui/Layout'
import { useCart } from '../lib/cart'
import { GlobalSearch, MobileSearchButton } from './GlobalSearch'
import { API_BASE_URL } from '../lib/config'

function NavItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `relative px-1 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'text-yellow-500'
            : 'text-gray-700 hover:text-yellow-500'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {label}
          {isActive && (
            <span className="absolute -bottom-1 left-0 h-0.5 w-full bg-yellow-400" />
          )}
        </>
      )}
    </NavLink>
  )
}

const legalDocumentPaths = ['/offer', '/privacy-policy', '/personal-data', '/cookie-policy']

function MobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {

  const [categories, setCategories] = useState<any[]>([])
  const [brandsByCategory, setBrandsByCategory] = useState<Record<string, string[]>>({})
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)
  const [dataFetched, setDataFetched] = useState(false)
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen || dataFetched) return;
    setDataFetched(true);
    
    Promise.all([
      fetch(`${API_BASE_URL}/api/categories?limit=100&only_active=true`).then(r => r.json()),
      fetch(`${API_BASE_URL}/api/products?limit=2500&only_active=true`).then(r => r.json())
    ])
    .then(([catData, prodData]) => {
      const cats = Array.isArray(catData) ? catData : (catData.items || [])
      setCategories(cats.filter((c: any) => !c.name.toLowerCase().includes('б/у')))
      
      const prods = Array.isArray(prodData) ? prodData : (prodData.items || [])
      const bMap: Record<string, Set<string>> = {}
      prods.forEach((p: any) => {
        if (!p.category_id || !p.brand) return
        if (!bMap[p.category_id]) bMap[p.category_id] = new Set()
        bMap[p.category_id].add(p.brand)
      })
      const finalMap: Record<string, string[]> = {}
      for (const [cid, set] of Object.entries(bMap)) {
        finalMap[cid] = Array.from(set).sort()
      }
      setBrandsByCategory(finalMap)
    })
    .catch(console.error)
  }, [isOpen, dataFetched])


  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])
  
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      
      {/* Menu panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-sm transform bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <Logo />
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              <CloseIcon />
            </button>
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-4 py-6">
            <div className="space-y-1">
              {[
                { to: '/', label: 'Главная' },
                { to: '/catalog', label: 'Каталог' },
                { to: '/delivery', label: 'Доставка и оплата' },
                { to: '/trade-in', label: 'Trade-in' },
                { to: '/cart', label: 'Корзина' },
              ].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-xl px-4 py-3 text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-yellow-50 text-yellow-600'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`
                  }
                >
                  {item.label}
                  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                </NavLink>
              ))}
            </div>
            
            {/* Categories quick links */}
            <div className="mt-8">
              <h3 className="mb-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Категории
              </h3>
              <div className="space-y-1">
                {categories.map(cat => {
                  let icon = '📦';
                  const name = cat.name.toLowerCase();
                  if (name.includes('смартфоны') || name.includes('телефон')) icon = '📱';
                  else if (name.includes('ноутбук')) icon = '💻';
                  else if (name.includes('наушник')) icon = '🎧';
                  else if (name.includes('час')) icon = '⌚';
                  else if (name.includes('планшет')) icon = '📱';
                  else if (name.includes('аксессуар')) icon = '🔌';
                  else if (name.includes('консол') || name.includes('игр')) icon = '🎮';
                  else if (name.includes('тв') || name.includes('аудио') || name.includes('телевизор')) icon = '📺';
                  else if (name.includes('красот') || name.includes('уход')) icon = '✨';
                  else if (name.includes('дом')) icon = '🏠';
                  else if (name.includes('фото') || name.includes('видео')) icon = '📷';

                  const brands = brandsByCategory[cat.id] || [];

                  return (
                    <div key={cat.id} className="flex flex-col">
                      <button
                        onClick={() => {
                          if (brands.length > 0) {
                            setExpandedCatId(expandedCatId === cat.id ? null : cat.id);
                          } else {
                            onClose();
                            navigate(`/catalog?category=${cat.slug}`);
                          }
                        }}
                        className="flex items-center justify-between rounded-xl px-4 py-3 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{icon}</span>
                          <span>{cat.name}</span>
                        </div>
                        {brands.length > 0 && (
                          <ChevronRightIcon className={`h-4 w-4 text-gray-400 transition-transform ${expandedCatId === cat.id ? 'rotate-90' : ''}`} />
                        )}
                      </button>
                      
                      {expandedCatId === cat.id && brands.length > 0 && (
                        <div className="ml-12 mt-1 flex flex-col space-y-2 border-l border-gray-100 pl-4">
                          {brands.map(brand => (
                            <button
                              key={brand}
                              onClick={() => {
                                onClose();
                                navigate(`/catalog?category=${cat.slug}&brand=${brand.toLowerCase()}`);
                              }}
                              className="text-left py-1 text-sm text-gray-600 hover:text-gray-900"
                            >
                              {brand}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </nav>
          
          {/* Footer */}
          <div className="border-t border-gray-100 px-6 py-4">
            <a
              href="tel:+79998021022"
              className="mb-3 flex items-center gap-3 text-lg font-semibold text-gray-900 hover:text-yellow-500"
            >
              <PhoneIcon className="h-5 w-5 text-yellow-500" />
              +7 (999) 802-10-22
            </a>
            <p className="text-sm text-gray-500">Ежедневно с 10:30 до 20:30</p>
          </div>
        </div>
      </div>
    </>
  )
}

function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false)
  
  useEffect(() => {
    const consentKey = 'cookie-consent'
    const consentTtl = 1000 * 60 * 60 * 24 * 365
    const storedConsent = localStorage.getItem(consentKey)

    if (storedConsent) {
      if (storedConsent === 'true') {
        localStorage.setItem(consentKey, JSON.stringify({ accepted: true, acceptedAt: Date.now() }))
        return
      }

      try {
        const parsed = JSON.parse(storedConsent) as { accepted?: boolean; acceptedAt?: number }
        if (parsed.accepted && parsed.acceptedAt && Date.now() - parsed.acceptedAt < consentTtl) {
          return
        }
      } catch {
        localStorage.removeItem(consentKey)
      }
    }

    const timer = window.setTimeout(() => setIsVisible(true), 1200)
    return () => window.clearTimeout(timer)
  }, [])
  
  const accept = () => {
    localStorage.setItem('cookie-consent', JSON.stringify({ accepted: true, acceptedAt: Date.now() }))
    setIsVisible(false)
  }
  
  if (!isVisible) return null
  
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:bottom-6 sm:px-6 md:bottom-0 md:px-0 md:pb-0">
      <div
        role="dialog"
        aria-labelledby="cookie-consent-title"
        className="mx-auto max-w-xl rounded-2xl border border-yellow-200 bg-white p-5 text-center shadow-2xl shadow-gray-900/20 sm:p-7 md:max-w-none md:rounded-none md:border-x-0 md:border-b-0 md:bg-white/95 md:px-0 md:py-3 md:text-left md:backdrop-blur"
      >
        <div className="md:flex md:w-full md:items-center md:justify-between md:gap-5 md:px-8 xl:px-12 2xl:px-16">
          <div className="md:flex md:min-w-0 md:items-baseline md:gap-3">
            <h2 id="cookie-consent-title" className="text-xl font-extrabold text-gray-900 sm:text-2xl md:flex-shrink-0 md:text-base">
              Мы используем cookie
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-700 sm:text-lg md:hidden">
              Этот сайт использует файлы cookies для работы сервиса, аналитики и улучшения
              пользовательского опыта. Продолжая использовать сайт, вы соглашаетесь с обработкой
              файлов cookies в соответствии с{' '}
              <Link
                to="/cookie-policy"
                className="font-semibold text-yellow-700 underline decoration-yellow-500 underline-offset-4 transition-colors hover:text-gray-900"
              >
                Политикой использования cookie
              </Link>
              .
            </p>
            <p className="hidden text-sm leading-6 text-gray-700 md:block xl:hidden">
              Сайт использует cookies. Продолжая работу, вы соглашаетесь с{' '}
              <Link
                to="/cookie-policy"
                className="font-semibold text-yellow-700 underline decoration-yellow-500 underline-offset-4 transition-colors hover:text-gray-900"
              >
                политикой cookie
              </Link>
              .
            </p>
            <p className="hidden text-sm leading-6 text-gray-700 xl:block xl:whitespace-nowrap">
              Сайт использует cookies для работы сервиса и аналитики. Продолжая работу, вы соглашаетесь с{' '}
              <Link
                to="/cookie-policy"
                className="font-semibold text-yellow-700 underline decoration-yellow-500 underline-offset-4 transition-colors hover:text-gray-900"
              >
                политикой использования cookie
              </Link>
              .
            </p>
          </div>
          <button
            onClick={accept}
            className="mt-6 w-full rounded-xl bg-yellow-400 px-6 py-3.5 text-base font-extrabold text-gray-950 transition-all hover:bg-yellow-500 hover:shadow-lg hover:shadow-yellow-400/30 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 md:mt-0 md:w-auto md:flex-shrink-0 md:rounded-lg md:px-7 md:py-2.5 md:text-sm xl:px-8"
          >
            Принять
          </button>
        </div>
      </div>
    </div>
  )
}

export function Shell({ children }: PropsWithChildren) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { getItemCount } = useCart()
  const { pathname } = useLocation()
  const cartCount = getItemCount()
  const isLegalDocument = legalDocumentPaths.includes(pathname)
  const handleCloseMenu = useCallback(() => setMobileMenuOpen(false), [])
  
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])
  
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      {/* Top bar */}
      <div className="hidden bg-gray-900 py-2 text-white lg:block">
        <Container>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-6">
              <a href="tel:+79998021022" className="flex items-center gap-2 transition-colors hover:text-yellow-400">
                <PhoneIcon className="h-4 w-4" />
                +7 (999) 802-10-22
              </a>
              <a href="mailto:takesmart99@gmail.com" className="flex items-center gap-2 transition-colors hover:text-yellow-400">
                <MailIcon className="h-4 w-4" />
                takesmart99@gmail.com
              </a>
            </div>
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-2 text-gray-400">
                <ClockIcon className="h-4 w-4" />
                Ежедневно: 10:30 — 20:30
              </span>
              <a
                href="https://t.me/take_smartt"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 transition-colors hover:text-yellow-400"
              >
                <TelegramIcon />
                Telegram
              </a>
            </div>
          </div>
        </Container>
      </div>
      
      {/* Main header */}
      <header
        className={`sticky top-0 z-40 border-b bg-white transition-shadow duration-300 ${
          scrolled ? 'border-gray-100 shadow-lg shadow-gray-100/50' : 'border-transparent'
        }`}
      >
        <Container>
          <div className="flex h-16 items-center justify-between lg:h-20">
            {/* Logo */}
            <Link to="/" className="flex-shrink-0">
              <Logo />
            </Link>
            
            {/* Desktop nav */}
            <nav className="hidden items-center gap-6 lg:flex">
              <NavItem to="/" label="Главная" />
              <NavItem to="/catalog" label="Каталог" />
              <NavItem to="/delivery" label="Доставка" />
              <NavItem to="/trade-in" label="Trade-in" />
              <NavItem to="/cart" label="Заявка" />
            </nav>

            {/* Desktop search */}
            <div className="hidden lg:block w-64 xl:w-80">
              <GlobalSearch />
            </div>
            
            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Mobile search button */}
              <MobileSearchButton />
              
              <Link
                to="/cart"
                className="hidden relative rounded-xl bg-yellow-400 px-6 py-2.5 text-sm font-semibold text-gray-900 transition-all hover:bg-yellow-500 hover:shadow-lg hover:shadow-yellow-400/25 sm:inline-flex"
              >
                {cartCount > 0 ? `Корзина (${cartCount})` : 'Заказать'}
                {cartCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                    {cartCount}
                  </span>
                )}
              </Link>
              
              {/* Mobile cart icon */}
              <Link
                to="/cart"
                className="relative flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 lg:hidden"
                aria-label="Корзина"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-gray-900">
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </Link>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
                aria-label="Открыть меню"
              >
                <MenuIcon />
              </button>
            </div>
          </div>
        </Container>
      </header>
      
      {/* Mobile menu */}
      <MobileMenu isOpen={mobileMenuOpen} onClose={handleCloseMenu} />
      
      {/* Main content */}
      <main className="flex-1">{children}</main>
      
      {/* Footer */}
      <footer className="bg-[#111] text-white">

        {/* Telegram CTA banner */}
        <div className="border-b border-white/10">
          <Container>
            <div className="flex flex-col items-start justify-between gap-4 py-6 sm:flex-row sm:items-center sm:py-10">
              {/* Left: brand */}
              <div>
                <div className="mb-1 text-3xl font-extrabold tracking-tight text-white">TakeSmart</div>
                <div className="text-sm text-gray-400">Магазин электроники с низкими ценами</div>
              </div>
              {/* Right: Telegram */}
              <div className="flex flex-row items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
                <div>
                  <div className="text-sm font-bold text-white leading-tight sm:text-lg">
                    Подписывайтесь на наш<br className="hidden sm:block" /> телеграм-канал
                  </div>
                  <div className="hidden sm:block text-sm text-gray-400">Узнавайте о новинках первыми!</div>
                </div>
                <a
                  href="https://t.me/c/1875029190/967"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-400 hover:shadow-lg hover:shadow-blue-500/30"
                >
                  Перейти в канал
                  <TelegramIcon />
                </a>
              </div>
            </div>
          </Container>
        </div>

        {/* Main footer grid */}
        <div className="border-b border-white/10 py-12">
          <Container>
            <div className="grid gap-6 grid-cols-2 lg:grid-cols-4">

              {/* Contacts block */}
              <div className="col-span-2 lg:col-span-1">
                <div className="mb-5 space-y-2 text-sm text-gray-300">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="h-4 w-4 flex-shrink-0 text-gray-500" />
                    <span>Ежедневно 10:30–20:30</span>
                  </div>
                  <div className="flex items-start gap-2 text-gray-400 leading-snug">
                    <span className="mt-0.5 flex-shrink-0 text-gray-500">📍</span>
                    <span>Москва, ул. Барклая, 10<br />ТЦ «Багратионовский», павильон А60</span>
                  </div>
                </div>
                <a
                  href="tel:+79998021022"
                  className="mb-2 block text-2xl font-bold text-white transition-colors hover:text-yellow-400"
                >
                  +7 (999) 802-10-22
                </a>
                <a
                  href="mailto:takesmart99@gmail.com"
                  className="block text-sm text-gray-400 transition-colors hover:text-white"
                >
                  takesmart99@gmail.com
                </a>
                {/* Legal */}
                <div className="mt-5 space-y-1 text-xs text-gray-600">
                  <div>ИП Бобоев Аслиддин Ахлидинович</div>
                  <div>ИНН 773428462104</div>
                  <div>ОГРНИП 325774600015941</div>
                </div>
              </div>

              {/* Catalog */}
              <div>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Каталог</h3>
                <ul className="space-y-2.5">
                  {[
                    { label: 'Apple iPhone', to: '/catalog?category=smartphones' },
                    { label: 'Apple MacBook', to: '/catalog?category=laptops' },
                    { label: 'Apple iPad', to: '/catalog?category=tablets' },
                    { label: 'Apple Watch', to: '/catalog?category=watches' },
                    { label: 'Apple AirPods', to: '/catalog?category=headphones' },
                    { label: 'Аксессуары', to: '/catalog?category=accessories' },
                  ].map(item => (
                    <li key={item.to}>
                      <Link to={item.to} className="text-sm text-gray-400 transition-colors hover:text-white">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

                            {/* Apple iPhone models */}
              <div>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Популярные продукты</h3>
                <ul className="space-y-2.5">
                  {[
                    { label: 'iPhone 17 Pro Max', to: '/catalog?category=smartphones&q=iPhone+17+Pro+Max' },
                    { label: 'iPhone 17 Pro', to: '/catalog?category=smartphones&q=iPhone+17+Pro' },
                    { label: 'iPhone 17', to: '/catalog?category=smartphones&q=iPhone+17' },
                    { label: 'MacBook Pro 14 M5', to: '/catalog?category=laptops&q=MacBook+Pro+14+M5' },
                    { label: 'MacBook Air 13 M4', to: '/catalog?category=laptops&q=MacBook+Air+13+M4' },
                    { label: 'iPad 11', to: '/catalog?category=tablets&q=iPad+11' },
                    { label: 'Samsung S26 Ultra', to: '/catalog?category=smartphones&q=Samsung+S26+Ultra' },
                  ].map(item => (
                    <li key={item.label}>
                      <Link
                        to={item.to}
                        className="text-sm text-gray-400 transition-colors hover:text-white"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Help */}
              <div className="col-span-2 lg:col-span-1">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Помощь</h3>
                <ul className="space-y-2.5">
                  {[
                    { label: 'Доставка и оплата', to: '/delivery' },
                    { label: 'Гарантия', to: '/delivery#warranty' },
                    { label: 'Рассрочка', to: '/delivery#installment' },
                    { label: 'Trade-in', to: '/trade-in' },
                    { label: 'Контакты', to: '/#contacts' },
                  ].map(item => (
                    <li key={item.to}>
                      <Link to={item.to} className="text-sm text-gray-400 transition-colors hover:text-white">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>

                {/* Payment icons */}
                <div className="mt-6 space-y-2">
                  {/* Row 1: payment systems */}
                  <div className="grid grid-cols-4 gap-2">
                    {/* СБП */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <img src="/sbp.svg" alt="СБП" className="h-6 w-auto" />
                    </div>
                    {/* VISA */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <img src="/visa.svg" alt="Visa" className="h-5 w-auto" />
                    </div>
                    {/* Mastercard */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <img src="/mastercard.svg" alt="Mastercard" className="h-6 w-auto" />
                    </div>
                    {/* UnionPay */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <img src="/union-pay.svg" alt="UnionPay" className="h-6 w-auto" />
                    </div>
                  </div>
                  {/* Row 2: currencies */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="flex h-9 items-center justify-center rounded bg-white">
                      <span className="font-bold text-sm text-gray-800">₽</span>
                    </div>
                    <div className="flex h-9 items-center justify-center rounded bg-white">
                      <span className="font-bold text-sm text-[#2ecc71]">$</span>
                    </div>
                    <div className="flex h-9 items-center justify-center rounded bg-white">
                      <span className="font-bold text-sm text-[#003399]">€</span>
                    </div>
                    <div className="flex h-9 items-center justify-center rounded bg-white">
                      <span className="font-bold text-sm text-gray-800">₸</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </Container>
        </div>

        {/* Disclaimer + bottom */}
        <div className="py-6">
          <Container>
            <div className="mb-4 text-xs leading-relaxed text-gray-600">
              <p>Указанная стоимость товаров и условия их приобретения действительны по состоянию на дату, указанную в товаре.
              Информация о товарах, ценах и наличии может обновляться. Договор розничной купли-продажи заключается на условиях
              публичной оферты, размещенной на Сайте.</p>
              <p className="mt-2">Apple, логотип Apple и изображения Apple являются зарегистрированными товарными знаками компании Apple Inc. в США и других странах. App Store является знаком обслуживания компании Apple Inc.</p>
            </div>
            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-gray-600">
                © {new Date().getFullYear()} TakeSmart. Все права защищены.
              </p>
              <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-600 sm:justify-end">
                <Link to="/offer" className="transition-colors hover:text-white">
                  Публичная оферта
                </Link>
                <Link to="/privacy-policy" className="transition-colors hover:text-white">
                  Политика конфиденциальности
                </Link>
                <Link to="/personal-data" className="transition-colors hover:text-white">
                  Согласие на обработку персональных данных
                </Link>
                <Link to="/cookie-policy" className="transition-colors hover:text-white">
                  Политика использования cookie
                </Link>
              </div>
            </div>
            <div className="mt-8 text-center text-[10px] leading-relaxed text-gray-500/40 opacity-40">
              Apple, логотип Apple, iPhone, iPad, Mac, MacBook, AirPods, Apple Watch, iMac, Mac mini, Mac Studio, Mac Pro, MagSafe, AirTag, Apple TV, Apple Pencil, Lightning являются зарегистрированными товарными знаками компании Apple Inc. в США и/или других странах.
            </div>
          </Container>
        </div>

      </footer>
      
      {/* Cookie consent */}
      <CookieConsent />
      
      {/* Telegram floating button */}
      <a
        href="https://t.me/takesmart_manager"
        target="_blank"
        rel="noopener noreferrer"
        className={`fixed bottom-5 right-4 z-30 h-12 w-12 items-center justify-center rounded-full bg-[#0088cc] text-white shadow-lg transition-transform hover:scale-110 hover:shadow-xl sm:bottom-6 sm:right-6 sm:h-14 sm:w-14 ${
          isLegalDocument ? 'hidden sm:flex' : 'flex'
        }`}
      >
        <TelegramIcon className="h-6 w-6 sm:h-7 sm:w-7" />
      </a>
    </div>
  )
}
