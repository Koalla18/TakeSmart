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
              href="tel:+79991234567"
              className="mb-3 flex items-center gap-3 text-lg font-semibold text-gray-900 hover:text-yellow-500"
            >
              <PhoneIcon className="h-5 w-5 text-yellow-500" />
              +7 (999) 123-45-67
            </a>
            <p className="text-sm text-gray-500">Ежедневно с 10:00 до 21:00</p>
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
              <a href="tel:+79991234567" className="flex items-center gap-2 transition-colors hover:text-yellow-400">
                <PhoneIcon className="h-4 w-4" />
                +7 (999) 123-45-67
              </a>
              <a href="mailto:info@takesmart.ru" className="flex items-center gap-2 transition-colors hover:text-yellow-400">
                <MailIcon className="h-4 w-4" />
                info@takesmart.ru
              </a>
            </div>
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-2 text-gray-400">
                <ClockIcon className="h-4 w-4" />
                Ежедневно: 10:00 — 21:00
              </span>
              <div className="flex items-center gap-3">
                <a href="#" className="text-gray-400 transition-colors hover:text-yellow-400">
                  <TelegramIcon />
                </a>
                <a href="#" className="text-gray-400 transition-colors hover:text-yellow-400">
                  <VkIcon />
                </a>
                <a href="#" className="text-gray-400 transition-colors hover:text-yellow-400">
                  <WhatsAppIcon />
                </a>
              </div>
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
            <nav className="hidden items-center gap-8 lg:flex">
              <NavItem to="/" label="Главная" />
              <NavItem to="/catalog" label="Каталог" />
              <NavItem to="/cart" label="Оставить заявку" />
            </nav>
            
            {/* Actions */}
            <div className="flex items-center gap-3">
              <a
                href="tel:+79991234567"
                className="hidden items-center gap-2 text-sm font-medium text-gray-900 transition-colors hover:text-yellow-500 lg:flex"
              >
                <PhoneIcon className="h-5 w-5 text-yellow-500" />
                +7 (999) 123-45-67
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
              
              <Link
                to="/admin"
                className="hidden rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 lg:inline-flex"
              >
                Админ
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
      <footer className="bg-gray-900 text-white">
        {/* Main footer */}
        <div className="border-b border-gray-800 py-12 lg:py-16">
          <Container>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {/* Logo & description */}
              <div className="sm:col-span-2 lg:col-span-1">
                <LogoWhite />
                <p className="mt-4 text-sm leading-relaxed text-gray-400">
                  Магазин современной техники. Официальная гарантия, выгодные цены, быстрая доставка по всей России.
                </p>
                <div className="mt-6 flex gap-3">
                  <a href="#" className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800 text-gray-400 transition-colors hover:bg-yellow-400 hover:text-gray-900">
                    <TelegramIcon />
                  </a>
                  <a href="#" className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800 text-gray-400 transition-colors hover:bg-yellow-400 hover:text-gray-900">
                    <VkIcon />
                  </a>
                  <a href="#" className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800 text-gray-400 transition-colors hover:bg-yellow-400 hover:text-gray-900">
                    <WhatsAppIcon />
                  </a>
                </div>
              </div>
              
              {/* Catalog */}
              <div>
                <h3 className="mb-4 text-sm font-semibold text-yellow-400">Каталог</h3>
                <ul className="space-y-2.5">
                  {[
                    { label: 'Смартфоны', to: '/catalog?category=smartphones' },
                    { label: 'Ноутбуки', to: '/catalog?category=laptops' },
                    { label: 'Планшеты', to: '/catalog?category=tablets' },
                    { label: 'Наушники', to: '/catalog?category=headphones' },
                    { label: 'Часы', to: '/catalog?category=watches' },
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
              
              {/* Info */}
              <div>
                <h3 className="mb-4 text-sm font-semibold text-yellow-400">Покупателям</h3>
                <ul className="space-y-2.5">
                  {[
                    { label: 'Доставка и оплата', to: '/delivery' },
                    { label: 'Гарантия', to: '/warranty' },
                    { label: 'Возврат товара', to: '/returns' },
                    { label: 'Trade-in', to: '/trade-in' },
                    { label: 'Акции', to: '/sale' },
                    { label: 'Контакты', to: '/contacts' },
                  ].map(item => (
                    <li key={item.to}>
                      <Link to={item.to} className="text-sm text-gray-400 transition-colors hover:text-white">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              
              {/* Contacts */}
              <div>
                <h3 className="mb-4 text-sm font-semibold text-yellow-400">Контакты</h3>
                <ul className="space-y-3">
                  <li>
                    <a href="tel:+79991234567" className="flex items-center gap-3 text-white transition-colors hover:text-yellow-400">
                      <PhoneIcon className="h-5 w-5 text-yellow-500" />
                      <span className="font-medium">+7 (999) 123-45-67</span>
                    </a>
                  </li>
                  <li>
                    <a href="mailto:info@takesmart.ru" className="flex items-center gap-3 text-gray-400 transition-colors hover:text-white">
                      <MailIcon className="h-5 w-5 text-gray-500" />
                      info@takesmart.ru
                    </a>
                  </li>
                  <li className="flex items-start gap-3 text-gray-400">
                    <ClockIcon className="h-5 w-5 flex-shrink-0 text-gray-500" />
                    <span>
                      Ежедневно<br />
                      10:00 — 21:00
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </Container>
        </div>
        
        {/* Bottom footer */}
        <div className="py-6">
          <Container>
            <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
              <p className="text-sm text-gray-500">
                © {new Date().getFullYear()} Take Smart. Все права защищены.
              </p>
              <div className="flex gap-6 text-sm text-gray-500">
                <Link to="/privacy" className="transition-colors hover:text-white">
                  Политика конфиденциальности
                </Link>
                <Link to="/offer" className="transition-colors hover:text-white">
                  Публичная оферта
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
        href="https://wa.me/79991234567"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-transform hover:scale-110 hover:shadow-xl"
      >
        <WhatsAppIcon className="h-7 w-7" />
      </a>
    </div>
  )
}
