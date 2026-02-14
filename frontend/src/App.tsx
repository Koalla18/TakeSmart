import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { AuthProvider } from './lib/auth'
import { CartProvider } from './lib/cart'
import { AdminPage } from './pages/AdminPage'
import { CartPage } from './pages/CartPage'
import { CatalogPage } from './pages/CatalogPage'
import { DeliveryPage } from './pages/DeliveryPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { ProductPage } from './pages/ProductPage'
import { UsedPage } from './pages/UsedPage'
import { UsedProductPage } from './pages/UsedProductPage'

function App() {
  return (
    <AuthProvider>
      <CartProvider>
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
          <Route path="/used" element={<Shell><UsedPage /></Shell>} />
          <Route path="/used/:slug" element={<Shell><UsedProductPage /></Shell>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CartProvider>
    </AuthProvider>
  )
}

export default App
