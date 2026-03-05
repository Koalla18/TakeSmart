import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { formatPrice } from '../data/products'

// ============ TYPES ============

interface OrderItem {
  id: string
  product_id: string
  product_name: string
  product_sku: string | null
  unit_price: number
  total_price: number
  quantity: number
}

interface Order {
  id: string
  order_number: string
  customer_name: string
  customer_email: string
  customer_phone: string | null
  customer_note: string | null
  shipping_address: string
  shipping_city: string
  shipping_postal_code: string | null
  admin_note: string | null
  status: string
  payment_status: string
  total_amount: number
  items_count: number
  created_at: string
  updated_at: string
}

interface OrderDetail extends Order {
  items: OrderItem[]
}

interface Category {
  id: string
  slug: string
  name: string
  description: string | null
  image_url: string | null
  is_active: boolean
  parent_id: string | null
  created_at: string
  updated_at: string
}

interface Product {
  id: string
  name: string
  slug: string
  description: string | null
  short_description: string | null
  price: number
  discount_price: number | null
  stock_quantity: number
  sku: string | null
  brand: string | null
  model: string | null
  color: string | null
  warranty_months: number | null
  main_image_url: string | null
  condition: string
  is_active: boolean
  is_featured: boolean
  category_id: string | null
  group_id: string | null
  created_at: string
  updated_at: string
}

interface PaginatedResponse<T> {
  items: T[]
  total: number
  offset: number
  limit: number
  has_next: boolean
}

interface ProductVariant {
  id: string
  product_id: string
  name: string
  sku: string | null
  price: number | null
  discount_price: number | null
  stock_quantity: number
  color: string | null
  storage: string | null
  size: string | null
  image_url: string | null
  sort_order: number
  is_active: boolean
}

// ============ CONSTANTS ============

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending:    { label: 'Новый',       color: 'text-blue-600',   bg: 'bg-blue-100',   icon: '🆕' },
  confirmed:  { label: 'Подтверждён', color: 'text-cyan-600',   bg: 'bg-cyan-100',   icon: '✅' },
  processing: { label: 'В обработке', color: 'text-orange-600', bg: 'bg-orange-100', icon: '⏳' },
  shipped:    { label: 'Отправлен',   color: 'text-indigo-600', bg: 'bg-indigo-100', icon: '🚚' },
  delivered:  { label: 'Доставлен',   color: 'text-green-600',  bg: 'bg-green-100',  icon: '📦' },
  cancelled:  { label: 'Отменён',     color: 'text-red-600',    bg: 'bg-red-100',    icon: '❌' },
  refunded:   { label: 'Возврат',     color: 'text-gray-600',   bg: 'bg-gray-200',   icon: '💸' },
}

type TabType = 'orders' | 'products' | 'categories' | 'slides' | 'used'

// ============ HELPERS ============

interface WeeklySlide {
  id: string
  badge: string | null
  title: string
  description: string | null
  price: string | null
  image: string | null
  color: string | null
  tags: string[] | null
  link_url: string | null
  is_new: boolean
  sort_order: number
  is_active: boolean
}

function getImageUrl(url?: string | null): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  if (url.startsWith('/static') || url.startsWith('/uploads')) return `${API_BASE_URL}${url}`
  return url
}

/** Module-level fetch wrapper that auto-logouts on 401/403 */
function makeAuthFetch(logoutFn: () => void) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const res = await fetch(url, {
      ...init,
      headers: { ...getAuthHeaders(), ...(init?.headers || {}) },
    })
    if (res.status === 401 || res.status === 403) {
      logoutFn()
      throw new Error('Сессия истекла')
    }
    return res
  }
}

type AuthFetchFn = ReturnType<typeof makeAuthFetch>

// ============ MAIN COMPONENT ============

export function AdminPage() {
  const navigate = useNavigate()
  const { isAuthenticated, logout } = useAuth()
  const authFetch = makeAuthFetch(logout)
  
  const [activeTab, setActiveTab] = useState<TabType>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [isUsedProductMode, setIsUsedProductMode] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [slides, setSlides] = useState<WeeklySlide[]>([])
  const [editingSlide, setEditingSlide] = useState<WeeklySlide | null>(null)
  const [isSlideModalOpen, setIsSlideModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [_error, setError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!isAuthenticated) navigate('/login', { replace: true })
  }, [isAuthenticated, navigate])

  // Data loading — all list endpoints return PaginatedResponse
  const loadOrders = async () => {
    try {
      let url = `${API_BASE_URL}/api/orders?limit=100`
      if (statusFilter !== 'all') url += `&status=${statusFilter}`
      const res = await authFetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error('Ошибка')
      const data: PaginatedResponse<Order> = await res.json()
      setOrders(data.items)
    } catch (err) { console.error(err) }
  }

  const loadProducts = async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products?limit=500&only_active=false`)
      if (res.ok) {
        const data: PaginatedResponse<Product> = await res.json()
        setProducts(data.items)
      }
    } catch (err) { console.error(err) }
  }

  const loadCategories = async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/categories?limit=100&only_active=false`)
      if (res.ok) {
        const data: PaginatedResponse<Category> = await res.json()
        setCategories(data.items)
      }
    } catch (err) { console.error(err) }
  }

  const loadSlides = async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/weekly-slides/all`)
      if (res.ok) setSlides(await res.json())
    } catch (err) { console.error(err) }
  }

  const loadAllData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await Promise.all([loadOrders(), loadProducts(), loadCategories(), loadSlides()])
    } catch { setError('Ошибка загрузки') }
    finally { setIsLoading(false) }
  }

  useEffect(() => { if (isAuthenticated) loadAllData() }, [isAuthenticated])
  useEffect(() => { if (isAuthenticated) loadOrders() }, [statusFilter])

  // Order actions
  const loadOrderDetail = async (orderId: string) => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/orders/${orderId}`)
      if (res.ok) {
        const detail: OrderDetail = await res.json()
        setSelectedOrder(detail)
      }
    } catch (err) { console.error(err) }
  }

  const updateStatus = async (orderId: string, newStatus: string) => {
    setUpdatingStatus(true)
    try {
      const res = await authFetch(`${API_BASE_URL}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (!res.ok) throw new Error('Ошибка')
      setOrders(orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
      if (selectedOrder?.id === orderId) setSelectedOrder({ ...selectedOrder, status: newStatus })
    } catch { alert('Ошибка') }
    finally { setUpdatingStatus(false) }
  }

  const deleteOrder = async (orderId: string) => {
    if (!confirm('Удалить заказ?')) return
    try {
      await authFetch(`${API_BASE_URL}/api/orders/${orderId}`, { method: 'DELETE' })
      setOrders(orders.filter(o => o.id !== orderId))
      setSelectedOrder(null)
    } catch { alert('Ошибка') }
  }

  // Product actions
  const saveProduct = async (productData: Record<string, unknown>, productId?: string): Promise<Product | null> => {
    const id = productId || editingProduct?.id
    const url = id
      ? `${API_BASE_URL}/api/products/${id}`
      : `${API_BASE_URL}/api/products`
    const res = await authFetch(url, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productData)
    })
    if (!res.ok) {
      let detail = 'Ошибка сервера'
      try {
        const err = await res.json()
        if (typeof err.detail === 'string') detail = err.detail
        else if (Array.isArray(err.detail)) detail = err.detail.map((e: { msg?: string }) => e.msg).join('; ')
      } catch { /* ignore */ }
      throw new Error(detail)
    }
    const saved: Product = await res.json()
    loadProducts()
    return saved
  }

  const deleteProduct = async (productId: string) => {
    if (!confirm('Удалить товар?')) return
    try {
      await authFetch(`${API_BASE_URL}/api/products/${productId}`, { method: 'DELETE' })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  const toggleFeatured = async (product: Product) => {
    try {
      await authFetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_featured: !product.is_featured })
      })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  const toggleActive = async (product: Product) => {
    try {
      await authFetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !product.is_active })
      })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  // Category actions
  const saveCategory = async (categoryData: Record<string, unknown>) => {
    try {
      const url = editingCategory?.id 
        ? `${API_BASE_URL}/api/categories/${editingCategory.id}`
        : `${API_BASE_URL}/api/categories`
      const res = await authFetch(url, {
        method: editingCategory?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryData)
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Ошибка')
      }
      setIsCategoryModalOpen(false)
      setEditingCategory(null)
      loadCategories()
    } catch (err) { alert(err instanceof Error ? err.message : 'Ошибка') }
  }

  const deleteCategory = async (categoryId: string) => {
    // Check how many products use this category
    const productsInCategory = products.filter(p => p.category_id === categoryId)
    const categoryName = categories.find(c => c.id === categoryId)?.name || 'Категория'

    const message = productsInCategory.length > 0
      ? `Удалить категорию «${categoryName}»?\n\n⚠️ В этой категории ${productsInCategory.length} товар(ов). Сначала переместите или удалите их, либо категория не удалится.`
      : `Удалить категорию «${categoryName}»?`

    if (!confirm(message)) return
    try {
      const res = await authFetch(`${API_BASE_URL}/api/categories/${categoryId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        if (res.status === 409) {
          alert(`Невозможно удалить категорию «${categoryName}»: к ней привязаны товары.\n\nСначала переместите все товары в другую категорию или удалите их.`)
        } else {
          alert(err?.detail || `Ошибка ${res.status}`)
        }
        return
      }
      loadCategories()
      loadProducts()
    } catch { alert('Ошибка сети') }
  }

  // Weekly slides actions
  const saveSlide = async (data: Record<string, unknown>, slideId?: string): Promise<string | null> => {
    try {
      const url = slideId
        ? `${API_BASE_URL}/api/weekly-slides/${slideId}`
        : `${API_BASE_URL}/api/weekly-slides`
      const res = await authFetch(url, {
        method: slideId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Ошибка') }
      const saved = await res.json()
      loadSlides()
      return saved.id as string
    } catch (err) { alert(err instanceof Error ? err.message : 'Ошибка'); return null }
  }

  const deleteSlide = async (slideId: string) => {
    if (!confirm('Удалить слайд?')) return
    try {
      await authFetch(`${API_BASE_URL}/api/weekly-slides/${slideId}`, { method: 'DELETE' })
      loadSlides()
    } catch { alert('Ошибка') }
  }

  const toggleSlideActive = async (slide: WeeklySlide) => {
    try {
      await authFetch(`${API_BASE_URL}/api/weekly-slides/${slide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !slide.is_active }),
      })
      loadSlides()
    } catch { alert('Ошибка') }
  }

  // Filtering
  const filterProducts = (list: Product[]) => {
    return list.filter(p => {
      const matchesCategory = categoryFilter === null || p.category_id === categoryFilter
      const matchesSearch = searchQuery === '' || 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.brand?.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }

  const featuredProduct = products.find(p => p.is_featured)
  const pendingCount = orders.filter(o => o.status === 'pending').length

  if (!isAuthenticated) return null

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">⏳ Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-900/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400 text-xl">⚡</div>
            <div>
              <h1 className="font-bold text-white">Take Smart Admin</h1>
              <p className="text-xs text-slate-400">Панель управления</p>
            </div>
          </div>
          <div className="flex gap-3">
            <a href="/" className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">← На сайт</a>
            <button onClick={() => { logout(); navigate('/login') }} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Quick Stats Dashboard */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Всего заказов', value: orders.length, icon: '📋', gradient: 'from-blue-500 to-cyan-500' },
            { label: 'Новых заказов', value: pendingCount, icon: '🔔', gradient: 'from-red-500 to-rose-500' },
            { label: 'Товаров', value: products.length, icon: '📦', gradient: 'from-indigo-500 to-violet-500' },
            { label: 'Категорий', value: categories.length, icon: '📁', gradient: 'from-green-500 to-emerald-500' },
          ].map((stat, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl bg-white/5 p-5 backdrop-blur transition-all hover:bg-white/10 cursor-pointer">
              <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br ${stat.gradient} opacity-20 blur-2xl`} />
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{stat.icon}</span>
              </div>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-xs text-slate-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Featured Product Banner */}
        {featuredProduct && (
          <div
            className="mb-6 rounded-2xl bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 p-4 hover:from-yellow-500/30 hover:to-orange-500/30 transition-all cursor-pointer"
            onClick={() => { setEditingProduct(featuredProduct); setIsProductModalOpen(true) }}
            title="Нажмите, чтобы редактировать"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-yellow-500/30 text-3xl">
                  ⭐
                </div>
                <div>
                  <div className="text-sm text-yellow-400 font-medium">Хит продаж — показывается в разделе «Хиты» на главной</div>
                  <div className="text-lg font-bold text-white">{featuredProduct.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Нажмите, чтобы редактировать товар</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-yellow-400">{formatPrice(featuredProduct.price)}</div>
                <div className="text-xs text-slate-400">{products.filter(p => p.is_featured).length} товар(ов) отмечено</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { id: 'orders' as TabType, label: '📋 Заказы', count: orders.length },
            { id: 'products' as TabType, label: '📦 Товары', count: products.filter(p => (p.condition || 'new') === 'new').length },
            { id: 'used' as TabType, label: '♻️ Б/У', count: products.filter(p => p.condition === 'used').length },
            { id: 'categories' as TabType, label: '📁 Категории', count: categories.length },
            { id: 'slides' as TabType, label: '🏞 Слайды недели', count: slides.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                activeTab === tab.id ? 'bg-yellow-400 text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {tab.label} {tab.count !== undefined && `(${tab.count})`}
            </button>
          ))}
        </div>

        {/* ============ ORDERS TAB ============ */}
        {activeTab === 'orders' && (
          <>
            {/* Фильтры */}
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'Все', count: orders.length },
                { id: 'pending', label: '🆕 Новые', count: orders.filter(o => o.status === 'pending').length },
                { id: 'confirmed', label: '✅ Подтвержд.', count: orders.filter(o => o.status === 'confirmed').length },
                { id: 'processing', label: '⏳ В работе', count: orders.filter(o => o.status === 'processing').length },
                { id: 'shipped', label: '🚚 Отправлены', count: orders.filter(o => o.status === 'shipped').length },
                { id: 'delivered', label: '📦 Доставлены', count: orders.filter(o => o.status === 'delivered').length },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition flex items-center gap-1.5 ${
                    statusFilter === f.id ? 'bg-white text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {f.label}
                  {f.count > 0 && (
                    <span className={`rounded-full px-1.5 text-xs font-bold ${
                      statusFilter === f.id ? 'bg-black/10 text-gray-700' : 'bg-white/20 text-white'
                    }`}>{f.count}</span>
                  )}
                </button>
              ))}
            </div>

            {orders.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-5xl mb-4">📭</div>
                <div className="text-xl font-semibold text-white">Заказов нет</div>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden border border-white/10">
                {/* Шапка */}
                <div className="grid grid-cols-[140px_1fr_1fr_140px_120px_140px] bg-white/5 px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest border-b border-white/10">
                  <span>Номер</span>
                  <span>Клиент</span>
                  <span>Город / Адрес</span>
                  <span>Дата</span>
                  <span className="text-right">Сумма</span>
                  <span className="text-right">Статус</span>
                </div>
                {/* Строки */}
                {orders.map((order, idx) => {
                  const cfg = STATUS_CONFIG[order.status]
                  return (
                    <div
                      key={order.id}
                      onClick={() => loadOrderDetail(order.id)}
                      className={`grid grid-cols-[140px_1fr_1fr_140px_120px_140px] items-center px-5 py-4 cursor-pointer transition-colors hover:bg-white/8 ${
                        idx !== orders.length - 1 ? 'border-b border-white/5' : ''
                      }`}
                    >
                      <span className="font-mono text-sm font-bold text-yellow-400">{order.order_number}</span>

                      <div className="pr-4 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{order.customer_name}</div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">{order.customer_phone || order.customer_email}</div>
                      </div>

                      <div className="pr-4 min-w-0">
                        <div className="text-sm text-slate-300 truncate">{order.shipping_city}</div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">{order.shipping_address}</div>
                      </div>

                      <div className="text-xs text-slate-400">
                        {new Date(order.created_at).toLocaleString('ru-RU', {
                          day: '2-digit', month: '2-digit', year: '2-digit',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </div>

                      <div className="text-right text-sm font-bold text-yellow-400">
                        {formatPrice(order.total_amount || 0)}
                      </div>

                      <div className="flex justify-end">
                        <span className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold ${cfg?.bg || 'bg-gray-100'} ${cfg?.color || 'text-gray-600'}`}>
                          {cfg?.icon} {cfg?.label || order.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ============ PRODUCTS TAB ============ */}
        {activeTab === 'products' && (
          <ProductsSection
            products={filterProducts(products).filter(p => (p.condition || 'new') === 'new')}
            categories={categories}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={(p) => { setEditingProduct(p); setIsUsedProductMode(false); setIsProductModalOpen(true) }}
            onNew={() => { setEditingProduct(null); setIsUsedProductMode(false); setIsProductModalOpen(true) }}
            onDelete={deleteProduct}
            onToggleFeatured={toggleFeatured}
            onToggleActive={toggleActive}
            onRefresh={loadProducts}
            authFetch={authFetch}
          />
        )}

        {/* ============ USED PRODUCTS TAB ============ */}
        {activeTab === 'used' && (
          <ProductsSection
            products={filterProducts(products).filter(p => p.condition === 'used')}
            categories={categories}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={(p) => { setEditingProduct(p); setIsUsedProductMode(true); setIsProductModalOpen(true) }}
            onNew={() => { setEditingProduct(null); setIsUsedProductMode(true); setIsProductModalOpen(true) }}
            onDelete={deleteProduct}
            onToggleFeatured={toggleFeatured}
            onToggleActive={toggleActive}
            onRefresh={loadProducts}
            isUsedMode
            authFetch={authFetch}
          />
        )}

        {/* ============ CATEGORIES TAB ============ */}
        {activeTab === 'categories' && (
          <>
            <div className="mb-6 flex justify-between">
              <div className="text-slate-400">{categories.length} категорий</div>
              <button
                onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true) }}
                className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
              >
                + Добавить категорию
              </button>
            </div>

            {categories.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-5xl mb-4">📁</div>
                <div className="text-xl font-semibold text-white mb-4">Категорий нет</div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map(category => (
                  <div key={category.id} className="rounded-2xl bg-white/5 p-6">
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-2xl overflow-hidden">
                          {category.image_url ? (
                            <img src={getImageUrl(category.image_url)} alt="" className="h-full w-full object-cover" />
                          ) : '📁'}
                        </div>
                        <div>
                          <div className="font-semibold text-white">{category.name}</div>
                          <div className="text-sm text-slate-400">/{category.slug}</div>
                        </div>
                      </div>
                      {!category.is_active && (
                        <span className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-400">Скрыта</span>
                      )}
                    </div>
                    {category.description && <p className="mb-4 text-sm text-slate-400">{category.description}</p>}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">
                        {products.filter(p => p.category_id === category.id).length} товаров
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingCategory(category); setIsCategoryModalOpen(true) }} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20">✏️</button>
                        <button onClick={() => deleteCategory(category.id)} className="rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-400 hover:bg-red-900">🗑️</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>  
        )}

        {/* ============ SLIDES TAB ============ */}
        {activeTab === 'slides' && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">🏞 Слайды «Товары недели»</h2>
                <p className="text-sm text-slate-400">Отображаются на главной странице в блоке «Товары недели»</p>
              </div>
              <button
                onClick={() => { setEditingSlide(null); setIsSlideModalOpen(true) }}
                className="rounded-xl bg-yellow-400 px-5 py-3 font-semibold text-gray-900 hover:bg-yellow-300"
              >
                + Новый слайд
              </button>
            </div>

            {slides.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-5xl mb-4">🏞</div>
                <div className="text-xl font-semibold text-white">Слайдов нет</div>
                <div className="mt-2 text-slate-400">Создайте первый слайд для главной страницы</div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {slides.sort((a, b) => a.sort_order - b.sort_order).map(slide => (
                  <div key={slide.id} className="group relative rounded-2xl bg-white/5 overflow-hidden hover:bg-white/10 transition">
                    {/* Colored preview band */}
                    <div className={`h-2 ${slide.color?.includes('from-') ? slide.color : 'bg-gradient-to-r from-yellow-400 to-orange-400'}`} />

                    <div className="p-5">
                      {/* Badges row */}
                      <div className="mb-2 flex flex-wrap gap-1">
                        {slide.badge && <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-xs text-yellow-300">{slide.badge}</span>}
                        {slide.is_new && <span className="rounded-full bg-green-400/20 px-2 py-0.5 text-xs text-green-300">Новинка</span>}
                        <span className={`rounded-full px-2 py-0.5 text-xs ${slide.is_active ? 'bg-green-400/20 text-green-300' : 'bg-red-400/20 text-red-300'}`}>
                          {slide.is_active ? 'Активен' : 'Скрыт'}
                        </span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">#{slide.sort_order + 1}</span>
                      </div>

                      {/* Title */}
                      <div className="mb-1 text-base font-bold text-white leading-snug">{slide.title}</div>
                      {slide.description && <div className="mb-2 text-sm text-slate-400 line-clamp-2">{slide.description}</div>}
                      {slide.price && <div className="text-lg font-bold text-yellow-400">{slide.price} ₽</div>}

                      {/* Tags */}
                      {slide.tags && slide.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {slide.tags.map((t, i) => <span key={i} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-300">{t}</span>)}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => toggleSlideActive(slide)}
                          className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${
                            slide.is_active ? 'bg-white/10 text-slate-300 hover:bg-red-900/40 hover:text-red-300' : 'bg-white/10 text-slate-300 hover:bg-green-900/40 hover:text-green-300'
                          }`}
                        >
                          {slide.is_active ? '⬛ Скрыть' : '✅ Включить'}
                        </button>
                        <button
                          onClick={() => { setEditingSlide(slide); setIsSlideModalOpen(true) }}
                          className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20"
                        >✏️ Редактировать</button>
                        <button
                          onClick={() => deleteSlide(slide.id)}
                          className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-400 hover:bg-red-900/60"
                        >🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ============ ORDER MODAL ============ */}
      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={updateStatus}
          onDelete={deleteOrder}
          updatingStatus={updatingStatus}
        />
      )}

      {/* ============ PRODUCT MODAL ============ */}
      {isProductModalOpen && (
        <ProductModal
          product={editingProduct}
          categories={categories}
          onSave={saveProduct}
          onRefresh={loadProducts}
          onClose={() => { setIsProductModalOpen(false); setEditingProduct(null); setIsUsedProductMode(false) }}
          isUsedMode={isUsedProductMode}
          authFetch={authFetch}
        />
      )}

      {/* ============ CATEGORY MODAL ============ */}
      {isCategoryModalOpen && (
        <CategoryModal
          category={editingCategory}
          onSave={saveCategory}
          onClose={() => { setIsCategoryModalOpen(false); setEditingCategory(null) }}
        />
      )}

      {/* ============ SLIDE MODAL ============ */}
      {isSlideModalOpen && (
        <SlideModal
          slide={editingSlide}
          onSave={saveSlide}
          onClose={() => { setIsSlideModalOpen(false); setEditingSlide(null) }}
          authFetch={authFetch}
        />
      )}
    </div>
  )
}

// ============ PRODUCTS SECTION COMPONENT ============

function ProductsSection({
  products, categories, categoryFilter, setCategoryFilter, searchQuery, setSearchQuery,
  onEdit, onNew, onDelete, onToggleFeatured, onToggleActive, isUsedMode, onRefresh, authFetch
}: {
  products: Product[]
  categories: Category[]
  categoryFilter: string | null
  setCategoryFilter: (id: string | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  onEdit: (p: Product) => void
  onNew: () => void
  onDelete: (id: string) => void
  onToggleFeatured: (p: Product) => void
  onToggleActive: (p: Product) => void
  isUsedMode?: boolean
  onRefresh?: () => void
  authFetch: AuthFetchFn
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (selected.size === products.length) setSelected(new Set())
    else setSelected(new Set(products.map(p => p.id)))
  }

  const mergeSelected = async () => {
    if (selected.size < 2) return
    setMerging(true)
    try {
      const res = await authFetch(`${API_BASE_URL}/api/product-groups/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: [...selected] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Ошибка: ${err.detail || res.status}`)
        return
      }
      setSelected(new Set())
      onRefresh?.()
    } catch { alert('Ошибка при объединении') }
    finally { setMerging(false) }
  }

  const unlinkSelected = async () => {
    if (selected.size === 0) return
    setMerging(true)
    try {
      await authFetch(`${API_BASE_URL}/api/product-groups/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: [...selected] }),
      })
      setSelected(new Set())
      onRefresh?.()
    } catch { alert('Ошибка при разъединении') }
    finally { setMerging(false) }
  }

  // Группируем товары по group_id для визуального отображения
  const groupColors: Record<string, string> = {}
  const groupMembers: Record<string, string[]> = {}
  products.forEach(p => {
    if (p.group_id) {
      if (!groupMembers[p.group_id]) groupMembers[p.group_id] = []
      groupMembers[p.group_id].push(p.color || p.name)
    }
  })
  const palette = ['bg-blue-500/20 text-blue-400', 'bg-purple-500/20 text-purple-400', 'bg-emerald-500/20 text-emerald-400', 'bg-orange-500/20 text-orange-400', 'bg-pink-500/20 text-pink-400', 'bg-cyan-500/20 text-cyan-400']
  let colorIdx = 0
  products.forEach(p => {
    if (p.group_id && !groupColors[p.group_id]) {
      groupColors[p.group_id] = palette[colorIdx % palette.length]
      colorIdx++
    }
  })

  const anySelected = selected.size > 0
  const anySelectedHasGroup = [...selected].some(id => products.find(p => p.id === id)?.group_id)

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {/* Category filter */}
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => setCategoryFilter(e.target.value || null)}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white"
          >
            <option value="">Все категории</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          
          {/* Search */}
          <input
            type="text"
            placeholder="🔍 Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white placeholder-slate-400 w-48"
          />
        </div>
        
        <button
          onClick={onNew}
          className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
        >
          + {isUsedMode ? 'Добавить Б/У товар' : 'Добавить товар'}
        </button>
      </div>

      {/* ── Тулбар выбранных товаров ── */}
      {anySelected && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white/10 px-5 py-3 border border-white/10">
          <span className="text-sm text-slate-300">Выбрано: <b className="text-white">{selected.size}</b></span>
          {selected.size >= 2 && (
            <button
              onClick={mergeSelected}
              disabled={merging}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              🔗 Объединить в группу
            </button>
          )}
          {anySelectedHasGroup && (
            <button
              onClick={unlinkSelected}
              disabled={merging}
              className="rounded-lg bg-red-600/30 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-600/50 disabled:opacity-40"
            >
              ✂ Убрать из группы
            </button>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10"
          >
            Снять выделение
          </button>
        </div>
      )}

      {products.length === 0 ? (
        <div className="rounded-2xl bg-white/5 p-16 text-center">
          <div className="text-5xl mb-4">{isUsedMode ? '♻️' : '📦'}</div>
          <div className="text-xl font-semibold text-white mb-4">{isUsedMode ? 'Б/У товаров нет' : 'Товаров нет'}</div>
          {isUsedMode && <div className="text-slate-400 text-sm">Добавьте первый б/у товар через кнопку выше</div>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left text-sm text-slate-400">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === products.length && products.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded accent-yellow-400"
                  />
                </th>
                <th className="p-4">Товар</th>
                <th className="p-4">Категория</th>
                <th className="p-4">Цена</th>
                <th className="p-4">Наличие</th>
                <th className="p-4">Действия</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => {
                const imgUrl = getImageUrl(product.main_image_url)
                const isChecked = selected.has(product.id)
                const gColor = product.group_id ? groupColors[product.group_id] : null
                return (
                <tr key={product.id} className={`border-b border-white/5 hover:bg-white/5 ${isChecked ? 'bg-white/[0.03]' : ''}`}>
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(product.id)}
                      className="h-4 w-4 rounded accent-yellow-400"
                    />
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      {imgUrl ? (
                        <img src={imgUrl} alt="" className="h-12 w-12 rounded-xl object-cover bg-white/10" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-2xl">📦</div>
                      )}
                      <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                          {product.name}
                          {product.is_featured && <span className="text-yellow-400" title="Хит продаж">⭐</span>}
                          {!product.is_active && <span className="text-red-400 text-xs">(скрыт)</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm text-slate-400">{product.brand || product.sku || '—'}</span>
                          {gColor && product.group_id && (() => {
                            const siblings = groupMembers[product.group_id] || []
                            return (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${gColor}`} title={`Группа: ${siblings.join(', ')}`}>
                                🔗 {siblings.length} {siblings.length === 1 ? 'товар' : siblings.length < 5 ? 'товара' : 'товаров'}
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-slate-300">
                    {categories.find(c => c.id === product.category_id)?.name || '—'}
                  </td>
                  <td className="p-4">
                    <div className="font-semibold text-yellow-400">{formatPrice(product.price)}</div>
                    {product.discount_price && <div className="text-sm text-green-400">{formatPrice(product.discount_price)} со скидкой</div>}
                  </td>
                  <td className="p-4">
                    <span className={`rounded px-2 py-1 text-xs ${
                      product.stock_quantity > 0 
                        ? 'bg-green-900/50 text-green-400' 
                        : 'bg-red-900/50 text-red-400'
                    }`}>
                      {product.stock_quantity > 0 ? `✓ ${product.stock_quantity} шт.` : '✗ Нет'}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <button onClick={() => onEdit(product)} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20" title="Редактировать">✏️</button>
                      <button 
                        onClick={() => onToggleFeatured(product)} 
                        className={`rounded-lg px-3 py-2 text-sm transition ${product.is_featured ? 'bg-yellow-500/30 text-yellow-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                        title="Хит продаж"
                      >
                        ⭐
                      </button>
                      <button 
                        onClick={() => onToggleActive(product)}
                        className={`rounded-lg px-3 py-2 text-sm transition ${product.is_active ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400 hover:bg-red-900'}`}
                        title={product.is_active ? 'Скрыть' : 'Показать'}
                      >
                        {product.is_active ? '👁' : '👁‍🗨'}
                      </button>
                      <button onClick={() => onDelete(product.id)} className="rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-400 hover:bg-red-900" title="Удалить">🗑️</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ============ ORDER MODAL COMPONENT ============

function OrderModal({
  order, onClose, onUpdateStatus, onDelete, updatingStatus
}: {
  order: OrderDetail
  onClose: () => void
  onUpdateStatus: (id: string, status: string) => void
  onDelete: (id: string) => void
  updatingStatus: boolean
}) {
  const cfg = STATUS_CONFIG[order.status]
  // Подгружаем фото товаров по product_id
  const [productImages, setProductImages] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!order.items?.length) return
    order.items.forEach(async (item) => {
      if (!item.product_id) return
      try {
        const res = await fetch(`${API_BASE_URL}/api/products/${item.product_id}`)
        if (!res.ok) return
        const p = await res.json()
        if (p.main_image_url) {
          setProductImages(prev => ({ ...prev, [item.product_id!]: p.main_image_url }))
        }
      } catch { /* нет фото */ }
    })
  }, [order.id])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 pt-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-3xl bg-slate-900 border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* ── Шапка ── */}
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="font-mono text-lg font-bold text-yellow-400">{order.order_number}</span>
              <span className="text-xs text-slate-500">{new Date(order.created_at).toLocaleString('ru-RU')}</span>
            </div>
            <span className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${cfg?.bg || 'bg-gray-100'} ${cfg?.color || 'text-gray-600'}`}>
              {cfg?.icon} {cfg?.label || order.status}
            </span>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white text-xl transition">×</button>
        </div>

        <div className="p-6 space-y-5">

          {/* ── Клиент + Доставка ── */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <span>👤</span> Клиент
              </div>
              <div className="font-bold text-white text-base">{order.customer_name}</div>
              {order.customer_phone && (
                <a href={`tel:${order.customer_phone}`} className="flex items-center gap-2 text-sm text-sky-400 hover:text-sky-300 transition">
                  <span>📞</span> {order.customer_phone}
                </a>
              )}
              {order.customer_email && (
                <a href={`mailto:${order.customer_email}`} className="flex items-center gap-2 text-sm text-sky-400 hover:text-sky-300 transition">
                  <span>📧</span> {order.customer_email}
                </a>
              )}
            </div>
            <div className="rounded-2xl bg-white/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <span>🚚</span> Доставка
              </div>
              <div className="font-bold text-white text-base">{order.shipping_city}</div>
              <div className="text-sm text-slate-400 leading-relaxed">{order.shipping_address}</div>
              {order.shipping_postal_code && (
                <div className="inline-block rounded-lg bg-white/5 px-2 py-0.5 text-xs text-slate-400">Индекс: {order.shipping_postal_code}</div>
              )}
            </div>
          </div>

          {/* ── Примечание ── */}
          {order.customer_note && (
            <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-4">
              <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">💬 Примечание</div>
              <div className="text-sm text-slate-300 whitespace-pre-line">{order.customer_note}</div>
            </div>
          )}
          {order.admin_note && (
            <div className="rounded-2xl bg-yellow-500/10 border border-yellow-500/20 p-4">
              <div className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1">📝 Заметка</div>
              <div className="text-sm text-slate-300">{order.admin_note}</div>
            </div>
          )}

          {/* ── Товары ── */}
          {order.items && order.items.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">📦 Состав заказа — {order.items.length} поз.</div>
              <div className="space-y-2">
                {order.items.map((item, i) => {
                  const imgUrl = item.product_id ? productImages[item.product_id] : undefined
                  const isExternal = imgUrl?.startsWith('http')
                  const fullImg = imgUrl ? (isExternal ? imgUrl : `${API_BASE_URL}${imgUrl}`) : null
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 hover:bg-white/8 transition p-3">
                      {/* Фото */}
                      <div className="flex-shrink-0 h-16 w-16 rounded-xl bg-white/10 overflow-hidden flex items-center justify-center">
                        {fullImg
                          ? <img src={fullImg} alt={item.product_name} className="h-full w-full object-contain p-1" />
                          : <span className="text-2xl">📦</span>
                        }
                      </div>
                      {/* Инфо */}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white text-sm truncate">{item.product_name}</div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {item.product_sku && (
                            <span className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-slate-400">
                              SKU: {item.product_sku}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">{item.quantity} шт. × {formatPrice(item.unit_price)}</span>
                        </div>
                      </div>
                      {/* Сумма */}
                      <div className="flex-shrink-0 text-right">
                        <div className="font-bold text-yellow-400">{formatPrice(item.total_price)}</div>
                        {item.quantity > 1 && <div className="text-xs text-slate-500">за {item.quantity} шт.</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Итого ── */}
          <div className="rounded-2xl bg-gradient-to-r from-yellow-500/20 to-amber-500/10 border border-yellow-500/20 flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-sm text-slate-400">{order.items?.length || 0} позиций</div>
              <div className="text-base font-semibold text-white">Итого к оплате</div>
            </div>
            <div className="text-3xl font-bold text-yellow-400">{formatPrice(order.total_amount || 0)}</div>
          </div>

          {/* ── Смена статуса ── */}
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Изменить статус</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <button
                  key={status}
                  onClick={() => onUpdateStatus(order.id, status)}
                  disabled={updatingStatus || order.status === status}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    order.status === status
                      ? `${config.bg} ${config.color} ring-2 ring-offset-2 ring-offset-slate-900 ring-current`
                      : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white'
                  } disabled:opacity-40`}
                >
                  {config.icon} {config.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Удалить ── */}
          <button
            onClick={() => onDelete(order.id)}
            className="w-full rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-sm font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition"
          >
            🗑️ Удалить заказ
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Brand list ──────────────────────────────────────────────────────────────
const BRANDS = [
  'Apple', 'Samsung', 'Xiaomi', 'Sony', 'Google', 'Huawei', 'Nothing',
  'OnePlus', 'Realme', 'OPPO', 'Vivo', 'Motorola',
  'DJI', 'GoPro',
  'JBL', 'Bose', 'Beats', 'Marshall', 'Sennheiser',
  'Nintendo', 'Microsoft', 'Asus', 'Lenovo', 'HP', 'Dell', 'Acer', 'LG',
]

const MAX_DESC = 3000

interface ImageRecord {
  id: string
  url: string
  file_path: string
  sort_order: number
  is_main: boolean
  original_filename: string
  variant_color?: string | null
}

// ============ PRODUCT MODAL COMPONENT ============

// ─── Category-specific variant axes ─────────────────────────────────────────
// Each axis maps to one DB column (color/storage/size) but gets a custom label
interface VariantAxis {
  field: 'color' | 'storage' | 'size'
  label: string
  placeholder: string
}

const CATEGORY_AXES: Record<string, VariantAxis[]> = {
  smartphones: [
    { field: 'storage', label: 'Память', placeholder: '256 ГБ, 512 ГБ, 1 ТБ…' },
    { field: 'size', label: 'SIM', placeholder: 'SIM + eSIM, Только SIM…' },
  ],
  tablets: [
    { field: 'storage', label: 'Память', placeholder: '128 ГБ, 256 ГБ, 512 ГБ…' },
    { field: 'size', label: 'Связь', placeholder: 'WiFi, WiFi + Cellular…' },
  ],
  laptops: [
    { field: 'storage', label: 'Конфигурация', placeholder: '16/512 ГБ, 32/1 ТБ…' },
    { field: 'size', label: 'Диагональ', placeholder: '14", 16"…' },
  ],
  watches: [
    { field: 'size', label: 'Размер', placeholder: '42 мм, 46 мм…' },
  ],
  headphones: [],
  tv: [
    { field: 'size', label: 'Диагональ', placeholder: '55", 65", 75"…' },
  ],
  gaming: [
    { field: 'storage', label: 'Комплектация', placeholder: 'Digital, Disc…' },
  ],
  accessories: [
    { field: 'size', label: 'Размер / тип', placeholder: 'S, M, L…' },
  ],
}

// Fallback: generic axes for unknown categories
const DEFAULT_AXES: VariantAxis[] = [
  { field: 'storage', label: 'Вариант 1', placeholder: 'Значение…' },
  { field: 'size', label: 'Вариант 2', placeholder: 'Значение…' },
]

function ProductModal({
  product, categories, onSave, onRefresh, onClose, isUsedMode, authFetch
}: {
  product: Product | null
  categories: Category[]
  onSave: (data: Record<string, unknown>, productId?: string) => Promise<Product | null>
  onRefresh: () => void
  onClose: () => void
  isUsedMode?: boolean
  authFetch: AuthFetchFn
}) {
  // ─── Form state (strings to avoid leading-zero issues) ───────────────────
  const [name, setName] = useState(product?.name || '')
  const [brand, setBrand] = useState(product?.brand || '')
  const [brandMode, setBrandMode] = useState<'select' | 'custom'>(
    product?.brand && !BRANDS.includes(product.brand) ? 'custom' : 'select'
  )
  const [model, setModel] = useState(product?.model || '')
  const [categoryId, setCategoryId] = useState(product?.category_id || '')
  const [condition, setCondition] = useState(product?.condition || (isUsedMode ? 'used' : 'new'))

  const [priceStr, setPriceStr] = useState(product?.price ? String(product.price) : '')
  const [discountStr, setDiscountStr] = useState(product?.discount_price ? String(product.discount_price) : '')
  const [stockStr, setStockStr] = useState(product?.stock_quantity != null ? String(product.stock_quantity) : '')
  const [warrantyStr, setWarrantyStr] = useState(product?.warranty_months ? String(product.warranty_months) : '')

  const [sku, setSku] = useState(product?.sku || '')
  const [color, setColor] = useState(product?.color || '')
  const [shortDesc, setShortDesc] = useState(product?.short_description || '')
  const [description, setDescription] = useState(product?.description || '')
  const [isActive, setIsActive] = useState(product?.is_active ?? true)
  const [isFeatured, setIsFeatured] = useState(product?.is_featured ?? false)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedProductId, setSavedProductId] = useState<string | null>(product?.id || null)



  // ─── Images state ─────────────────────────────────────────────────────────
  const [images, setImages] = useState<ImageRecord[]>([])
  const [loadingImages, setLoadingImages] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load images on mount if product already exists
  useEffect(() => {
    if (savedProductId) loadImages(savedProductId)
  }, [savedProductId])

  const loadImages = async (productId: string) => {
    setLoadingImages(true)
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products/${productId}/images`)
      if (res.ok) {
        const data: ImageRecord[] = await res.json()
        setImages(data.sort((a, b) => a.sort_order - b.sort_order))
      }
    } catch {}
    finally { setLoadingImages(false) }
  }

  // ─── Form submit ──────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError(null)

    const price = parseFloat(priceStr)
    if (!priceStr || isNaN(price) || price <= 0) {
      setSaveError('Введите корректную цену (больше 0)')
      return
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      price,
      stock_quantity: parseInt(stockStr) || 0,
      is_active: isActive,
      is_featured: isFeatured,
      condition,
      description: description ? description.slice(0, MAX_DESC) : null,
      short_description: shortDesc || null,
      sku: sku.trim() || null,
      brand: brand.trim() || null,
      model: model.trim() || null,
      color: color.trim() || null,
      category_id: categoryId || null,
    }
    if (discountStr) {
      const dp = parseFloat(discountStr)
      if (!isNaN(dp) && dp > 0) {
        if (dp >= price) { setSaveError('Цена со скидкой должна быть меньше основной цены'); return }
        payload.discount_price = dp
      } else {
        payload.discount_price = null
      }
    } else {
      payload.discount_price = null
    }
    if (warrantyStr) {
      const w = parseInt(warrantyStr)
      payload.warranty_months = (!isNaN(w) && w > 0) ? w : null
    } else {
      payload.warranty_months = null
    }

    setSaving(true)
    try {
      const saved = await onSave(payload, savedProductId || undefined)
      if (saved) {
        setSavedProductId(saved.id)
        // Save variants if dirty
        if (variantsDirty) {
          await saveVariantsToBackend(saved.id)
        }
        onRefresh()
        setSaving(false)
        onClose()
        return
      } else {
        setSaving(false)
      }
    } catch (err) {
      setSaving(false)
      setSaveError(err instanceof Error ? err.message : 'Не удалось сохранить товар. Проверьте данные и повторите.')
    }
  }

  // ─── Image upload ─────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length || !savedProductId) return
    setUploading(true)
    for (const file of files) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await authFetch(`${API_BASE_URL}/api/products/${savedProductId}/images`, {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          alert(`Ошибка загрузки «${file.name}»: ${err.detail || res.status}`)
        }
      } catch { alert(`Ошибка загрузки «${file.name}»`) }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    await loadImages(savedProductId)
    onRefresh()
  }

  const handleDeleteImage = async (imageId: string) => {
    if (!savedProductId || !confirm('Удалить изображение?')) return
    await authFetch(`${API_BASE_URL}/api/products/${savedProductId}/images/${imageId}`, { method: 'DELETE' })
    await loadImages(savedProductId)
    onRefresh()
  }

  const handleSetMain = async (imageId: string) => {
    if (!savedProductId) return
    await authFetch(`${API_BASE_URL}/api/products/${savedProductId}/images/${imageId}/set-main`, { method: 'PATCH' })
    await loadImages(savedProductId)
    onRefresh()
  }

  const moveImage = async (idx: number, dir: -1 | 1) => {
    const newOrder = [...images]
    const target = idx + dir
    if (target < 0 || target >= newOrder.length) return
    ;[newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]]
    setImages(newOrder)
    if (!savedProductId) return
    try {
      await authFetch(`${API_BASE_URL}/api/products/${savedProductId}/images/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids: newOrder.map(i => i.id) }),
      })
      await loadImages(savedProductId)
    } catch {}
  }

  // ─── Variants state (LOCAL-FIRST) ───────────────────────────────────────
  // Local variant type with temp IDs for unsaved variants
  interface LocalVariant {
    id: string            // real UUID or temp_xxx for new ones
    name: string
    sku: string | null
    price: number | null
    discount_price: number | null
    stock_quantity: number
    color: string | null
    storage: string | null
    size: string | null
    sort_order: number
    is_active: boolean
    _isNew?: boolean      // true if not yet saved to backend
    _isDeleted?: boolean  // marked for deletion
    _isDirty?: boolean    // locally edited
  }

  const [variants, setVariants] = useState<LocalVariant[]>([])
  const [, setVariantsLoaded] = useState(false)
  // Attribute constructor
  const [attrStorages, setAttrStorages] = useState<string[]>([])
  const [attrSizes, setAttrSizes] = useState<string[]>([])
  const [newStorageInput, setNewStorageInput] = useState('')
  const [newSizeInput, setNewSizeInput] = useState('')

  // Inline edit for single variant
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editDiscount, setEditDiscount] = useState('')
  const [editStock, setEditStock] = useState('')
  const [editSku, setEditSku] = useState('')
  // Bulk selection
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set())
  // Dirty tracking
  const [variantsDirty, setVariantsDirty] = useState(false)

  useEffect(() => {
    if (savedProductId) loadVariants(savedProductId)
  }, [savedProductId])

  const syncAttrsFromVariants = (vs: LocalVariant[]) => {
    const activeVs = vs.filter(v => !v._isDeleted)
    setAttrStorages([...new Set(activeVs.filter(v => v.storage).map(v => v.storage!))])
    setAttrSizes([...new Set(activeVs.filter(v => v.size).map(v => v.size!))])
  }

  const loadVariants = async (productId: string) => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products/${productId}/variants?only_active=false`)
      if (res.ok) {
        const data: ProductVariant[] = await res.json()
        const local: LocalVariant[] = data.map(v => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          price: v.price,
          discount_price: v.discount_price,
          stock_quantity: v.stock_quantity,
          color: v.color,
          storage: v.storage,
          size: v.size,
          sort_order: v.sort_order,
          is_active: v.is_active,
        }))
        setVariants(local)
        setVariantsLoaded(true)
        syncAttrsFromVariants(local)
      }
    } catch {}
  }

  // Generate matrix LOCALLY — no API call until Save
  const generateMatrix = () => {
    if (attrStorages.length === 0 && attrSizes.length === 0) return

    const axStorages: (string | null)[] = attrStorages.length > 0 ? attrStorages : [null]
    const axSizes: (string | null)[] = attrSizes.length > 0 ? attrSizes : [null]

    // Build existing combos
    const existingCombos = new Set(
      variants.filter(v => !v._isDeleted).map(v => `${v.storage || ''}|${v.size || ''}`)
    )

    let sortIdx = variants.length
    const newVars: LocalVariant[] = []

    for (const stor of axStorages) {
      for (const sz of axSizes) {
        const key = `${stor || ''}|${sz || ''}`
        if (existingCombos.has(key)) continue

        const nameParts = [stor, sz].filter(Boolean) as string[]
        const autoName = nameParts.length > 0 ? nameParts.join(' / ') : name

        newVars.push({
          id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: autoName,
          sku: null,
          price: null,
          discount_price: null,
          stock_quantity: 0,
          color: null,
          storage: stor,
          size: sz,
          sort_order: sortIdx++,
          is_active: true,
          _isNew: true,
        })
      }
    }

    if (newVars.length > 0) {
      setVariants(prev => [...prev, ...newVars])
      setVariantsDirty(true)
    }
  }

  // LOCAL inline save: update variant in local state only
  const saveInlineVariant = (variantId: string) => {
    setVariants(prev => prev.map(v => {
      if (v.id !== variantId) return v
      return {
        ...v,
        price: editPrice ? parseFloat(editPrice) || null : v.price,
        discount_price: editDiscount ? parseFloat(editDiscount) || null : v.discount_price,
        stock_quantity: editStock !== '' ? parseInt(editStock) || 0 : v.stock_quantity,
        sku: editSku.trim() || v.sku,
        _isDirty: true,
      }
    }))
    setEditingVariantId(null)
    setVariantsDirty(true)
  }

  // LOCAL toggle variant active state
  const toggleVariantActive = (v: LocalVariant) => {
    setVariants(prev => prev.map(vr => 
      vr.id === v.id ? { ...vr, is_active: !vr.is_active, _isDirty: true } : vr
    ))
    setVariantsDirty(true)
  }

  // LOCAL delete variant (mark for deletion)
  const deleteVariant = (variantId: string) => {
    setVariants(prev => {
      const v = prev.find(vr => vr.id === variantId)
      if (!v) return prev
      if (v._isNew) {
        // New unsaved variant — just remove from list
        return prev.filter(vr => vr.id !== variantId)
      }
      // Existing variant — mark for deletion
      return prev.map(vr => vr.id === variantId ? { ...vr, _isDeleted: true } : vr)
    })
    setSelectedVariantIds(prev => { const n = new Set(prev); n.delete(variantId); return n })
    setVariantsDirty(true)
  }

  // BULK delete selected variants
  const bulkDeleteSelected = () => {
    if (selectedVariantIds.size === 0) return
    setVariants(prev => prev.map(v => {
      if (!selectedVariantIds.has(v.id)) return v
      if (v._isNew) return { ...v, _isDeleted: true } // will be filtered
      return { ...v, _isDeleted: true }
    }).filter(v => !(v._isNew && v._isDeleted)))
    setSelectedVariantIds(new Set())
    setVariantsDirty(true)
  }

  // BULK delete ALL variants
  const bulkDeleteAll = () => {
    if (!confirm('Удалить ВСЕ варианты? Это действие нельзя отменить.')) return
    setVariants(prev => prev.map(v => {
      if (v._isNew) return { ...v, _isDeleted: true }
      return { ...v, _isDeleted: true }
    }).filter(v => !(v._isNew && v._isDeleted)))
    setSelectedVariantIds(new Set())
    setVariantsDirty(true)
  }

  // Toggle selection
  const toggleVariantSelection = (id: string) => {
    setSelectedVariantIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const toggleSelectAll = () => {
    const visible = variants.filter(v => !v._isDeleted)
    if (selectedVariantIds.size === visible.length) {
      setSelectedVariantIds(new Set())
    } else {
      setSelectedVariantIds(new Set(visible.map(v => v.id)))
    }
  }

  // SAVE variants to backend (called from main Save button)
  const saveVariantsToBackend = async (productId: string) => {
    // 1. Delete marked variants (batch)
    const toDelete = variants.filter(v => v._isDeleted && !v._isNew)
    if (toDelete.length > 0) {
      const idsParam = toDelete.map(v => `variant_ids=${v.id}`).join('&')
      await authFetch(`${API_BASE_URL}/api/products/${productId}/variants?${idsParam}`, {
        method: 'DELETE',
      })
    }

    // 2. Create new variants
    const toCreate = variants.filter(v => v._isNew && !v._isDeleted)
    for (const v of toCreate) {
      await authFetch(`${API_BASE_URL}/api/products/${productId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: v.name,
          sku: v.sku,
          price: v.price,
          discount_price: v.discount_price,
          stock_quantity: v.stock_quantity,
          color: v.color,
          storage: v.storage,
          size: v.size,
          sort_order: v.sort_order,
          is_active: v.is_active,
        }),
      })
    }

    // 3. Update dirty existing variants
    const toUpdate = variants.filter(v => v._isDirty && !v._isNew && !v._isDeleted)
    for (const v of toUpdate) {
      await authFetch(`${API_BASE_URL}/api/products/${productId}/variants/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: v.price,
          discount_price: v.discount_price,
          stock_quantity: v.stock_quantity,
          sku: v.sku,
          is_active: v.is_active,
        }),
      })
    }

    setVariantsDirty(false)
  }

  // Start inline editing for a variant
  const startInlineEdit = (v: LocalVariant) => {
    setEditingVariantId(v.id)
    setEditPrice(v.price ? String(v.price) : '')
    setEditDiscount(v.discount_price ? String(v.discount_price) : '')
    setEditStock(String(v.stock_quantity))
    setEditSku(v.sku || '')
  }



  // ─── Render ──────────────────────────────────────────────────────────────
  const descPct = description.length / MAX_DESC
  const descColor = descPct >= 1 ? 'text-red-400' : descPct >= 0.9 ? 'text-yellow-400' : 'text-slate-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-white">
            {product?.id ? 'Редактировать товар' : (savedProductId ? 'Товар создан ✓' : 'Новый товар')}
          </h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Название *</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          {/* Brand + Model + Category */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Бренд</label>
              {brandMode === 'select' ? (
                <select
                  value={brand}
                  onChange={e => {
                    if (e.target.value === '__custom__') { setBrandMode('custom'); setBrand('') }
                    else setBrand(e.target.value)
                  }}
                  className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
                >
                  <option value="">— не указан —</option>
                  {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="__custom__">Другой…</option>
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={brand}
                    onChange={e => setBrand(e.target.value)}
                    placeholder="Введите бренд"
                    className="min-w-0 flex-1 rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
                  />
                  <button type="button" onClick={() => { setBrandMode('select'); setBrand('') }} className="rounded-xl bg-white/10 px-3 text-slate-400 hover:text-white">✕</button>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Модель</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Категория</label>
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              >
                <option value="">Без категории</option>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">🎨 Цвет товара</label>
            <input
              type="text"
              value={color}
              onChange={e => setColor(e.target.value)}
              placeholder="Чёрный титан, Белый, Голубой…"
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">Цвет для карточки. Товары разных цветов объединяйте через галочки в списке.</p>
          </div>

          {/* Price + Discount + Stock */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цена *</label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={priceStr}
                onFocus={e => { if (e.target.value === '0') setPriceStr('') }}
                onChange={e => setPriceStr(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цена со скидкой</label>
              <input
                type="text"
                inputMode="decimal"
                value={discountStr}
                onFocus={e => { if (e.target.value === '0') setDiscountStr('') }}
                onChange={e => setDiscountStr(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="—"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Кол-во на складе</label>
              <input
                type="text"
                inputMode="numeric"
                value={stockStr}
                onFocus={e => { if (e.target.value === '0') setStockStr('') }}
                onChange={e => setStockStr(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
          </div>

          {/* SKU + Warranty */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Артикул (SKU)</label>
              <input type="text" value={sku} onChange={e => setSku(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Гарантия (мес.)</label>
              <input
                type="text"
                inputMode="numeric"
                value={warrantyStr}
                onFocus={e => { if (e.target.value === '0') setWarrantyStr('') }}
                onChange={e => setWarrantyStr(e.target.value.replace(/\D/g, ''))}
                placeholder="—"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
          </div>

          {/* Short description */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Краткое описание (до 500 симв.)</label>
            <input type="text" maxLength={500} value={shortDesc} onChange={e => setShortDesc(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" />
          </div>

          {/* Full description with counter */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm text-slate-400">Полное описание</label>
              <span className={`text-xs ${descColor}`}>{description.length} / {MAX_DESC}</span>
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, MAX_DESC))}
              rows={5}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          {/* Checkboxes + Condition */}
          <div className="flex flex-wrap items-center gap-6 rounded-xl bg-white/5 p-4">
            <label className="flex cursor-pointer items-center gap-2 text-white">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-5 w-5 rounded" />
              <span>👁 Активен</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-white">
              <input type="checkbox" checked={isFeatured} onChange={e => setIsFeatured(e.target.checked)} className="h-5 w-5 rounded" />
              <span>⭐ Хит продаж</span>
            </label>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-slate-400">Состояние:</span>
              <select
                value={condition}
                onChange={e => setCondition(e.target.value)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white focus:outline-none"
              >
                <option value="new">🆕 Новый</option>
                <option value="used">♻️ Б/У</option>
              </select>
            </div>
          </div>

          {/* Error */}
          {saveError && <div className="rounded-xl bg-red-900/40 border border-red-500/40 p-3 text-sm text-red-300">{saveError}</div>}

          {/* ── PHOTOS ── */}
          {savedProductId && (() => {
            return (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm text-slate-400">📷 Фото товара {images.length > 0 ? `(${images.length})` : ''}</label>
                {images.length > 0 && <span className="text-xs text-slate-500">Нажмите на фото чтобы выбрать обложку</span>}
              </div>

              {/* Upload dropzone */}
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mb-3 w-full rounded-xl border-2 border-dashed border-white/15 py-4 text-center text-sm text-slate-400 transition hover:border-yellow-400/60 hover:text-yellow-400 disabled:opacity-40"
              >
                {uploading ? '⏳ Загружаю…' : '+ Добавить фото (можно несколько сразу)'}
              </button>

              {/* Photo grid */}
              {loadingImages ? (
                <div className="text-center text-sm text-slate-500">Загружаю…</div>
              ) : images.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {images.map((img, idx) => {
                    const src = img.url.startsWith('/') ? `${API_BASE_URL}${img.url}` : img.url
                    return (
                      <div
                        key={img.id}
                        title={img.is_main ? 'Обложка' : 'Нажмите чтобы сделать обложкой'}
                        className={`group relative cursor-pointer rounded-xl overflow-hidden transition ${
                          img.is_main ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-slate-800' : 'hover:ring-1 hover:ring-white/30'
                        }`}
                        onClick={() => !img.is_main && handleSetMain(img.id)}
                      >
                        {/* Image */}
                        <div className="aspect-square bg-white/5">
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        </div>

                        {/* Main badge */}
                        {img.is_main && (
                          <div className="absolute left-1.5 top-1.5 rounded-md bg-yellow-400 px-1.5 py-0.5 text-[10px] font-bold text-gray-900">★ Обложка</div>
                        )}

                        {/* Reorder buttons */}
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-0.5 bg-black/60 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); moveImage(idx, -1) }}
                            disabled={idx === 0}
                            className="flex-1 rounded text-xs text-white disabled:opacity-30 hover:text-yellow-300"
                          >←</button>
                          <span className="text-[10px] text-slate-400">{idx + 1}</span>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); moveImage(idx, 1) }}
                            disabled={idx === images.length - 1}
                            className="flex-1 rounded text-xs text-white disabled:opacity-30 hover:text-yellow-300"
                          >→</button>
                        </div>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleDeleteImage(img.id) }}
                          className="absolute right-1 top-1 hidden items-center justify-center rounded-full bg-black/70 p-0.5 text-red-400 hover:bg-red-900 group-hover:flex"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
            )
          })()}

          {/* Error */}
          {saveError && <div className="rounded-xl bg-red-900/40 border border-red-500/40 p-3 text-sm text-red-300">{saveError}</div>}

          {/* ── VARIANT CONSTRUCTOR — shown when product saved ── */}
          {savedProductId && (() => {
            // ─── Resolve axes for current category ───
            const selectedCat = categories.find(c => c.id === categoryId)
            const catSlug = selectedCat?.slug || ''
            const axes = CATEGORY_AXES[catSlug] || DEFAULT_AXES
            const hasStorageAxis = axes.some(a => a.field === 'storage')
            const hasSizeAxis = axes.some(a => a.field === 'size')

            // If no axes for this category, don't show constructor
            if (axes.length === 0) return null

            // How many combos would be generated
            const totalCombos =
              Math.max(hasStorageAxis ? attrStorages.length : 0, 1) *
              Math.max(hasSizeAxis ? attrSizes.length : 0, 1)
            const existingCount = variants.filter(v => !v._isDeleted).length
            const newCombos = Math.max(0, totalCombos - existingCount)
            const visibleVariants = variants.filter(v => !v._isDeleted)

            // helper to add attr tag
            const addAttr = (
              list: string[],
              setList: React.Dispatch<React.SetStateAction<string[]>>,
              input: string,
              setInput: React.Dispatch<React.SetStateAction<string>>,
            ) => {
              const val = input.trim()
              if (!val || list.includes(val)) return
              setList([...list, val])
              setInput('')
            }

            const removeAttr = (
              list: string[],
              setList: React.Dispatch<React.SetStateAction<string[]>>,
              val: string,
            ) => {
              setList(list.filter(v => v !== val))
            }

            // Combo description
            const comboDesc = axes.map(a => {
              const count = a.field === 'storage' ? attrStorages.length : attrSizes.length
              return count > 0 ? `${count} ${a.label.toLowerCase()}` : '—'
            }).join(' × ')

            return (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-5">
                {/* ─── HEADER ─── */}
                <div>
                  <div className="text-sm font-bold text-white">Конструктор вариантов</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {selectedCat
                      ? axes.length > 0
                        ? <>{selectedCat.name}: {axes.map(a => a.label).join(' → ')}. Добавьте значения и нажмите «Сгенерировать».</>
                        : <>{selectedCat.name}: у этой категории нет осей вариантов.</>
                      : 'Выберите категорию выше чтобы увидеть нужные атрибуты'
                    }
                  </div>
                </div>

                {/* ─── ATTRIBUTE AXES (dynamic per category) ─── */}
                <div className="space-y-4">
                  {axes.map((axis, axIdx) => {
                    const list = axis.field === 'storage' ? attrStorages : attrSizes
                    const setList = axis.field === 'storage' ? setAttrStorages : setAttrSizes
                    const inputVal = axis.field === 'storage' ? newStorageInput : newSizeInput
                    const setInputVal = axis.field === 'storage' ? setNewStorageInput : setNewSizeInput

                    return (
                      <div key={axis.field} className="rounded-xl border border-white/10 p-3.5">
                        <div className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                          {axIdx + 1}. {axis.label}
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2.5">
                          {list.map(val => (
                            <div key={val} className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                              <span className="text-sm font-medium text-white">{val}</span>
                              {/* Remove */}
                              <button
                                type="button"
                                onClick={() => removeAttr(list, setList, val)}
                                className="text-red-500/60 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                              >✕</button>
                            </div>
                          ))}
                          {list.length === 0 && (
                            <span className="text-xs text-slate-600 italic py-1">нет значений</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={inputVal}
                            onChange={e => setInputVal(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttr(list, setList, inputVal, setInputVal) } }}
                            placeholder={axis.placeholder}
                            className="flex-1 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-yellow-400/50 focus:outline-none transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => addAttr(list, setList, inputVal, setInputVal)}
                            className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-yellow-300 hover:bg-white/15 transition-colors"
                          >+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* ─── GENERATE BUTTON ─── */}
                <div className="flex items-center gap-3 rounded-xl border border-yellow-400/20 bg-yellow-400/5 px-4 py-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-yellow-300">
                      {totalCombos} {totalCombos === 1 ? 'комбинация' : totalCombos < 5 ? 'комбинации' : 'комбинаций'}
                      {newCombos > 0 && (
                        <span className="ml-1.5 text-slate-400 font-normal">
                          ({newCombos} {newCombos === 1 ? 'новая' : 'новых'})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">{comboDesc}</div>
                  </div>
                  <button
                    type="button"
                    onClick={generateMatrix}
                    disabled={attrStorages.length === 0 && attrSizes.length === 0}
                    className="rounded-xl bg-yellow-400 px-5 py-2.5 text-sm font-bold text-gray-900 hover:bg-yellow-300 disabled:opacity-40 transition-colors"
                  >
                    ⚡ Сгенерировать
                  </button>
                </div>

                {/* ─── VARIANT MATRIX TABLE ─── */}
                {visibleVariants.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Матрица вариантов ({visibleVariants.length})
                        {variantsDirty && <span className="ml-2 text-yellow-400 normal-case font-normal">● несохранённые изменения</span>}
                      </div>
                      <div className="flex gap-2">
                        {selectedVariantIds.size > 0 && (
                          <button
                            type="button"
                            onClick={bulkDeleteSelected}
                            className="rounded-lg bg-red-900/30 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/50 transition-colors"
                          >
                            🗑 Удалить выбранные ({selectedVariantIds.size})
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={bulkDeleteAll}
                          className="rounded-lg bg-red-900/20 border border-red-500/10 px-3 py-1.5 text-xs text-red-400/70 hover:bg-red-900/40 hover:text-red-400 transition-colors"
                        >
                          🗑 Удалить все
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto overflow-hidden rounded-xl border border-white/10">
                      {/* Table header — dynamic columns */}
                      <div className={`hidden sm:grid gap-2 bg-white/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500`}
                        style={{ gridTemplateColumns: `28px ${axes.map(() => '1fr').join(' ')} 100px 80px 60px 80px` }}>
                        <div className="flex justify-center">
                          <input
                            type="checkbox"
                            checked={selectedVariantIds.size === visibleVariants.length && visibleVariants.length > 0}
                            onChange={toggleSelectAll}
                            className="h-3.5 w-3.5 rounded accent-yellow-400 cursor-pointer"
                          />
                        </div>
                        {axes.map(a => <div key={a.field}>{a.label}</div>)}
                        <div>Цена ₽</div>
                        <div>Остаток</div>
                        <div className="text-center">☑</div>
                        <div></div>
                      </div>
                      {/* Rows */}
                      {[...visibleVariants].sort((a, b) => {
                        const si = attrStorages.indexOf(a.storage || ''); const sj = attrStorages.indexOf(b.storage || '')
                        if (si !== sj) return (si === -1 ? 999 : si) - (sj === -1 ? 999 : sj)
                        return a.sort_order - b.sort_order
                      }).map(v => {
                        const isEditing = editingVariantId === v.id
                        const isSelected = selectedVariantIds.has(v.id)
                        return (
                          <div
                            key={v.id}
                            className={`grid items-center gap-2 border-t border-white/5 px-4 py-2 text-sm transition-colors ${
                              isSelected ? 'bg-yellow-400/5' : ''
                            } ${
                              !v.is_active ? 'bg-red-900/10 opacity-60' : 'hover:bg-white/[0.02]'
                            } ${v._isNew ? 'border-l-2 border-l-green-400/50' : ''}`}
                            style={{ gridTemplateColumns: `28px ${axes.map(() => '1fr').join(' ')} 100px 80px 60px 80px` }}
                          >
                            {/* Checkbox */}
                            <div className="flex justify-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleVariantSelection(v.id)}
                                className="h-3.5 w-3.5 rounded accent-yellow-400 cursor-pointer"
                              />
                            </div>
                            {/* Dynamic axis columns */}
                            {axes.map(a => {
                              const val = a.field === 'storage' ? v.storage : v.size
                              return (
                                <div key={a.field} className="text-slate-300 truncate">
                                  {val || '—'}
                                </div>
                              )
                            })}
                            {/* Price */}
                            <div>
                              {isEditing ? (
                                <input type="text" inputMode="decimal" value={editPrice}
                                  onChange={e => setEditPrice(e.target.value.replace(/[^\d.]/g, ''))}
                                  placeholder="—"
                                  className="w-full rounded border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 text-xs text-white focus:outline-none"
                                  autoFocus />
                              ) : (
                                <span className={`text-xs font-semibold ${v.price ? 'text-yellow-400' : 'text-slate-600'}`}>
                                  {v.price ? formatPrice(v.price) : '—'}
                                </span>
                              )}
                            </div>
                            {/* Stock */}
                            <div>
                              {isEditing ? (
                                <input type="text" inputMode="numeric" value={editStock}
                                  onChange={e => setEditStock(e.target.value.replace(/\D/g, ''))}
                                  className="w-full rounded border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 text-xs text-white focus:outline-none" />
                              ) : (
                                <span className={`text-xs ${v.stock_quantity > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {v.stock_quantity} шт.
                                </span>
                              )}
                            </div>
                            {/* Active toggle */}
                            <div className="flex justify-center">
                              <input
                                type="checkbox"
                                checked={v.is_active}
                                onChange={() => toggleVariantActive(v)}
                                className="h-4 w-4 rounded accent-yellow-400 cursor-pointer"
                              />
                            </div>
                            {/* Actions */}
                            <div className="flex gap-1 justify-end">
                              {isEditing ? (
                                <>
                                  <button type="button"
                                    onClick={() => saveInlineVariant(v.id)}
                                    className="rounded bg-yellow-400 px-2 py-0.5 text-[11px] font-bold text-gray-900 hover:bg-yellow-300">
                                    ✓
                                  </button>
                                  <button type="button"
                                    onClick={() => setEditingVariantId(null)}
                                    className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:text-white">
                                    ✕
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" onClick={() => startInlineEdit(v)}
                                    className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                                    ✎
                                  </button>
                                  <button type="button" onClick={() => deleteVariant(v.id)}
                                    className="rounded bg-red-900/20 border border-red-500/20 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-900/40 transition-colors">
                                    ✕
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {visibleVariants.length === 0 && (
                  <div className="rounded-xl border-2 border-dashed border-white/10 py-8 text-center">
                    <div className="mb-1 text-2xl">📦</div>
                    <div className="text-sm font-medium text-slate-400">Вариантов пока нет</div>
                    <div className="mt-1 text-xs text-slate-600">
                      Добавьте значения в оси выше, затем нажмите «Сгенерировать»
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Buttons */}
          <div className="flex gap-4 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-white/10 py-3 text-white hover:bg-white/20">Закрыть</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50">
              {saving ? 'Сохранение…' : (savedProductId ? 'Сохранить' : 'Создать товар')}
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}

// ============ SLIDE MODAL COMPONENT ============

function SlideModal({
  slide, onSave, onClose, authFetch
}: {
  slide: WeeklySlide | null
  onSave: (data: Record<string, unknown>, id?: string) => Promise<string | null>
  onClose: () => void
  authFetch: AuthFetchFn
}) {
  const [title, setTitle] = useState(slide?.title || '')
  const [badge, setBadge] = useState(slide?.badge || '')
  const [description, setDescription] = useState(slide?.description || '')
  const [price, setPrice] = useState(slide?.price || '')
  const [image, setImage] = useState(slide?.image || '')
  const [color, setColor] = useState(slide?.color || '')
  const [tagsStr, setTagsStr] = useState(slide?.tags?.join(', ') || '')
  const [linkUrl, setLinkUrl] = useState(slide?.link_url || '')
  const [sortOrder, setSortOrder] = useState(String(slide?.sort_order ?? 0))
  const [isNew, setIsNew] = useState(slide?.is_new ?? false)
  const [isActive, setIsActive] = useState(slide?.is_active ?? true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createdSlideId, setCreatedSlideId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const COLOR_PRESETS = [
    { label: 'Серый (дефолт)', value: 'bg-gradient-to-br from-gray-50 via-white to-gray-100' },
    { label: 'Жёлтый', value: 'bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50' },
    { label: 'Синий', value: 'bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50' },
    { label: 'Зелёный', value: 'bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50' },
    { label: 'Розовый', value: 'bg-gradient-to-br from-pink-50 via-rose-50 to-red-50' },
    { label: 'Тёмный', value: 'bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900' },
  ]

  const uploadImage = async (slideId: string, file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await authFetch(`${API_BASE_URL}/api/weekly-slides/${slideId}/image`, {
        method: 'POST',
        body: fd,
      })
      if (res.ok) {
        const data = await res.json()
        setImage(data.url)
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`Ошибка загрузки: ${err.detail || res.status}`)
      }
    } catch { alert('Ошибка загрузки изображения') }
    finally { setUploading(false) }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (slide?.id) {
      // Existing slide — upload directly
      await uploadImage(slide.id, file)
    } else {
      // New slide — save first, then upload
      setSaving(true)
      const payload: Record<string, unknown> = {
        title: title.trim() || 'Новый слайд',
        is_active: isActive,
        is_new: isNew,
        sort_order: parseInt(sortOrder) || 0,
      }
      const savedId = await onSave(payload)
      setSaving(false)
      if (savedId) {
        setCreatedSlideId(savedId)
        await uploadImage(savedId, file)
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      title: title.trim(),
      is_active: isActive,
      is_new: isNew,
      sort_order: parseInt(sortOrder) || 0,
    }
    if (badge.trim()) payload.badge = badge.trim()
    if (description.trim()) payload.description = description.trim()
    if (price.trim()) payload.price = price.trim()
    if (image.trim()) payload.image = image.trim()
    if (color.trim()) payload.color = color.trim()
    if (linkUrl.trim()) payload.link_url = linkUrl.trim()
    const tagsArr = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
    if (tagsArr.length) payload.tags = tagsArr

    setSaving(true)
    const effectiveId = slide?.id || createdSlideId || undefined
    await onSave(payload, effectiveId)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-white">{slide?.id ? 'Редактировать слайд' : 'Новый слайд'}</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Заголовок *</label>
            <input type="text" required value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" placeholder="iPhone 17 Pro" />
          </div>

          {/* Badge + Price */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Бейдж (маленький текст вверху)</label>
              <input type="text" value={badge} onChange={e => setBadge(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" placeholder="Новинка 2025" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цена (текст)</label>
              <input type="text" value={price} onChange={e => setPrice(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" placeholder="от 94 000" />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Описание</label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" />
          </div>

          {/* Image upload + Link */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Изображение</label>
            <div className="space-y-2">
              {/* File upload button */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || saving}
                  className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50"
                >
                  {uploading ? '⏳ Загрузка…' : '📁 Загрузить фото'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                {image && (
                  <span className="text-xs text-green-400 truncate max-w-[200px]">✓ {image.split('/').pop()}</span>
                )}
              </div>
              {/* Preview */}
              {image && (
                <div className="flex items-center gap-3">
                  <img src={image.startsWith('/static') || image.startsWith('/uploads') ? `${API_BASE_URL}${image}` : image} alt="preview" className="h-16 w-16 rounded-lg object-cover bg-white/10" />
                  <button type="button" onClick={() => setImage('')} className="text-xs text-red-400 hover:text-red-300">Удалить</button>
                </div>
              )}
              {/* URL fallback */}
              <input type="text" value={image} onChange={e => setImage(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white focus:bg-white/20 focus:outline-none" placeholder="или URL вручную: /static/..." />
            </div>
          </div>

          {/* Link */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Ссылка (link_url)</label>
            <input type="text" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" placeholder="/catalog?..." />
          </div>

          {/* Background color */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Фон карточки</label>
            <select
              value={color}
              onChange={e => setColor(e.target.value)}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            >
              <option value="">— выберите пресет —</option>
              {COLOR_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {color && <div className="mt-1 text-xs text-slate-500 break-all">{color}</div>}
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Теги (через запятую)</label>
            <input type="text" value={tagsStr} onChange={e => setTagsStr(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none" placeholder="trade-in, гарантия 12 мес., новинка" />
          </div>

          {/* Sort order + Checkboxes */}
          <div className="flex flex-wrap items-center gap-6 rounded-xl bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">Порядок:</label>
              <input type="text" inputMode="numeric" value={sortOrder} onChange={e => setSortOrder(e.target.value.replace(/\D/g, ''))} className="w-16 rounded-lg bg-white/10 px-3 py-2 text-center text-white focus:bg-white/20 focus:outline-none" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-white">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-5 w-5 rounded" />
              <span>👁 Активен</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-white">
              <input type="checkbox" checked={isNew} onChange={e => setIsNew(e.target.checked)} className="h-5 w-5 rounded" />
              <span>🆕 Новинка</span>
            </label>
          </div>

          {/* Buttons */}
          <div className="flex gap-4 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-white/10 py-3 text-white hover:bg-white/20">Отмена</button>
            <button type="submit" disabled={saving || uploading} className="flex-1 rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50">
              {saving ? '⏳ Сохранение…' : slide?.id ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============ CATEGORY MODAL COMPONENT ============

function CategoryModal({
  category, onSave, onClose
}: {
  category: Category | null
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    slug: category?.slug || '',
    description: category?.description || '',
    image_url: category?.image_url || '',
    is_active: category?.is_active ?? true,
  })

  const generateSlug = (name: string) => {
    const map: Record<string, string> = {
      'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 
      'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 
      'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
      'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    }
    return name.toLowerCase().replace(/[^a-zа-яё0-9\s]/g, '').replace(/\s+/g, '-')
      .replace(/[а-яё]/g, (char) => map[char] || char)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      name: formData.name,
      slug: formData.slug,
      is_active: formData.is_active,
    }
    if (formData.description) payload.description = formData.description
    if (formData.image_url) payload.image_url = formData.image_url
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-white">{category ? 'Редактировать' : 'Новая'} категория</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Название *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value })
                if (!category) setFormData(prev => ({ ...prev, slug: generateSlug(e.target.value) }))
              }}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Slug *</label>
            <input
              type="text"
              required
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">URL изображения</label>
            <input
              type="text"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              placeholder="https://..."
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Описание</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-white cursor-pointer">
            <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="h-5 w-5 rounded" />
            Активна (видна на сайте)
          </label>

          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-white/10 py-3 text-white hover:bg-white/20">Отмена</button>
            <button type="submit" className="flex-1 rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300">
              {category ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
