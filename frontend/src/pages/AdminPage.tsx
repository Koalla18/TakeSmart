import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { formatPrice } from '../data/products'

// ============ TYPES ============

interface OrderItem {
  product_id: string
  product_name: string
  product_price: number
  quantity: number
  line_total: number
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
  is_active: boolean
  is_featured: boolean
  category_id: string | null
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

type TabType = 'orders' | 'products' | 'categories'

// ============ HELPERS ============

function getImageUrl(url?: string | null): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  if (url.startsWith('/static') || url.startsWith('/uploads')) return `${API_BASE_URL}${url}`
  return url
}

// ============ MAIN COMPONENT ============

export function AdminPage() {
  const navigate = useNavigate()
  const { isAuthenticated, logout } = useAuth()
  
  const [activeTab, setActiveTab] = useState<TabType>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
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
      const headers = { ...getAuthHeaders(), Accept: 'application/json' }
      let url = `${API_BASE_URL}/api/orders?limit=200`
      if (statusFilter !== 'all') url += `&status=${statusFilter}`
      const res = await fetch(url, { headers })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error('Ошибка')
      const data: PaginatedResponse<Order> = await res.json()
      setOrders(data.items)
    } catch (err) { console.error(err) }
  }

  const loadProducts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/products?limit=500&only_active=false`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data: PaginatedResponse<Product> = await res.json()
        setProducts(data.items)
      }
    } catch (err) { console.error(err) }
  }

  const loadCategories = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/categories?limit=100&only_active=false`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data: PaginatedResponse<Category> = await res.json()
        setCategories(data.items)
      }
    } catch (err) { console.error(err) }
  }

  const loadAllData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await Promise.all([loadOrders(), loadProducts(), loadCategories()])
    } catch { setError('Ошибка загрузки') }
    finally { setIsLoading(false) }
  }

  useEffect(() => { if (isAuthenticated) loadAllData() }, [isAuthenticated])
  useEffect(() => { if (isAuthenticated) loadOrders() }, [statusFilter])

  // Order actions
  const loadOrderDetail = async (orderId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}`, { headers: getAuthHeaders() })
      if (res.ok) {
        const detail: OrderDetail = await res.json()
        setSelectedOrder(detail)
      }
    } catch (err) { console.error(err) }
  }

  const updateStatus = async (orderId: string, newStatus: string) => {
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

  const deleteOrder = async (orderId: string) => {
    if (!confirm('Удалить заказ?')) return
    try {
      await fetch(`${API_BASE_URL}/api/orders/${orderId}`, { method: 'DELETE', headers: getAuthHeaders() })
      setOrders(orders.filter(o => o.id !== orderId))
      setSelectedOrder(null)
    } catch { alert('Ошибка') }
  }

  // Product actions
  const saveProduct = async (productData: Record<string, unknown>) => {
    try {
      const url = editingProduct?.id 
        ? `${API_BASE_URL}/api/products/${editingProduct.id}`
        : `${API_BASE_URL}/api/products`
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

  const deleteProduct = async (productId: string) => {
    if (!confirm('Удалить товар?')) return
    try {
      await fetch(`${API_BASE_URL}/api/products/${productId}`, { method: 'DELETE', headers: getAuthHeaders() })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  const toggleFeatured = async (product: Product) => {
    try {
      await fetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_featured: !product.is_featured })
      })
      loadProducts()
    } catch { alert('Ошибка') }
  }

  const toggleActive = async (product: Product) => {
    try {
      await fetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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

  const deleteCategory = async (categoryId: string) => {
    if (!confirm('Удалить категорию?')) return
    try {
      await fetch(`${API_BASE_URL}/api/categories/${categoryId}`, { method: 'DELETE', headers: getAuthHeaders() })
      loadCategories()
      loadProducts()
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
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 p-4 hover:from-yellow-500/30 hover:to-orange-500/30 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-yellow-500/30 text-3xl">
                  ⭐
                </div>
                <div>
                  <div className="text-sm text-yellow-400 font-medium">Хит продаж на главной</div>
                  <div className="text-lg font-bold text-white">{featuredProduct.name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-yellow-400">{formatPrice(featuredProduct.price)}</div>
                <div className="text-xs text-slate-400">отображается на главной</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { id: 'orders' as TabType, label: '📋 Заказы', count: orders.length },
            { id: 'products' as TabType, label: '📦 Товары', count: products.length },
            { id: 'categories' as TabType, label: '📁 Категории', count: categories.length },
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
                { id: 'pending', label: '🆕 Новые' },
                { id: 'confirmed', label: '✅ Подтверждённые' },
                { id: 'processing', label: '⏳ В работе' },
                { id: 'shipped', label: '🚚 Отправлены' },
                { id: 'delivered', label: '📦 Доставлены' },
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
                    onClick={() => loadOrderDetail(order.id)}
                    className="cursor-pointer rounded-2xl bg-white/5 p-5 transition-all hover:bg-white/10 hover:scale-[1.02]"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 font-bold text-white text-xs">
                          {order.order_number}
                        </div>
                        <div>
                          <div className="font-semibold text-white">{order.customer_name}</div>
                          <div className="text-sm text-slate-400">{order.customer_phone || order.customer_email}</div>
                        </div>
                      </div>
                      <span className={`rounded-lg px-2 py-1 text-xs font-medium ${STATUS_CONFIG[order.status]?.bg || 'bg-gray-100'} ${STATUS_CONFIG[order.status]?.color || 'text-gray-600'}`}>
                        {STATUS_CONFIG[order.status]?.icon} {STATUS_CONFIG[order.status]?.label || order.status}
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

        {/* ============ PRODUCTS TAB ============ */}
        {activeTab === 'products' && (
          <ProductsSection
            products={filterProducts(products)}
            categories={categories}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={(p) => { setEditingProduct(p); setIsProductModalOpen(true) }}
            onNew={() => { setEditingProduct(null); setIsProductModalOpen(true) }}
            onDelete={deleteProduct}
            onToggleFeatured={toggleFeatured}
            onToggleActive={toggleActive}
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
  products, categories, categoryFilter, setCategoryFilter, searchQuery, setSearchQuery,
  onEdit, onNew, onDelete, onToggleFeatured, onToggleActive
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
}) {
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
          + Добавить товар
        </button>
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl bg-white/5 p-16 text-center">
          <div className="text-5xl mb-4">📦</div>
          <div className="text-xl font-semibold text-white mb-4">Товаров нет</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left text-sm text-slate-400">
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
                return (
                <tr key={product.id} className="border-b border-white/5 hover:bg-white/5">
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
                        <div className="text-sm text-slate-400">{product.brand || product.sku || '—'}</div>
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Заказ {order.order_number}</h2>
            <p className="text-slate-400">{new Date(order.created_at).toLocaleString('ru-RU')}</p>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white/5 p-4">
            <div className="text-sm text-slate-400">Клиент</div>
            <div className="font-semibold text-white">{order.customer_name}</div>
            <div className="text-slate-300">{order.customer_phone}</div>
            <div className="text-slate-300">{order.customer_email}</div>
          </div>
          <div className="rounded-xl bg-white/5 p-4">
            <div className="text-sm text-slate-400">Доставка</div>
            <div className="text-white">{order.shipping_city}</div>
            <div className="text-sm text-slate-400 mt-1">{order.shipping_address}</div>
            {order.shipping_postal_code && <div className="text-sm text-slate-400">Индекс: {order.shipping_postal_code}</div>}
          </div>
        </div>

        {order.customer_note && (
          <div className="mb-6 rounded-xl bg-blue-900/20 border border-blue-500/30 p-4">
            <div className="text-sm text-blue-400 mb-1">Комментарий клиента</div>
            <div className="text-white">{order.customer_note}</div>
          </div>
        )}

        {order.admin_note && (
          <div className="mb-6 rounded-xl bg-yellow-900/20 border border-yellow-500/30 p-4">
            <div className="text-sm text-yellow-400 mb-1">Заметка администратора</div>
            <div className="text-white">{order.admin_note}</div>
          </div>
        )}

        {order.items && order.items.length > 0 && (
          <div className="mb-6">
            <div className="text-sm text-slate-400 mb-3">Товары</div>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-xl">📦</div>
                  <div className="flex-1">
                    <div className="font-medium text-white">{item.product_name}</div>
                    <div className="text-sm text-slate-400">{item.quantity} × {formatPrice(item.product_price)}</div>
                  </div>
                  <div className="font-bold text-yellow-400">{formatPrice(item.line_total)}</div>
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
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    description: product?.description || '',
    short_description: product?.short_description || '',
    price: product?.price || 0,
    discount_price: product?.discount_price || null as number | null,
    stock_quantity: product?.stock_quantity ?? 0,
    sku: product?.sku || '',
    brand: product?.brand || '',
    model: product?.model || '',
    color: product?.color || '',
    warranty_months: product?.warranty_months || null as number | null,
    is_active: product?.is_active ?? true,
    is_featured: product?.is_featured ?? false,
    category_id: product?.category_id || null as string | null,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      name: formData.name,
      price: formData.price,
      stock_quantity: formData.stock_quantity,
      is_active: formData.is_active,
      is_featured: formData.is_featured,
    }
    // Only include optional fields if they have values
    if (formData.description) payload.description = formData.description
    if (formData.short_description) payload.short_description = formData.short_description
    if (formData.discount_price) payload.discount_price = formData.discount_price
    if (formData.sku) payload.sku = formData.sku
    if (formData.brand) payload.brand = formData.brand
    if (formData.model) payload.model = formData.model
    if (formData.color) payload.color = formData.color
    if (formData.warranty_months) payload.warranty_months = formData.warranty_months
    if (formData.category_id) payload.category_id = formData.category_id

    onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-white">
            {product?.id ? 'Редактировать' : 'Новый'} товар
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
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
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
              <label className="mb-1 block text-sm text-slate-400">Модель</label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Категория</label>
              <select
                value={formData.category_id || ''}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value || null })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              >
                <option value="">Без категории</option>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
          </div>

          {/* Price */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цена *</label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цена со скидкой</label>
              <input
                type="number"
                step="0.01"
                value={formData.discount_price || ''}
                onChange={(e) => setFormData({ ...formData, discount_price: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Кол-во на складе</label>
              <input
                type="number"
                min="0"
                value={formData.stock_quantity}
                onChange={(e) => setFormData({ ...formData, stock_quantity: Number(e.target.value) })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Артикул (SKU)</label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Цвет</label>
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder="Чёрный титан"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Гарантия (мес.)</label>
              <input
                type="number"
                min="0"
                max="120"
                value={formData.warranty_months || ''}
                onChange={(e) => setFormData({ ...formData, warranty_months: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
              />
            </div>
          </div>

          {/* Short Description */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Краткое описание (до 500 симв.)</label>
            <input
              type="text"
              maxLength={500}
              value={formData.short_description}
              onChange={(e) => setFormData({ ...formData, short_description: e.target.value })}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Полное описание</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white focus:bg-white/20 focus:outline-none"
            />
          </div>

          {/* Note about images */}
          <div className="rounded-xl bg-blue-900/20 border border-blue-500/30 p-4">
            <div className="text-sm text-blue-300">
              📷 Изображения загружаются через API: POST /api/products/{'{id}'}/images после создания товара.
            </div>
          </div>

          {/* Checkboxes */}
          <div className="flex flex-wrap gap-6 rounded-xl bg-white/5 p-4">
            <label className="flex items-center gap-2 text-white cursor-pointer">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="h-5 w-5 rounded" />
              <span>👁 Активен</span>
            </label>
            <label className="flex items-center gap-2 text-white cursor-pointer">
              <input type="checkbox" checked={formData.is_featured} onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })} className="h-5 w-5 rounded" />
              <span>⭐ Хит продаж</span>
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
