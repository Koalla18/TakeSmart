import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { AuthProvider } from './lib/auth'
import { CartProvider } from './lib/cart'
import { AdminPage } from './pages/AdminPage'
import { CartPage } from './pages/CartPage'
import { CatalogPage } from './pages/CatalogPage'
import { DeliveryPage } from './pages/DeliveryPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PersonalDataPage } from './pages/PersonalDataPage'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { ProductPage } from './pages/ProductPage'
import { TradeInPage } from './pages/TradeInPage'
import { UsedPage } from './pages/UsedPage'
import { UsedProductPage } from './pages/UsedProductPage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <ScrollToTop />
        <Routes>
          {/* Admin routes (no Shell) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
          
          {/* Public routes (with Shell) */}
          <Route path="/" element={<Shell><HomePage /></Shell>} />
          <Route path="/catalog" element={<Shell><CatalogPage /></Shell>} />
          <Route path="/product/:id" element={<Shell><ProductPage /></Shell>} />
          <Route path="/cart" element={<Shell><CartPage /></Shell>} />
          <Route path="/delivery" element={<Shell><DeliveryPage /></Shell>} />
          <Route path="/trade-in" element={<Shell><TradeInPage /></Shell>} />
          <Route path="/used" element={<Shell><UsedPage /></Shell>} />
          <Route path="/used/:slug" element={<Shell><UsedProductPage /></Shell>} />
          <Route path="/privacy-policy" element={<Shell><PrivacyPolicyPage /></Shell>} />
          <Route path="/personal-data" element={<Shell><PersonalDataPage /></Shell>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CartProvider>
    </AuthProvider>
  )
}

export default App
