import type { PropsWithChildren } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Logo } from './Logo'
import { PhoneIcon, MailIcon, ClockIcon, MenuIcon, CloseIcon, TelegramIcon, ChevronRightIcon } from './ui/Icons'
import { Container } from './ui/Layout'
import { useCart } from '../lib/cart'

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

function MobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
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
                { to: '/used', label: 'Б/У техника' },
                { to: '/delivery', label: 'Доставка и оплата' },
                { to: '/trade-in', label: 'Trade-in' },
                { to: '/cart', label: 'Оставить заявку' },
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
                {[
                  { icon: '📱', label: 'Смартфоны', category: 'smartphones' },
                  { icon: '💻', label: 'Ноутбуки', category: 'laptops' },
                  { icon: '🎧', label: 'Наушники', category: 'headphones' },
                  { icon: '⌚', label: 'Часы', category: 'watches' },
                ].map(cat => (
                  <Link
                    key={cat.category}
                    to={`/catalog?category=${cat.category}`}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-xl px-4 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <span className="text-xl">{cat.icon}</span>
                    <span className="text-sm text-gray-700">{cat.label}</span>
                  </Link>
                ))}
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
            <p className="text-sm text-gray-500">Ежедневно с 11:00 до 20:00</p>
          </div>
        </div>
      </div>
    </>
  )
}

function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false)
  
  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent')
    if (!consent) {
      setTimeout(() => setIsVisible(true), 1500)
    }
  }, [])
  
  const accept = () => {
    localStorage.setItem('cookie-consent', 'true')
    setIsVisible(false)
  }
  
  if (!isVisible) return null
  
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white p-4 shadow-lg sm:p-6">
      <Container>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">
            Мы используем cookies для улучшения работы сайта.{' '}
            <Link to="/privacy" className="text-yellow-600 hover:underline">
              Политика конфиденциальности
            </Link>
          </p>
          <button
            onClick={accept}
            className="rounded-lg bg-yellow-400 px-6 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-yellow-500"
          >
            Принять
          </button>
        </div>
      </Container>
    </div>
  )
}

export function Shell({ children }: PropsWithChildren) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { getItemCount } = useCart()
  const cartCount = getItemCount()
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
                Ежедневно: 11:00 — 20:00
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
              <NavItem to="/used" label="Б/У" />
              <NavItem to="/delivery" label="Доставка" />
              <NavItem to="/trade-in" label="Trade-in" />
              <NavItem to="/cart" label="Заявка" />
            </nav>
            
            {/* Actions */}
            <div className="flex items-center gap-3">
              <a
                href="tel:+79998021022"
                className="hidden items-center gap-2 text-sm font-medium text-gray-900 transition-colors hover:text-yellow-500 lg:flex"
              >
                <PhoneIcon className="h-5 w-5 text-yellow-500" />
                +7 (999) 802-10-22
              </a>
              
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
                    <span>Ежедневно 11:00–20:00</span>
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
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Apple iPhone</h3>
                <ul className="space-y-2.5">
                  {[
                    'iPhone 17 Pro Max',
                    'iPhone 17 Pro',
                    'iPhone 17',
                    'iPhone Air',
                    'iPhone 16 Pro Max',
                    'iPhone 16',
                  ].map(model => (
                    <li key={model}>
                      <Link
                        to={`/catalog?category=smartphones&q=${encodeURIComponent(model)}`}
                        className="text-sm text-gray-400 transition-colors hover:text-white"
                      >
                        {model}
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
              Указанная стоимость товаров и условия их приобретения действительны по состоянию на дату, указанную в товаре.
              Сайт носит сугубо информационный характер и не является публичной офертой, определяемой Статьёй 437 (2) ГК РФ.
            </div>
            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-gray-600">
                © {new Date().getFullYear()} TakeSmart. Все права защищены.
              </p>
              <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-600 sm:justify-end">
                <Link to="/privacy-policy" className="transition-colors hover:text-white">
                  Политика конфиденциальности
                </Link>
                <Link to="/personal-data" className="transition-colors hover:text-white">
                  Согласие на обработку персональных данных
                </Link>
              </div>
            </div>
          </Container>
        </div>

      </footer>
      
      {/* Cookie consent */}
      <CookieConsent />
      
      {/* Telegram floating button */}
      <a
        href="https://t.me/take_smartt"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-20 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#0088cc] text-white shadow-lg transition-transform hover:scale-110 hover:shadow-xl sm:bottom-6"
      >
        <TelegramIcon className="h-7 w-7" />
      </a>
    </div>
  )
}
