import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useRef } from 'react'
import { Shell } from './components/Shell'
import { AuthProvider } from './lib/auth'
import { CartProvider } from './lib/cart'
import { ymHit } from './lib/metrika'
import { trackVisit } from './lib/visits'
import { HomePage } from './pages/HomePage'

// HomePage остаётся eager — это лендинг, не хотим второй сетевой round-trip на "/".
// Все остальные страницы грузятся лениво: тяжёлая админка (3880 строк), карточка
// товара, каталог и т.д. больше не попадают в начальный бандл главной.
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })))
const CartPage = lazy(() => import('./pages/CartPage').then(m => ({ default: m.CartPage })))
const CatalogPage = lazy(() => import('./pages/CatalogPage').then(m => ({ default: m.CatalogPage })))
const CookiePolicyPage = lazy(() => import('./pages/CookiePolicyPage').then(m => ({ default: m.CookiePolicyPage })))
const DeliveryPage = lazy(() => import('./pages/DeliveryPage').then(m => ({ default: m.DeliveryPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const OfferPage = lazy(() => import('./pages/OfferPage').then(m => ({ default: m.OfferPage })))
const PersonalDataPage = lazy(() => import('./pages/PersonalDataPage').then(m => ({ default: m.PersonalDataPage })))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage').then(m => ({ default: m.PrivacyPolicyPage })))
const ProductPage = lazy(() => import('./pages/ProductPage').then(m => ({ default: m.ProductPage })))
const TradeInPage = lazy(() => import('./pages/TradeInPage').then(m => ({ default: m.TradeInPage })))
const UsedPage = lazy(() => import('./pages/UsedPage').then(m => ({ default: m.UsedPage })))
const UsedProductPage = lazy(() => import('./pages/UsedProductPage').then(m => ({ default: m.UsedProductPage })))
const OrdersAppPage = lazy(() => import('./pages/OrdersAppPage').then(m => ({ default: m.OrdersAppPage })))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

/** Внутренние инструменты (админка/PWA-заказы/вход) в аналитику витрины не попадают. */
const INTERNAL_ROUTE_PREFIXES = ['/admin', '/app', '/login']

/**
 * SPA-трекинг для Яндекс.Метрики: первый просмотр отправляет сам сниппет в
 * index.html при загрузке, а каждый последующий переход по роуту (без
 * перезагрузки страницы) отправляем вручную через ym('hit').
 */
function MetrikaRouteTracker() {
  const location = useLocation()
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    // Не считаем внутренние инструменты (админка/PWA-заказы/вход) — только витрину.
    if (INTERNAL_ROUTE_PREFIXES.some(p => location.pathname.startsWith(p))) return
    ymHit(location.pathname + location.search)
  }, [location.pathname, location.search])
  return null
}

/**
 * Собственный счётчик визитов — источник цифр «Визиты» и «Конверсия» в админской
 * аналитике (Метрика свои данные внутрь панели не отдаёт). В отличие от Метрики
 * считаем и самый первый просмотр — за нас его никто не отправляет. Источник
 * перехода для первой страницы — внешний document.referrer, дальше — предыдущий
 * путь внутри сайта.
 */
function VisitTracker() {
  const location = useLocation()
  const prevPath = useRef<string | null>(null)
  useEffect(() => {
    const path = location.pathname
    if (INTERNAL_ROUTE_PREFIXES.some(p => path.startsWith(p))) {
      prevPath.current = path
      return
    }
    const referrer = prevPath.current
      ? window.location.origin + prevPath.current
      : document.referrer || null
    trackVisit(path, referrer)
    prevPath.current = path
  }, [location.pathname])
  return null
}

/** Лёгкий плейсхолдер во время подгрузки чанка ленивой страницы. */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-yellow-400" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <ScrollToTop />
        <MetrikaRouteTracker />
        <VisitTracker />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Admin routes (no Shell) */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/app" element={<OrdersAppPage />} />

            {/* Public routes (with Shell) */}
            <Route path="/" element={<Shell><HomePage /></Shell>} />
            <Route path="/catalog" element={<Shell><CatalogPage /></Shell>} />
            <Route path="/product/:id" element={<Shell><ProductPage /></Shell>} />
            <Route path="/cart" element={<Shell><CartPage /></Shell>} />
            <Route path="/delivery" element={<Shell><DeliveryPage /></Shell>} />
            <Route path="/trade-in" element={<Shell><TradeInPage /></Shell>} />
            <Route path="/used" element={<Shell><UsedPage /></Shell>} />
            <Route path="/used/:slug" element={<Shell><UsedProductPage /></Shell>} />
            <Route path="/offer" element={<Shell><OfferPage /></Shell>} />
            <Route path="/privacy-policy" element={<Shell><PrivacyPolicyPage /></Shell>} />
            <Route path="/cookie-policy" element={<Shell><CookiePolicyPage /></Shell>} />
            <Route path="/personal-data" element={<Shell><PersonalDataPage /></Shell>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </CartProvider>
    </AuthProvider>
  )
}
