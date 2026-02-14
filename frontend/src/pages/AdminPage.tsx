import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { formatPrice } from '../data/products'

// ============ TYPES ============

interface OrderItem {
  product_id: string
  name: string
  price: number
  quantity: number
  image: string
}

interface Order {
  id: number
  name: string
  phone: string
  email: string
  comment: string | null
  items: OrderItem[] | null
  total_amount: number | null
  payment_method: string | null
  delivery_method: string | null
  delivery_address: string | null
  status: string
  created_at: string
}

interface Category {
  id: number
  slug: string
  name: string
  description: string | null
  icon: string | null
  sort_order: number
  is_active: boolean
}

interface Product {
  id: number
  name: string
  slug: string
  brand: string | null
  category_id: number | null
  price: number
  old_price: number | null
  badge: string | null
  in_stock: boolean
  is_used: boolean
  is_featured: boolean
  image: string | null
  images: string[] | null
  description: string | null
  specs: { label: string; value: string }[] | null
  sort_order: number
  is_active: boolean
  // Variant fields
  variant_group_id: string | null
  color: string | null
  color_code: string | null
  storage: string | null
}

interface Analytics {
  total_orders: number
  today_orders: number
  week_orders: number
  status_counts: Record<string, number>
  total_revenue: number
  today_revenue: number
  avg_order_value: number
  payment_stats: Record<string, number>
  delivery_stats: Record<string, number>
  daily_orders: { date: string; count: number; revenue: number }[]
}

// ============ CONSTANTS ============

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  new: { label: 'Новый', color: 'text-blue-600', bg: 'bg-blue-100', icon: '🆕' },
  processing: { label: 'В обработке', color: 'text-orange-600', bg: 'bg-orange-100', icon: '⏳' },
  ready: { label: 'Готов', color: 'text-green-600', bg: 'bg-green-100', icon: '✅' },
  completed: { label: 'Выполнен', color: 'text-gray-600', bg: 'bg-gray-200', icon: '📦' },
  cancelled: { label: 'Отменён', color: 'text-red-600', bg: 'bg-red-100', icon: '❌' },
}

const PAYMENT_LABELS: Record<string, string> = { cash: '💵 Наличные', card: '💳 Картой' }
const DELIVERY_LABELS: Record<string, string> = { pickup: '🏪 Самовывоз', courier: '🚗 Курьер', post: '📦 Почта' }

type TabType = 'orders' | 'products' | 'used' | 'categories' | 'analytics'

// ============ MAIN COMPONENT ============

export function AdminPage() {
  const navigate = useNavigate()
  const { isAuthenticated, logout } = useAuth()
  
  const [activeTab, setActiveTab] = useState<TabType>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [_error, setError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!isAuthenticated) navigate('/login', { replace: true })
  }, [isAuthenticated, navigate])

  // Data loading
  const loadOrders = async () => {
    try {
      const headers = { ...getAuthHeaders(), Accept: 'application/json' }
      const url = statusFilter === 'all' ? `${API_BASE_URL}/api/orders` : `${API_BASE_URL}/api/orders?status=${statusFilter}`
      const res = await fetch(url, { headers })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error('Ошибка')
      setOrders(await res.json())
    } catch (err) { console.error(err) }
  }

  const loadAnalytics = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/analytics`, { headers: getAuthHeaders() })
      if (res.ok) setAnalytics(await res.json())
    } catch (err) { console.error(err) }
  }

  const loadProducts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/products`, { headers: getAuthHeaders() })
      if (res.ok) setProducts(await res.json())
    } catch (err) { console.error(err) }
  }

  const loadCategories = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/categories`, { headers: getAuthHeaders() })
      if (res.ok) setCategories(await res.json())
    } catch (err) { console.error(err) }
  }

  const loadAllData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await Promise.all([loadOrders(), loadAnalytics(), loadProducts(), loadCategories()])
    } catch { setError('Ошибка загрузки') }
    finally { setIsLoading(false) }
  }

  const seedDatabase = async () => {
    if (!confirm('Заполнить базу данных начальными товарами и категориями?')) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/seed`, { method: 'POST', headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        alert(`✅ ${data.message}\nКатегорий: ${data.categories_count}\nТоваров: ${data.products_created}`)
        loadAllData()
      }
    } catch { alert('Ошибка') }
  }

  useEffect(() => { if (isAuthenticated) loadAllData() }, [isAuthenticated])
  useEffect(() => { if (isAuthenticated) loadOrders() }, [statusFilter])

  // Order actions
  const updateStatus = async (orderId: number, newStatus: string) => {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (!res.ok) throw new Error('Ошибка')
      setOrders(orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
      if (selectedOrder?.id === orderId) setSelectedOrder({ ...selectedOrder, status: newStatus })
    } catch { alert('Ошибка') }
    finally { setUpdatingStatus(false) }
  }

  const deleteOrder = async (orderId: number) => {
    if (!confirm('Удалить заказ?')) return
    try {
      await fetch(`${API_BASE_URL}/api/orders/${orderId}`, { method: 'DELETE', headers: getAuthHeaders() })
      setOrders(orders.filter(o => o.id !== orderId))
      setSelectedOrder(null)
    } catch { alert('Ошибка') }
  }

  // Product actions
  const saveProduct = async (productData: Partial<Product>) => {
    try {
      const url = editingProduct?.id 
        ? `${API_BASE_URL}/api/admin/products/${editingProduct.id}`
        : `${API_BASE_URL}/api/admin/products`
      const res = await fetch(url, {
        method: editingProduct?.id ? 'PATCH' : 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Ошибка')
      }
      setIsProductModalOpen(false)
      setEditingProduct(null)
      loadProducts()
    } catch (err) { alert(err instanceof Error ? err.message : 'Ошибка') }
  }

  const deleteProduct = async (productId: number) => {
    if (!confirm('Удалить товар?')) return
    try {
      await fetch(`${API_BASE_URL}/api/admin/products/${productId}`, { method: 'DELETE', headers: getAuthHeaders() })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  const setFeaturedProduct = async (productId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/products/${productId}/set-featured`, {
        method: 'POST',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        loadProducts()
        alert('✅ Хит продаж установлен!')
      }
    } catch { alert('Ошибка') }
  }

  const toggleProductStock = async (product: Product) => {
    try {
      await fetch(`${API_BASE_URL}/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_stock: !product.in_stock })
      })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  // Category actions
  const saveCategory = async (categoryData: Partial<Category>) => {
    try {
      const url = editingCategory?.id 
        ? `${API_BASE_URL}/api/admin/categories/${editingCategory.id}`
        : `${API_BASE_URL}/api/admin/categories`
      const res = await fetch(url, {
        method: editingCategory?.id ? 'PATCH' : 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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

  const deleteCategory = async (categoryId: number) => {
    if (!confirm('Удалить категорию?')) return
    try {
      await fetch(`${API_BASE_URL}/api/admin/categories/${categoryId}`, { method: 'DELETE', headers: getAuthHeaders() })
      loadCategories()
      loadProducts()
    } catch { alert('Ошибка') }
  }

  // Filtering
  const regularProducts = products.filter(p => !p.is_used)
  const usedProducts = products.filter(p => p.is_used)
  
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
            <button onClick={seedDatabase} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">
              🌱 Заполнить БД
            </button>
            <a href="/" className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">← На сайт</a>
            <button onClick={() => { logout(); navigate('/login') }} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Новых товаров', value: regularProducts.length, icon: '📦', gradient: 'from-blue-500 to-cyan-500' },
            { label: 'Б/У товаров', value: usedProducts.length, icon: '🔄', gradient: 'from-purple-500 to-pink-500' },
            { label: 'Категорий', value: categories.length, icon: '📁', gradient: 'from-indigo-500 to-violet-500' },
            { label: 'Заказов', value: analytics?.today_orders || 0, icon: '🛒', gradient: 'from-green-500 to-emerald-500' },
            { label: 'Выручка', value: formatPrice(analytics?.today_revenue || 0), icon: '💰', gradient: 'from-yellow-500 to-orange-500' },
          ].map((stat, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl bg-white/5 p-5 backdrop-blur">
              <div className={`absolute -right-4 -top-4 h-16 w-16 rounded-full bg-gradient-to-br ${stat.gradient} opacity-20 blur-2xl`} />
              <span className="text-2xl">{stat.icon}</span>
              <div className="mt-1 text-xl font-bold text-white">{stat.value}</div>
              <div className="text-xs text-slate-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Featured Product Banner */}
        {featuredProduct && (
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-500/30 text-2xl">
                  ⭐
                </div>
                <div>
                  <div className="text-sm text-yellow-400">Хит продаж на главной</div>
                  <div className="font-bold text-white">{featuredProduct.name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-yellow-400">{formatPrice(featuredProduct.price)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { id: 'orders' as TabType, label: '📋 Заказы', count: orders.length },
            { id: 'products' as TabType, label: '📦 Новые товары', count: regularProducts.length },
            { id: 'used' as TabType, label: '🔄 Б/У товары', count: usedProducts.length },
            { id: 'categories' as TabType, label: '📁 Категории', count: categories.length },
            { id: 'analytics' as TabType, label: '📊 Аналитика' },
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
            <div className="mb-6 flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'Все' },
                { id: 'new', label: '🆕 Новые' },
                { id: 'processing', label: '⏳ В работе' },
                { id: 'ready', label: '✅ Готовы' },
                { id: 'completed', label: '📦 Выполнены' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    statusFilter === f.id ? 'bg-white text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {orders.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-5xl mb-4">📭</div>
                <div className="text-xl font-semibold text-white">Заказов нет</div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {orders.map(order => (
                  <div
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className="cursor-pointer rounded-2xl bg-white/5 p-5 transition-all hover:bg-white/10 hover:scale-[1.02]"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 font-bold text-white">
                          #{order.id}
                        </div>
                        <div>
                          <div className="font-semibold text-white">{order.name}</div>
                          <div className="text-sm text-slate-400">{order.phone}</div>
                        </div>
                      </div>
                      <span className={`rounded-lg px-2 py-1 text-xs font-medium ${STATUS_CONFIG[order.status]?.bg} ${STATUS_CONFIG[order.status]?.color}`}>
                        {STATUS_CONFIG[order.status]?.icon} {STATUS_CONFIG[order.status]?.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">{new Date(order.created_at).toLocaleString('ru-RU')}</span>
                      <span className="font-bold text-yellow-400">{formatPrice(order.total_amount || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ============ PRODUCTS TAB (New Products) ============ */}
        {activeTab === 'products' && (
          <ProductsSection
            products={filterProducts(regularProducts)}
            categories={categories}
            isUsed={false}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={(p) => { setEditingProduct(p); setIsProductModalOpen(true) }}
            onNew={() => { setEditingProduct(null); setIsProductModalOpen(true) }}
            onDelete={deleteProduct}
            onSetFeatured={setFeaturedProduct}
            onToggleStock={toggleProductStock}
            seedDatabase={seedDatabase}
          />
        )}

        {/* ============ USED PRODUCTS TAB ============ */}
        {activeTab === 'used' && (
          <ProductsSection
            products={filterProducts(usedProducts)}
            categories={categories}
            isUsed={true}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={(p) => { setEditingProduct(p); setIsProductModalOpen(true) }}
            onNew={() => { setEditingProduct({ is_used: true } as Product); setIsProductModalOpen(true) }}
            onDelete={deleteProduct}
            onSetFeatured={setFeaturedProduct}
            onToggleStock={toggleProductStock}
            seedDatabase={seedDatabase}
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
                <button onClick={seedDatabase} className="rounded-lg bg-green-600 px-6 py-3 text-white">🌱 Заполнить БД</button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map(category => (
                  <div key={category.id} className="rounded-2xl bg-white/5 p-6">
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-2xl">
                          {category.icon || '📁'}
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

        {/* ============ ANALYTICS TAB ============ */}
        {activeTab === 'analytics' && analytics && (
          <div className="space-y-8">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-6">
                <h3 className="mb-4 text-lg font-semibold text-white">Заказы за 14 дней</h3>
                <div className="flex items-end gap-2 h-48">
                  {analytics.daily_orders.map((day, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div 
                        className="w-full bg-yellow-400/80 rounded-t transition-all"
                        style={{ height: `${Math.max(4, (day.count / Math.max(...analytics.daily_orders.map(d => d.count || 1))) * 100)}%` }}
                      />
                      <span className="text-xs text-slate-500">{day.date}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 p-6">
                <h3 className="mb-4 text-lg font-semibold text-white">Статистика</h3>
                <div className="space-y-4">
                  <div className="flex justify-between"><span className="text-slate-400">Всего заказов</span><span className="font-bold text-white">{analytics.total_orders}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Выручка всего</span><span className="font-bold text-yellow-400">{formatPrice(analytics.total_revenue)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Средний чек</span><span className="font-bold text-white">{formatPrice(analytics.avg_order_value)}</span></div>
                </div>
              </div>
            </div>
          </div>
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
          onClose={() => { setIsProductModalOpen(false); setEditingProduct(null) }}
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
    </div>
  )
}

// ============ PRODUCTS SECTION COMPONENT ============

function ProductsSection({
  products, categories, isUsed, categoryFilter, setCategoryFilter, searchQuery, setSearchQuery,
  onEdit, onNew, onDelete, onSetFeatured, onToggleStock, seedDatabase
}: {
  products: Product[]
  categories: Category[]
  isUsed: boolean
  categoryFilter: number | null
  setCategoryFilter: (id: number | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  onEdit: (p: Product) => void
  onNew: () => void
  onDelete: (id: number) => void
  onSetFeatured: (id: number) => void
  onToggleStock: (p: Product) => void
  seedDatabase: () => void
}) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {/* Category filter */}
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white"
          >
            <option value="">Все категории</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
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
          + Добавить {isUsed ? 'Б/У' : 'товар'}
        </button>
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl bg-white/5 p-16 text-center">
          <div className="text-5xl mb-4">{isUsed ? '🔄' : '📦'}</div>
          <div className="text-xl font-semibold text-white mb-4">
            {isUsed ? 'Б/У товаров нет' : 'Товаров нет'}
          </div>
          <button onClick={seedDatabase} className="rounded-lg bg-green-600 px-6 py-3 text-white">🌱 Заполнить БД</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left text-sm text-slate-400">
                <th className="p-4">Товар</th>
                <th className="p-4">Категория</th>
                <th className="p-4">Цена</th>
                <th className="p-4">Статус</th>
                <th className="p-4">Действия</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => {
                const imageUrl = product.images?.[0]
                const displayImage = imageUrl?.startsWith('/uploads') ? `${API_BASE_URL}${imageUrl}` : imageUrl
                return (
                <tr key={product.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {displayImage ? (
                          <img src={displayImage} alt="" className="h-12 w-12 rounded-xl object-cover bg-white/10" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-2xl">
                            {product.image || '📦'}
                          </div>
                        )}
                        {product.images && product.images.length > 1 && (
                          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
                            +{product.images.length - 1}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                          {product.name}
                          {product.is_featured && <span className="text-yellow-400" title="Хит продаж">⭐</span>}
                        </div>
                        <div className="text-sm text-slate-400">{product.brand || 'Без бренда'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-slate-300">
                    {categories.find(c => c.id === product.category_id)?.name || '—'}
                  </td>
                  <td className="p-4">
                    <div className="font-semibold text-yellow-400">{formatPrice(product.price)}</div>
                    {product.old_price && <div className="text-sm text-slate-500 line-through">{formatPrice(product.old_price)}</div>}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => onToggleStock(product)}
                        className={`rounded px-2 py-1 text-xs transition ${
                          product.in_stock 
                            ? 'bg-green-900/50 text-green-400 hover:bg-green-900' 
                            : 'bg-red-900/50 text-red-400 hover:bg-red-900'
                        }`}
                      >
                        {product.in_stock ? '✓ В наличии' : '✗ Нет'}
                      </button>
                      {product.is_used && <span className="rounded bg-purple-900/50 px-2 py-1 text-xs text-purple-400">Б/У</span>}
                      {product.badge && <span className="rounded bg-yellow-900/50 px-2 py-1 text-xs text-yellow-400">{product.badge}</span>}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <button onClick={() => onEdit(product)} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20" title="Редактировать">✏️</button>
                      {!isUsed && (
                        <button 
                          onClick={() => onSetFeatured(product.id)} 
                          className={`rounded-lg px-3 py-2 text-sm transition ${product.is_featured ? 'bg-yellow-500/30 text-yellow-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                          title="Сделать хитом продаж"
                        >
                          ⭐
                        </button>
                      )}
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
  order: Order
  onClose: () => void
  onUpdateStatus: (id: number, status: string) => void
  onDelete: (id: number) => void
  updatingStatus: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Заказ #{order.id}</h2>
            <p className="text-slate-400">{new Date(order.created_at).toLocaleString('ru-RU')}</p>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white/5 p-4">
            <div className="text-sm text-slate-400">Клиент</div>
            <div className="font-semibold text-white">{order.name}</div>
            <div className="text-slate-300">{order.phone}</div>
            <div className="text-slate-300">{order.email}</div>
          </div>
          <div className="rounded-xl bg-white/5 p-4">
            <div className="text-sm text-slate-400">Доставка и оплата</div>
            <div className="text-white">{DELIVERY_LABELS[order.delivery_method || ''] || order.delivery_method}</div>
            <div className="text-white">{PAYMENT_LABELS[order.payment_method || ''] || order.payment_method}</div>
            {order.delivery_address && <div className="text-sm text-slate-400 mt-2">{order.delivery_address}</div>}
          </div>
        </div>

        {order.items && order.items.length > 0 && (
          <div className="mb-6">
            <div className="text-sm text-slate-400 mb-3">Товары</div>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-xl">{item.image}</div>
                  <div className="flex-1">
                    <div className="font-medium text-white">{item.name}</div>
                    <div className="text-sm text-slate-400">{item.quantity} × {formatPrice(item.price)}</div>
                  </div>
                  <div className="font-bold text-yellow-400">{formatPrice(item.price * item.quantity)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between rounded-xl bg-yellow-400/20 p-4">
          <span className="text-white">Итого</span>
          <span className="text-2xl font-bold text-yellow-400">{formatPrice(order.total_amount || 0)}</span>
        </div>

        <div className="mb-6">
          <div className="text-sm text-slate-400 mb-3">Изменить статус</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <button
                key={status}
                onClick={() => onUpdateStatus(order.id, status)}
                disabled={updatingStatus || order.status === status}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  order.status === status ? `${config.bg} ${config.color}` : 'bg-white/10 text-white hover:bg-white/20'
                } disabled:opacity-50`}
              >
                {config.icon} {config.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => onDelete(order.id)} className="w-full rounded-xl bg-red-600/20 py-3 text-red-400 hover:bg-red-600/30">
          🗑️ Удалить заказ
        </button>
      </div>
    </div>
  )
}

// ============ PRODUCT MODAL COMPONENT ============

function ProductModal({
  product, categories, onSave, onClose
}: {
  product: Product | null
  categories: Category[]
  onSave: (data: Partial<Product>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    slug: product?.slug || '',
    brand: product?.brand || '',
    category_id: product?.category_id || null,
    price: product?.price || 0,
    old_price: product?.old_price || null,
    badge: product?.badge || '',
    in_stock: product?.in_stock ?? true,
    is_used: product?.is_used ?? false,
    is_featured: product?.is_featured ?? false,
    image: product?.image || '',
    description: product?.description || '',
    sort_order: product?.sort_order || 0,
    is_active: product?.is_active ?? true,
    // Variant fields
    variant_group_id: product?.variant_group_id || '',
    color: product?.color || '',
    color_code: product?.color_code || '#000000',
    storage: product?.storage || '',
  })

  const [images, setImages] = useState<string[]>(product?.images || [])
  const [newImageUrl, setNewImageUrl] = useState('')

  const [specs, setSpecs] = useState<{ label: string; value: string }[]>(
    product?.specs || [{ label: '', value: '' }]
  )

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

  const addImage = () => {
    if (newImageUrl && !images.includes(newImageUrl)) {
      setImages([...images, newImageUrl])
      setNewImageUrl('')
    }
  }

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validSpecs = specs.filter(s => s.label && s.value)
    onSave({
      ...formData,
      old_price: formData.old_price || null,
      badge: formData.badge || null,
      images: images.length > 0 ? images : null,
      specs: validSpecs.length > 0 ? validSpecs : null,
      // Variant fields - send null if empty
      variant_group_id: formData.variant_group_id || null,
      color: formData.color || null,
      color_code: formData.color ? formData.color_code : null,
      storage: formData.storage || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-white">
            {product?.id ? 'Редактировать' : 'Новый'} {formData.is_used ? 'Б/У товар' : 'товар'}
          </h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Название *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value })
                  if (!product?.id) setFormData(prev => ({ ...prev, slug: generateSlug(e.target.value) }))
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Бренд</label>
              <input
                type="text"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Категория</label>
              <select
                value={formData.category_id || ''}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              >
                <option value="">Без категории</option>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
          </div>

          {/* Variant Options */}
          <div className="rounded-xl border border-dashed border-slate-600 p-4">
            <label className="mb-3 block text-sm font-medium text-yellow-400">🎨 Параметры вариантов (для группировки)</label>
            <p className="mb-3 text-xs text-slate-400">
              Товары с одинаковым ID группы вариантов будут показаны вместе с возможностью выбора цвета/накопителя.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-slate-400">ID группы вариантов</label>
                <input
                  type="text"
                  placeholder="Пример: iphone-15-pro-max"
                  value={formData.variant_group_id}
                  onChange={(e) => setFormData({ ...formData, variant_group_id: e.target.value })}
                  className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">Накопитель</label>
                <input
                  type="text"
                  placeholder="256 ГБ, 512 ГБ, 1 ТБ..."
                  value={formData.storage}
                  onChange={(e) => setFormData({ ...formData, storage: e.target.value })}
                  className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-slate-400">Название цвета</label>
                <input
                  type="text"
                  placeholder="Чёрный титан, Синий, Белый..."
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">Код цвета (HEX)</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.color_code}
                    onChange={(e) => setFormData({ ...formData, color_code: e.target.value })}
                    className="h-12 w-12 cursor-pointer rounded-xl bg-white/10"
                  />
                  <input
                    type="text"
                    placeholder="#000000"
                    value={formData.color_code}
                    onChange={(e) => setFormData({ ...formData, color_code: e.target.value })}
                    className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Price */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цена *</label>
              <input
                type="number"
                required
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Старая цена</label>
              <input
                type="number"
                value={formData.old_price || ''}
                onChange={(e) => setFormData({ ...formData, old_price: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Бейдж</label>
              <select
                value={formData.badge}
                onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              >
                <option value="">Нет</option>
                <option value="hit">🔥 Хит</option>
                <option value="new">✨ Новинка</option>
                <option value="sale">💸 Скидка</option>
              </select>
            </div>
          </div>

          {/* Images Gallery */}
          <div>
            <label className="mb-2 block text-sm text-slate-400">📷 Галерея изображений</label>
            <p className="mb-3 rounded-lg bg-blue-500/20 p-2 text-xs text-blue-300">
              💡 Рекомендуемое разрешение: <b>800×800px</b> или <b>1200×1200px</b> (квадратное). Форматы: <b>JPG, PNG, WebP</b>. Макс. размер: 10MB.
            </p>
            
            {/* Current images */}
            {images.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-3">
                {images.map((url, i) => (
                  <div key={i} className="relative group">
                    <img src={url.startsWith('/uploads') ? `${API_BASE_URL}${url}` : url} alt="" className="h-20 w-20 rounded-xl object-cover bg-white/10" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white text-xs opacity-0 group-hover:opacity-100 transition"
                    >
                      ×
                    </button>
                    {i === 0 && (
                      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded bg-yellow-500 px-1 text-[10px] text-black">
                        Главное
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {/* File upload */}
            <div className="mb-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-600 bg-white/5 px-4 py-6 text-slate-400 transition hover:border-yellow-500 hover:bg-white/10">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={async (e) => {
                    const files = e.target.files
                    if (!files) return
                    for (const file of Array.from(files)) {
                      const fd = new FormData()
                      fd.append('file', file)
                      try {
                        const res = await fetch(`${API_BASE_URL}/api/admin/upload`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
                          body: fd
                        })
                        if (res.ok) {
                          const data = await res.json()
                          setImages(prev => [...prev, data.url])
                        } else {
                          const err = await res.json()
                          alert(err.detail || 'Ошибка загрузки')
                        }
                      } catch (err) {
                        alert('Ошибка загрузки файла')
                      }
                    }
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                <span className="text-2xl">📤</span>
                <span>Нажмите для загрузки фото или перетащите файлы</span>
              </label>
            </div>
            
            {/* Add image by URL */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Или вставьте URL изображения..."
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
              <button
                type="button"
                onClick={addImage}
                className="rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-500"
              >
                Добавить
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Первое изображение будет главным.</p>
          </div>

          {/* Emoji fallback */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Emoji (если нет фото)</label>
              <input
                type="text"
                value={formData.image}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                placeholder="📱"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Порядок сортировки</label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Описание</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          {/* Specs */}
          <div>
            <label className="mb-2 block text-sm text-slate-400">📋 Характеристики</label>
            {specs.map((spec, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Параметр"
                  value={spec.label}
                  onChange={(e) => {
                    const newSpecs = [...specs]
                    newSpecs[i].label = e.target.value
                    setSpecs(newSpecs)
                  }}
                  className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Значение"
                  value={spec.value}
                  onChange={(e) => {
                    const newSpecs = [...specs]
                    newSpecs[i].value = e.target.value
                    setSpecs(newSpecs)
                  }}
                  className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
                />
                <button type="button" onClick={() => setSpecs(specs.filter((_, idx) => idx !== i))} className="rounded-xl bg-red-900/50 px-3 text-red-400 hover:bg-red-900">×</button>
              </div>
            ))}
            <button type="button" onClick={() => setSpecs([...specs, { label: '', value: '' }])} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">
              + Добавить характеристику
            </button>
          </div>

          {/* Checkboxes */}
          <div className="flex flex-wrap gap-6 rounded-xl bg-white/5 p-4">
            <label className="flex items-center gap-2 text-white cursor-pointer">
              <input type="checkbox" checked={formData.in_stock} onChange={(e) => setFormData({ ...formData, in_stock: e.target.checked })} className="h-5 w-5 rounded" />
              <span>✓ В наличии</span>
            </label>
            <label className="flex items-center gap-2 text-white cursor-pointer">
              <input type="checkbox" checked={formData.is_used} onChange={(e) => setFormData({ ...formData, is_used: e.target.checked })} className="h-5 w-5 rounded" />
              <span>🔄 Б/У товар</span>
            </label>
            <label className="flex items-center gap-2 text-white cursor-pointer">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="h-5 w-5 rounded" />
              <span>👁 Активен</span>
            </label>
          </div>

          {/* Buttons */}
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-white/10 py-3 text-white hover:bg-white/20">Отмена</button>
            <button type="submit" className="flex-1 rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300">
              {product?.id ? 'Сохранить' : 'Создать'}
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
  onSave: (data: Partial<Category>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    slug: category?.slug || '',
    description: category?.description || '',
    icon: category?.icon || '',
    sort_order: category?.sort_order || 0,
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
    onSave(formData)
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Иконка (emoji)</label>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder="📱"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Порядок</label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
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
