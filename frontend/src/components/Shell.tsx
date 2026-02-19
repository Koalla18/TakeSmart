import type { PropsWithChildren } from 'react'
import { useState, useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Logo, LogoWhite } from './Logo'
import { PhoneIcon, MailIcon, ClockIcon, MenuIcon, CloseIcon, TelegramIcon, VkIcon, WhatsAppIcon, ChevronRightIcon } from './ui/Icons'
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
  const location = useLocation()
  
  useEffect(() => {
    onClose()
  }, [location, onClose])
  
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
              
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
              >
                <MenuIcon />
              </button>
            </div>
          </div>
        </Container>
      </header>
      
      {/* Mobile menu */}
      <MobileMenu isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      
      {/* Main content */}
      <main className="flex-1">{children}</main>
      
      {/* Footer */}
      <footer className="bg-[#111] text-white">

        {/* Telegram CTA banner */}
        <div className="border-b border-white/10">
          <Container>
            <div className="flex flex-col items-start justify-between gap-6 py-10 sm:flex-row sm:items-center">
              {/* Left: brand */}
              <div>
                <div className="mb-1 text-3xl font-extrabold tracking-tight text-white">TakeSmart</div>
                <div className="text-sm text-gray-400">Магазин электроники с низкими ценами</div>
              </div>
              {/* Right: Telegram */}
              <div className="flex flex-col gap-3 sm:items-end">
                <div className="text-lg font-bold text-white leading-tight">
                  Подписывайтесь<br />на наш телеграм-канал
                </div>
                <div className="text-sm text-gray-400">Узнавайте о новинках первыми!</div>
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
            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">

              {/* Contacts block */}
              <div className="sm:col-span-2 lg:col-span-1">
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
                    'iPhone 16 Pro',
                    'iPhone 16',
                    'iPhone 16 Plus',
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
              <div>
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
                      <svg viewBox="0 0 60 24" width="44" height="18" xmlns="http://www.w3.org/2000/svg">
                        <text x="0" y="17" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="14" fill="#1da462">СБП</text>
                      </svg>
                    </div>
                    {/* VISA */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <svg viewBox="0 0 60 24" width="44" height="18" xmlns="http://www.w3.org/2000/svg">
                        <text x="0" y="17" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="14" fontStyle="italic" fill="#1a1f71">VISA</text>
                      </svg>
                    </div>
                    {/* Mastercard */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <svg viewBox="0 0 38 24" width="38" height="24" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="13" cy="12" r="10" fill="#eb001b"/>
                        <circle cx="25" cy="12" r="10" fill="#f79e1b"/>
                        <path d="M19 5.8a10 10 0 0 1 0 12.4A10 10 0 0 1 19 5.8z" fill="#ff5f00"/>
                      </svg>
                    </div>
                    {/* UnionPay */}
                    <div className="flex h-9 items-center justify-center rounded bg-white px-1">
                      <svg viewBox="0 0 50 24" width="46" height="22" xmlns="http://www.w3.org/2000/svg">
                        <rect x="0" y="2" width="20" height="20" rx="4" fill="#e21836"/>
                        <rect x="14" y="2" width="20" height="20" rx="4" fill="#007b5e"/>
                        <rect x="28" y="2" width="20" height="20" rx="4" fill="#1d2f60"/>
                        <text x="4" y="16" fontFamily="Arial" fontWeight="bold" fontSize="8" fill="white">UP</text>
                      </svg>
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
      
      {/* WhatsApp floating button */}
      <a
        href="https://wa.me/79998021022"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-transform hover:scale-110 hover:shadow-xl"
      >
        <WhatsAppIcon className="h-7 w-7" />
      </a>
    </div>
  )
}
