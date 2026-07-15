import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { formatPrice } from '../data/products'
import { toast, ToastHost } from '../lib/toast'
import { confirmDialog, ConfirmHost } from '../lib/confirm'

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
  quick_filters: { label: string; query: string }[] | null
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

type TabType = 'orders' | 'products' | 'categories' | 'banners' | 'slides' | 'used'

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

interface HeroBanner {
  id: string
  badge: string | null
  title: string
  highlight: string | null
  description: string | null
  image: string | null
  cta_label: string | null
  cta_link: string | null
  secondary_label: string | null
  secondary_link: string | null
  sort_order: number
  is_active: boolean
}

function getImageUrl(url?: string | null): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  if (url.startsWith('/static') || url.startsWith('/uploads')) return `${API_BASE_URL}${url}`
  return url
}

/**
 * Ужимает изображение в браузере ПЕРЕД загрузкой: даунскейл до maxDim по большей
 * стороне и кодирование в WebP (сохраняет прозрачность) до размера < maxBytes.
 * Нужно, т.к. nginx на проде режет тело запроса > ~1 МБ (413 Request Entity Too Large),
 * а hero-баннеры/фото часто весят больше — из-за чего загрузка «висла». Если это не
 * растровое изображение или что-то пошло не так — возвращаем исходный файл без изменений.
 */
async function compressImageForUpload(file: File, maxDim = 1600, maxBytes = 900_000): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(new Error('read failed'))
      fr.readAsDataURL(file)
    })
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('decode failed'))
      im.src = dataUrl
    })
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    // Уже маленькая и лёгкая — не трогаем.
    if (scale === 1 && file.size <= maxBytes) return file
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    const toBlob = (q: number) => new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', q))
    let quality = 0.92
    let blob = await toBlob(quality)
    while (blob && blob.size > maxBytes && quality > 0.4) {
      quality -= 0.12
      blob = await toBlob(quality)
    }
    if (!blob || blob.size >= file.size) return file // сжатие не помогло — оставляем оригинал
    const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
    return new File([blob], name, { type: 'image/webp' })
  } catch {
    return file
  }
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
  const [orderSearch, setOrderSearch] = useState('')
  const [orderPage, setOrderPage] = useState(1)
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
  const [banners, setBanners] = useState<HeroBanner[]>([])
  const [editingBanner, setEditingBanner] = useState<HeroBanner | null>(null)
  const [isBannerModalOpen, setIsBannerModalOpen] = useState(false)
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false)
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
      const chunkSize = 1000
      let offset = 0
      let allItems: Product[] = []
      while (true) {
        const res = await authFetch(`${API_BASE_URL}/api/products?limit=${chunkSize}&offset=${offset}&only_active=false`)
        if (!res.ok) break

        const data: PaginatedResponse<Product> | Product[] = await res.json()
        const items = Array.isArray(data) ? data : (data.items ?? [])
        allItems = allItems.concat(items)

        const hasNext = Array.isArray(data)
          ? items.length === chunkSize
          : Boolean(data.has_next)

        if (!hasNext || items.length === 0) break
        offset += items.length
      }
      setProducts(allItems)
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

  const loadBanners = async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/hero-banners/all`)
      if (res.ok) setBanners(await res.json())
    } catch (err) { console.error(err) }
  }

  const loadAllData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await Promise.all([loadOrders(), loadProducts(), loadCategories(), loadSlides(), loadBanners()])
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
    } catch { toast('Ошибка', 'error') }
    finally { setUpdatingStatus(false) }
  }

  const deleteOrder = async (orderId: string) => {
    if (!(await confirmDialog({ title: 'Удалить заказ?', message: 'Заказ будет удалён без возможности восстановления.', confirmLabel: 'Удалить' }))) return
    try {
      await authFetch(`${API_BASE_URL}/api/orders/${orderId}`, { method: 'DELETE' })
      setOrders(orders.filter(o => o.id !== orderId))
      setSelectedOrder(null)
    } catch { toast('Ошибка', 'error') }
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
    if (!(await confirmDialog({ title: 'Удалить товар?', message: 'Товар будет удалён из каталога.', confirmLabel: 'Удалить' }))) return
    try {
      await authFetch(`${API_BASE_URL}/api/products/${productId}`, { method: 'DELETE' })
      loadProducts()
    } catch { toast('Ошибка', 'error') }
  }

  const toggleFeatured = async (product: Product) => {
    try {
      await authFetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_featured: !product.is_featured })
      })
      loadProducts()
    } catch { toast('Ошибка', 'error') }
  }

  const toggleActive = async (product: Product) => {
    try {
      await authFetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !product.is_active })
      })
      loadProducts()
    } catch { toast('Ошибка', 'error') }
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
    } catch (err) { toast(err instanceof Error ? err.message : 'Ошибка', 'error') }
  }

  const deleteCategory = async (categoryId: string) => {
    // Check how many products use this category
    const productsInCategory = products.filter(p => p.category_id === categoryId)
    const categoryName = categories.find(c => c.id === categoryId)?.name || 'Категория'

    const message = productsInCategory.length > 0
      ? `Удалить категорию «${categoryName}»?\n\n⚠️ В этой категории ${productsInCategory.length} товар(ов). Сначала переместите или удалите их, либо категория не удалится.`
      : `Удалить категорию «${categoryName}»?`

    if (!(await confirmDialog({ title: 'Удалить категорию?', message, confirmLabel: 'Удалить' }))) return
    try {
      const res = await authFetch(`${API_BASE_URL}/api/categories/${categoryId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        if (res.status === 409) {
          toast(`Невозможно удалить категорию «${categoryName}»: к ней привязаны товары.\n\nСначала переместите все товары в другую категорию или удалите их.`, 'error', 6000)
        } else {
          toast(err?.detail || `Ошибка ${res.status}`, 'error')
        }
        return
      }
      loadCategories()
      loadProducts()
    } catch { toast('Ошибка сети', 'error') }
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
    } catch (err) { toast(err instanceof Error ? err.message : 'Ошибка', 'error'); return null }
  }

  const deleteSlide = async (slideId: string) => {
    if (!(await confirmDialog({ title: 'Удалить слайд?', message: 'Слайд «Товары недели» будет удалён.', confirmLabel: 'Удалить' }))) return
    try {
      await authFetch(`${API_BASE_URL}/api/weekly-slides/${slideId}`, { method: 'DELETE' })
      loadSlides()
    } catch { toast('Ошибка', 'error') }
  }

  const toggleSlideActive = async (slide: WeeklySlide) => {
    try {
      await authFetch(`${API_BASE_URL}/api/weekly-slides/${slide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !slide.is_active }),
      })
      loadSlides()
    } catch { toast('Ошибка', 'error') }
  }

  // Hero banners actions
  const saveBanner = async (data: Record<string, unknown>, bannerId?: string): Promise<string | null> => {
    try {
      const url = bannerId ? `${API_BASE_URL}/api/hero-banners/${bannerId}` : `${API_BASE_URL}/api/hero-banners`
      const res = await authFetch(url, {
        method: bannerId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Ошибка') }
      const saved = await res.json()
      loadBanners()
      return saved.id as string
    } catch (err) { toast(err instanceof Error ? err.message : 'Ошибка', 'error'); return null }
  }

  const deleteBanner = async (bannerId: string) => {
    if (!(await confirmDialog({ title: 'Удалить баннер?', message: 'Баннер главной страницы будет удалён.', confirmLabel: 'Удалить' }))) return
    try {
      await authFetch(`${API_BASE_URL}/api/hero-banners/${bannerId}`, { method: 'DELETE' })
      loadBanners()
    } catch { toast('Ошибка', 'error') }
  }

  const toggleBannerActive = async (banner: HeroBanner) => {
    try {
      await authFetch(`${API_BASE_URL}/api/hero-banners/${banner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !banner.is_active }),
      })
      loadBanners()
    } catch { toast('Ошибка', 'error') }
  }

  const moveBanner = async (banner: HeroBanner, dir: -1 | 1) => {
    const sorted = [...banners].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(b => b.id === banner.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    try {
      await Promise.all([
        authFetch(`${API_BASE_URL}/api/hero-banners/${banner.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: swap.sort_order }) }),
        authFetch(`${API_BASE_URL}/api/hero-banners/${swap.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: banner.sort_order }) }),
      ])
      loadBanners()
    } catch { toast('Ошибка', 'error') }
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <header className="border-b border-white/10 bg-slate-900/90 px-4 py-4">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-white/10" />
            <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-11 w-36 animate-pulse rounded-xl bg-white/10" />
            ))}
          </div>
          <div className="space-y-2 rounded-2xl border border-white/10 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const ORDERS_PER_PAGE = 15
  const filteredOrders = orders.filter(o => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false
    const q = orderSearch.trim().toLowerCase()
    if (!q) return true
    return [o.order_number, o.customer_name, o.customer_phone, o.customer_email, o.shipping_city, o.shipping_address]
      .some(v => String(v ?? '').toLowerCase().includes(q))
  })
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE))
  const safeOrderPage = Math.min(orderPage, orderPageCount)
  const pagedOrders = filteredOrders.slice((safeOrderPage - 1) * ORDERS_PER_PAGE, safeOrderPage * ORDERS_PER_PAGE)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <ToastHost />
      <ConfirmHost />
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
            { label: 'Всего заказов', value: orders.length, icon: '📋', gradient: 'from-blue-500 to-cyan-500', tab: 'orders' as TabType, status: 'all' },
            { label: 'Новых заказов', value: pendingCount, icon: '🔔', gradient: 'from-red-500 to-rose-500', tab: 'orders' as TabType, status: 'pending' },
            { label: 'Товаров', value: products.length, icon: '📦', gradient: 'from-indigo-500 to-violet-500', tab: 'products' as TabType, status: 'all' },
            { label: 'Категорий', value: categories.length, icon: '📁', gradient: 'from-green-500 to-emerald-500', tab: 'categories' as TabType, status: 'all' },
          ].map((stat, i) => (
            <button
              key={i}
              onClick={() => { setActiveTab(stat.tab); if (stat.tab === 'orders') { setStatusFilter(stat.status); setOrderPage(1) } }}
              className="group relative overflow-hidden rounded-2xl bg-white/5 p-5 text-left backdrop-blur transition-all hover:bg-white/10 hover:ring-1 hover:ring-white/20"
            >
              <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br ${stat.gradient} opacity-20 blur-2xl`} />
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{stat.icon}</span>
                <span className="ml-auto text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">→</span>
              </div>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-xs text-slate-400">{stat.label}</div>
            </button>
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
            { id: 'categories' as TabType, label: '📁 Категории', count: categories.length },
            { id: 'banners' as TabType, label: '🖼 Баннеры', count: banners.length },
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
          {/* Б/У — скрыто, недоступно */}
          <div className="group relative rounded-xl px-5 py-3 text-sm font-medium bg-white/5 text-white/30 cursor-not-allowed select-none">
            <span>♻️ Б/У</span>
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-200 bg-white/5 backdrop-blur-sm flex items-center justify-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-white/50 text-xs">Скоро</span>
            </div>
          </div>
          {/* Слайды недели — скрыто, недоступно */}
          <div className="group relative rounded-xl px-5 py-3 text-sm font-medium bg-white/5 text-white/30 cursor-not-allowed select-none">
            <span>🏞 Слайды недели</span>
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-200 bg-white/5 backdrop-blur-sm flex items-center justify-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-white/50 text-xs">Скоро</span>
            </div>
          </div>
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
                  onClick={() => { setStatusFilter(f.id); setOrderPage(1) }}
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

            {/* Поиск по заказам */}
            <div className="relative mb-4 max-w-md">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
              <input
                value={orderSearch}
                onChange={e => { setOrderSearch(e.target.value); setOrderPage(1) }}
                placeholder="Поиск: номер, имя, телефон, email, город…"
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-9 text-sm text-white placeholder-slate-500 outline-none focus:border-yellow-400/50"
              />
              {orderSearch && (
                <button onClick={() => { setOrderSearch(''); setOrderPage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Очистить">✕</button>
              )}
            </div>

            {orders.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-5xl mb-4">📭</div>
                <div className="text-xl font-semibold text-white">Заказов нет</div>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-12 text-center">
                <div className="text-4xl mb-3">🔍</div>
                <div className="text-lg font-semibold text-white">Ничего не найдено</div>
                <div className="mt-1 text-sm text-slate-400">Измените запрос или фильтр статуса</div>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-2xl border border-white/10 md:block">
                  <div className="min-w-[900px]">
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
                    {pagedOrders.map((order, idx) => {
                      const cfg = STATUS_CONFIG[order.status]
                      return (
                        <div
                          key={order.id}
                          onClick={() => loadOrderDetail(order.id)}
                          className={`grid grid-cols-[140px_1fr_1fr_140px_120px_140px] items-center px-5 py-4 cursor-pointer transition-colors hover:bg-white/8 ${
                            idx !== pagedOrders.length - 1 ? 'border-b border-white/5' : ''
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
                </div>

                {/* Мобильные карточки заказов (вместо таблицы на узких экранах) */}
                <div className="space-y-3 md:hidden">
                  {pagedOrders.map(order => {
                    const cfg = STATUS_CONFIG[order.status]
                    return (
                      <div
                        key={order.id}
                        onClick={() => loadOrderDetail(order.id)}
                        className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-bold text-yellow-400">{order.order_number}</span>
                          <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${cfg?.bg || 'bg-gray-100'} ${cfg?.color || 'text-gray-600'}`}>
                            {cfg?.icon} {cfg?.label || order.status}
                          </span>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-white">{order.customer_name}</div>
                        <div className="text-xs text-slate-500">{order.customer_phone || order.customer_email}</div>
                        <div className="mt-1 text-xs text-slate-400">{order.shipping_city}{order.shipping_address ? `, ${order.shipping_address}` : ''}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-slate-500">
                            {new Date(order.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-sm font-bold text-yellow-400">{formatPrice(order.total_amount || 0)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {orderPageCount > 1 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
                    <span>Показаны {(safeOrderPage - 1) * ORDERS_PER_PAGE + 1}–{Math.min(safeOrderPage * ORDERS_PER_PAGE, filteredOrders.length)} из {filteredOrders.length}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setOrderPage(p => Math.max(1, p - 1))} disabled={safeOrderPage <= 1} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white transition hover:bg-white/20 disabled:opacity-40">← Назад</button>
                      <span className="px-1 text-white">{safeOrderPage} / {orderPageCount}</span>
                      <button onClick={() => setOrderPage(p => Math.min(orderPageCount, p + 1))} disabled={safeOrderPage >= orderPageCount} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white transition hover:bg-white/20 disabled:opacity-40">Вперёд →</button>
                    </div>
                  </div>
                )}
              </>
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
            onCreateGroup={() => setIsGroupModalOpen(true)}
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
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">📂 Категории</h2>
                <p className="text-sm text-slate-400">{categories.length} категорий • управление каталогом</p>
              </div>
              <button
                onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true) }}
                className="rounded-xl bg-yellow-400 px-5 py-3 font-semibold text-gray-900 hover:bg-yellow-300 transition-colors"
              >
                + Новая категория
              </button>
            </div>

            {categories.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-6xl mb-4">📁</div>
                <div className="text-xl font-semibold text-white mb-2">Категорий пока нет</div>
                <p className="text-slate-400 mb-6">Создайте первую категорию для организации товаров</p>
                <button
                  onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true) }}
                  className="rounded-xl bg-yellow-400 px-6 py-3 font-semibold text-gray-900 hover:bg-yellow-300"
                >
                  + Создать категорию
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {categories.map(category => {
                  const productCount = products.filter(p => p.category_id === category.id).length
                  return (
                    <div key={category.id} className="group rounded-2xl bg-white/5 hover:bg-white/[0.08] transition-colors overflow-hidden">
                      <div className="flex items-center gap-4 p-4">
                        {/* Image */}
                        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 overflow-hidden">
                          {category.image_url ? (
                            <img src={getImageUrl(category.image_url)} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-3xl">📁</span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-white truncate">{category.name}</div>
                            {!category.is_active && (
                              <span className="flex-shrink-0 rounded-full bg-red-900/50 px-2 py-0.5 text-[10px] font-bold text-red-400 uppercase">Скрыта</span>
                            )}
                          </div>
                          <div className="text-sm text-slate-500">/{category.slug}</div>
                          {category.description && (
                            <p className="mt-1 text-xs text-slate-400 line-clamp-1">{category.description}</p>
                          )}
                          {category.quick_filters && category.quick_filters.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {category.quick_filters.slice(0, 4).map((qf, i) => (
                                <span key={i} className="rounded-full bg-yellow-400/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400">{qf.label}</span>
                              ))}
                              {category.quick_filters.length > 4 && (
                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">+{category.quick_filters.length - 4}</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Product count */}
                        <div className="flex-shrink-0 text-center px-3">
                          <div className="text-lg font-bold text-white">{productCount}</div>
                          <div className="text-[10px] text-slate-500 uppercase">товаров</div>
                        </div>

                        {/* Actions */}
                        <div className="flex-shrink-0 flex gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingCategory(category); setIsCategoryModalOpen(true) }}
                            className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20 transition-colors"
                            title="Редактировать"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteCategory(category.id)}
                            className="rounded-xl bg-red-900/30 px-3 py-2 text-sm text-red-400 hover:bg-red-900/60 transition-colors"
                            title="Удалить"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ============ BANNERS TAB ============ */}
        {activeTab === 'banners' && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">🖼 Баннеры главной страницы</h2>
                <p className="text-sm text-slate-400">Большой слайдер вверху главной. Порядок — стрелками, показ — «Активен».</p>
              </div>
              <button
                onClick={() => { setEditingBanner(null); setIsBannerModalOpen(true) }}
                className="rounded-xl bg-yellow-400 px-5 py-3 font-semibold text-gray-900 hover:bg-yellow-300"
              >
                + Новый баннер
              </button>
            </div>

            {banners.length === 0 ? (
              <div className="rounded-2xl bg-white/5 p-16 text-center">
                <div className="text-5xl mb-4">🖼</div>
                <div className="text-xl font-semibold text-white">Баннеров нет</div>
                <div className="mt-2 text-slate-400">Создайте первый баннер для главной страницы</div>
              </div>
            ) : (
              <div className="space-y-4">
                {[...banners].sort((a, b) => a.sort_order - b.sort_order).map((banner, i, arr) => (
                  <div key={banner.id} className={`overflow-hidden rounded-2xl border bg-white/5 ${banner.is_active ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
                    <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                      {/* Мини-превью — как на сайте */}
                      <div className="flex min-w-0 flex-1 items-center gap-4 rounded-xl bg-gradient-to-br from-gray-50 via-white to-gray-100 p-4">
                        <div className="min-w-0 flex-1">
                          {banner.badge && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />{banner.badge}
                            </span>
                          )}
                          <div className="mt-1 text-lg font-bold leading-tight text-gray-900">
                            {banner.title} {banner.highlight && <span className="text-yellow-500">{banner.highlight}</span>}
                          </div>
                          {banner.description && <div className="mt-0.5 line-clamp-1 text-xs text-gray-500">{banner.description}</div>}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {banner.cta_label && <span className="rounded-md bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-white">{banner.cta_label}</span>}
                            {banner.secondary_label && <span className="rounded-md border border-gray-300 px-2 py-0.5 text-[10px] font-semibold text-gray-700">{banner.secondary_label}</span>}
                          </div>
                        </div>
                        {banner.image
                          ? <img src={getImageUrl(banner.image)} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-contain" />
                          : <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">🖼</div>}
                      </div>

                      {/* Управление */}
                      <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-end">
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${banner.is_active ? 'bg-green-400/20 text-green-300' : 'bg-red-400/20 text-red-300'}`}>{banner.is_active ? 'Активен' : 'Скрыт'}</span>
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-400">#{i + 1}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button onClick={() => moveBanner(banner, -1)} disabled={i === 0} className="rounded-lg bg-white/10 px-2.5 py-2 text-xs text-white hover:bg-white/20 disabled:opacity-30" title="Выше">↑</button>
                          <button onClick={() => moveBanner(banner, 1)} disabled={i === arr.length - 1} className="rounded-lg bg-white/10 px-2.5 py-2 text-xs text-white hover:bg-white/20 disabled:opacity-30" title="Ниже">↓</button>
                          <button onClick={() => toggleBannerActive(banner)} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/20">{banner.is_active ? '⬛ Скрыть' : '✅ Включить'}</button>
                          <button onClick={() => { setEditingBanner(banner); setIsBannerModalOpen(true) }} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20">✏️ Изменить</button>
                          <button onClick={() => deleteBanner(banner.id)} className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-400 hover:bg-red-900/60">🗑</button>
                        </div>
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

      {/* ============ GROUP CREATION MODAL ============ */}
      {isGroupModalOpen && (
        <GroupCreationModal
          categories={categories}
          onClose={() => setIsGroupModalOpen(false)}
          onCreated={() => { setIsGroupModalOpen(false); loadProducts() }}
          authFetch={authFetch}
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

      {isBannerModalOpen && (
        <BannerModal
          banner={editingBanner}
          onSave={saveBanner}
          onClose={() => { setIsBannerModalOpen(false); setEditingBanner(null) }}
          authFetch={authFetch}
        />
      )}
    </div>
  )
}

// ============ PRODUCTS SECTION COMPONENT ============

function ProductsSection({
  products, categories, categoryFilter, setCategoryFilter, searchQuery, setSearchQuery,
  onEdit, onNew, onDelete, onToggleFeatured, onToggleActive, isUsedMode, onRefresh, authFetch, onCreateGroup
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
  onCreateGroup?: () => void
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
        toast(`Ошибка: ${err.detail || res.status}`, 'error')
        return
      }
      setSelected(new Set())
      onRefresh?.()
    } catch { toast('Ошибка при объединении', 'error') }
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
    } catch { toast('Ошибка при разъединении', 'error') }
    finally { setMerging(false) }
  }

  const deleteSelected = async () => {
    if (selected.size === 0) return
    if (!(await confirmDialog({ title: `Удалить ${selected.size} товаров?`, message: 'Это действие нельзя отменить.', confirmLabel: `Удалить ${selected.size}` }))) return
    setMerging(true)
    let deleted = 0
    for (const id of selected) {
      try {
        await authFetch(`${API_BASE_URL}/api/products/${id}`, { method: 'DELETE' })
        deleted++
      } catch { /* skip */ }
    }
    setSelected(new Set())
    onRefresh?.()
    setMerging(false)
    if (deleted > 0 && deleted < selected.size) toast(`Удалено ${deleted} из ${selected.size}`, 'info')
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
        
        <div className="flex gap-2">
          {onCreateGroup && !isUsedMode && (
            <button
              onClick={onCreateGroup}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              🔗 Создать группу
            </button>
          )}
          <button
            onClick={onNew}
            className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
          >
            + {isUsedMode ? 'Добавить Б/У товар' : 'Добавить товар'}
          </button>
        </div>
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
            onClick={deleteSelected}
            disabled={merging}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
          >
            🗑 Удалить ({selected.size})
          </button>
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
        <>
        {/* Десктоп: таблица (на мобиле — карточки ниже) */}
        <div className="hidden overflow-x-auto rounded-2xl bg-white/5 md:block">
          <table className="w-full min-w-[760px]">
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
                          {(() => {
                            const m = product.name.match(/\(([A-Z][A-Z0-9]{3,})\)$/)
                            return m
                              ? <>{product.name.replace(/\s*\([A-Z][A-Z0-9]{3,}\)$/, '')} <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-400">{m[1]}</span></>
                              : <>{product.name}</>         
                          })()}
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

        {/* Мобильные карточки (вместо таблицы на узких экранах) */}
        <div className="space-y-3 md:hidden">
          {products.map(product => {
            const imgUrl = getImageUrl(product.main_image_url)
            const isChecked = selected.has(product.id)
            return (
              <div key={product.id} className={`rounded-2xl border border-white/10 bg-white/5 p-4 ${isChecked ? 'ring-1 ring-yellow-400/40' : ''}`}>
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(product.id)}
                    className="mt-1 h-4 w-4 flex-shrink-0 rounded accent-yellow-400"
                  />
                  {imgUrl ? (
                    <img src={imgUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-xl bg-white/10 object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-2xl">📦</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="font-semibold text-white">{product.name}</div>
                      {product.is_featured && <span className="text-yellow-400" title="Хит">⭐</span>}
                      {!product.is_active && <span className="text-xs text-red-400">(скрыт)</span>}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-400">
                      {product.brand || product.sku || '—'} · {categories.find(c => c.id === product.category_id)?.name || '—'}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-yellow-400">{formatPrice(product.price)}</span>
                      <span className={`rounded px-2 py-0.5 text-xs ${product.stock_quantity > 0 ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                        {product.stock_quantity > 0 ? `✓ ${product.stock_quantity} шт.` : '✗ Нет'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-1.5">
                  <button onClick={() => onEdit(product)} aria-label="Редактировать" className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20">✏️</button>
                  <button onClick={() => onToggleFeatured(product)} aria-label="Хит продаж" className={`rounded-lg px-3 py-2 text-sm ${product.is_featured ? 'bg-yellow-500/30 text-yellow-400' : 'bg-white/10 text-white hover:bg-white/20'}`}>⭐</button>
                  <button onClick={() => onToggleActive(product)} aria-label={product.is_active ? 'Скрыть' : 'Показать'} className={`rounded-lg px-3 py-2 text-sm ${product.is_active ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>{product.is_active ? '👁' : '👁‍🗨'}</button>
                  <button onClick={() => onDelete(product.id)} aria-label="Удалить" className="rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-400 hover:bg-red-900">🗑️</button>
                </div>
              </div>
            )
          })}
        </div>
        </>
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
  'DJI', 'GoPro', 'Dyson', 'Pitaka', 'Whoop',
  'JBL', 'Bose', 'Beats', 'Marshall', 'Sennheiser',
  'Nintendo', 'Microsoft', 'Asus', 'Lenovo', 'HP', 'Dell', 'Acer', 'LG',
  'Яндекс', 'Canon', 'Ray-Ban', 'Meta',
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
    { field: 'storage', label: 'Память (SSD)', placeholder: '512 ГБ, 1 ТБ…' },
    { field: 'size', label: 'ОЗУ', placeholder: '8 ГБ, 16 ГБ, 32 ГБ…' },
  ],
  watches: [
    { field: 'storage', label: 'Размер ремешка', placeholder: 'S/M, M/L…' },
    { field: 'size', label: 'Размер циферблата', placeholder: '42 мм, 46 мм…' },
  ],
  headphones: [],
  tv: [
    { field: 'size', label: 'Диагональ', placeholder: '55", 65", 75"…' },
  ],
  gaming: [
    { field: 'storage', label: 'Комплектация', placeholder: 'Digital, Disc…' },
    { field: 'size', label: 'Память', placeholder: '512 ГБ, 1 ТБ…' },
  ],
  accessories: [
    { field: 'size', label: 'Размер / тип', placeholder: 'S, M, L…' },
  ],
  monobloki: [
    { field: 'storage', label: 'Память (SSD)', placeholder: '512 ГБ, 1 ТБ…' },
    { field: 'size', label: 'ОЗУ', placeholder: '16 ГБ, 24 ГБ…' },
  ],
  'umnye-ochki': [
    { field: 'size', label: 'Размер', placeholder: 'S, M, L…' },
    { field: 'storage', label: 'Линзы', placeholder: 'прозрачные, поляризованные…' },
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
  const [uploadForColor, setUploadForColor] = useState<string>('')
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
    for (const raw of files) {
      // Сжимаем до загрузки — уложиться в лимит nginx (~1 МБ) и грузить быстро.
      const file = await compressImageForUpload(raw)
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 45_000)
      try {
        const fd = new FormData()
        fd.append('file', file)
        if (uploadForColor) fd.append('variant_color', uploadForColor)
        let url = `${API_BASE_URL}/api/products/${savedProductId}/images`
        if (uploadForColor) url += `?variant_color=${encodeURIComponent(uploadForColor)}`
        const res = await authFetch(url, {
          method: 'POST',
          body: fd,
          signal: controller.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast(`Ошибка загрузки «${raw.name}»: ${err.detail || res.status}`, 'error')
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') toast(`«${raw.name}»: загрузка не ответила за 45 сек`, 'error')
        else toast(`Ошибка загрузки «${raw.name}»`, 'error')
      } finally {
        window.clearTimeout(timeoutId)
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    await loadImages(savedProductId)
    onRefresh()
  }

  const handleSetImageColor = async (imageId: string, variantColor: string | null) => {
    if (!savedProductId) return
    try {
      await authFetch(`${API_BASE_URL}/api/products/${savedProductId}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_color: variantColor }),
      })
      await loadImages(savedProductId)
    } catch { /* silently fail — API may not support this */ }
  }

  const handleDeleteImage = async (imageId: string) => {
    if (!savedProductId) return
    if (!(await confirmDialog({ title: 'Удалить изображение?', message: 'Изображение товара будет удалено.', confirmLabel: 'Удалить' }))) return
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
  const bulkDeleteAll = async () => {
    if (!(await confirmDialog({ title: 'Удалить ВСЕ варианты?', message: 'Это действие нельзя отменить.', confirmLabel: 'Удалить все' }))) return
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
            // Unique colors from images
            const imageColors = [...new Set(images.filter(i => i.variant_color).map(i => i.variant_color!))].sort()

            return (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm text-slate-400">📷 Фото товара {images.length > 0 ? `(${images.length})` : ''}</label>
                {images.length > 0 && <span className="text-xs text-slate-500">Нажмите на фото чтобы выбрать обложку</span>}
              </div>

              {/* Color-aware upload */}
              <div className="mb-3 space-y-2">
                {color && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Загрузить фото для цвета:</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setUploadForColor('')}
                        className={`rounded-lg px-2.5 py-1 text-xs transition ${
                          !uploadForColor ? 'bg-yellow-400 text-gray-900 font-semibold' : 'bg-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        Общие
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadForColor(color)}
                        className={`rounded-lg px-2.5 py-1 text-xs transition ${
                          uploadForColor === color ? 'bg-yellow-400 text-gray-900 font-semibold' : 'bg-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        🎨 {color}
                      </button>
                    </div>
                  </div>
                )}

                {/* Upload dropzone */}
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full rounded-xl border-2 border-dashed border-white/15 py-4 text-center text-sm text-slate-400 transition hover:border-yellow-400/60 hover:text-yellow-400 disabled:opacity-40"
                >
                  {uploading ? '⏳ Загружаю…' : `+ Добавить фото${uploadForColor ? ` (${uploadForColor})` : ''} (можно несколько)`}
                </button>
              </div>

              {/* Photo grid — grouped by color */}
              {loadingImages ? (
                <div className="text-center text-sm text-slate-500">Загружаю…</div>
              ) : images.length > 0 ? (
                <div className="space-y-4">
                  {/* Show color groups if we have colored photos */}
                  {imageColors.length > 0 && (
                    <>
                      {imageColors.map(vc => {
                        const colorImgs = images.filter(i => i.variant_color === vc)
                        return (
                          <div key={vc}>
                            <div className="mb-1.5 flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-300">🎨 {vc}</span>
                              <span className="text-[10px] text-slate-600">({colorImgs.length} фото)</span>
                            </div>
                            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                              {colorImgs.map((img, idx) => {
                                const src = img.url.startsWith('/') ? `${API_BASE_URL}${img.url}` : img.url
                                return renderImageCard(img, src, idx)
                              })}
                            </div>
                          </div>
                        )
                      })}
                      {/* Uncolored photos */}
                      {images.filter(i => !i.variant_color).length > 0 && (
                        <div>
                          <div className="mb-1.5 text-xs font-semibold text-slate-300">📷 Общие фото</div>
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                            {images.filter(i => !i.variant_color).map((img, idx) => {
                              const src = img.url.startsWith('/') ? `${API_BASE_URL}${img.url}` : img.url
                              return renderImageCard(img, src, idx)
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {/* No color grouping — flat grid */}
                  {imageColors.length === 0 && (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {images.map((img, idx) => {
                        const src = img.url.startsWith('/') ? `${API_BASE_URL}${img.url}` : img.url
                        return renderImageCard(img, src, idx)
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            )

            function renderImageCard(img: ImageRecord, src: string, idx: number) {
              return (
                <div
                  key={img.id}
                  title={img.is_main ? 'Обложка' : 'Нажмите чтобы сделать обложкой'}
                  className={`group relative cursor-pointer rounded-xl overflow-hidden transition ${
                    img.is_main ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-slate-800' : 'hover:ring-1 hover:ring-white/30'
                  }`}
                  onClick={() => !img.is_main && handleSetMain(img.id)}
                >
                  <div className="aspect-square bg-white/5">
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </div>
                  {img.is_main && (
                    <div className="absolute left-1.5 top-1.5 rounded-md bg-yellow-400 px-1.5 py-0.5 text-[10px] font-bold text-gray-900">★ Обложка</div>
                  )}
                  {img.variant_color && (
                    <div className="absolute left-1.5 bottom-6 rounded-md bg-blue-500/80 px-1.5 py-0.5 text-[9px] font-medium text-white">
                      🎨 {img.variant_color}
                    </div>
                  )}
                  {/* Reorder */}
                  <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-0.5 bg-black/60 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                    <button type="button" onClick={e => { e.stopPropagation(); moveImage(idx, -1) }} disabled={idx === 0} className="flex-1 rounded text-xs text-white disabled:opacity-30 hover:text-yellow-300">←</button>
                    <span className="text-[10px] text-slate-400">{idx + 1}</span>
                    <button type="button" onClick={e => { e.stopPropagation(); moveImage(idx, 1) }} disabled={idx === images.length - 1} className="flex-1 rounded text-xs text-white disabled:opacity-30 hover:text-yellow-300">→</button>
                  </div>
                  {/* Delete */}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleDeleteImage(img.id) }}
                    className="absolute right-1 top-1 hidden items-center justify-center rounded-full bg-black/70 p-0.5 text-red-400 hover:bg-red-900 group-hover:flex"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                  {/* Set color button */}
                  {color && !img.variant_color && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleSetImageColor(img.id, color) }}
                      title={`Привязать к цвету «${color}»`}
                      className="absolute left-1 top-1 hidden items-center justify-center rounded-full bg-blue-600/80 p-1 text-[9px] text-white hover:bg-blue-500 group-hover:flex"
                    >
                      🎨
                    </button>
                  )}
                  {img.variant_color && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleSetImageColor(img.id, null) }}
                      title="Отвязать от цвета"
                      className="absolute left-1 top-1 hidden items-center justify-center rounded-full bg-red-600/80 p-1 text-[9px] text-white hover:bg-red-500 group-hover:flex"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            }
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

function BannerModal({
  banner, onSave, onClose, authFetch
}: {
  banner: HeroBanner | null
  onSave: (data: Record<string, unknown>, id?: string) => Promise<string | null>
  onClose: () => void
  authFetch: AuthFetchFn
}) {
  const [badge, setBadge] = useState(banner?.badge || '')
  const [title, setTitle] = useState(banner?.title || '')
  const [highlight, setHighlight] = useState(banner?.highlight || '')
  const [description, setDescription] = useState(banner?.description || '')
  const [image, setImage] = useState(banner?.image || '')
  const [ctaLabel, setCtaLabel] = useState(banner?.cta_label || '')
  const [ctaLink, setCtaLink] = useState(banner?.cta_link || '')
  const [secondaryLabel, setSecondaryLabel] = useState(banner?.secondary_label || '')
  const [secondaryLink, setSecondaryLink] = useState(banner?.secondary_link || '')
  const [sortOrder, setSortOrder] = useState(String(banner?.sort_order ?? 0))
  const [isActive, setIsActive] = useState(banner?.is_active ?? true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const buildPayload = (): Record<string, unknown> => ({
    badge: badge.trim() || null,
    title: title.trim(),
    highlight: highlight.trim() || null,
    description: description.trim() || null,
    image: image.trim() || null,
    cta_label: ctaLabel.trim() || null,
    cta_link: ctaLink.trim() || null,
    secondary_label: secondaryLabel.trim() || null,
    secondary_link: secondaryLink.trim() || null,
    sort_order: parseInt(sortOrder) || 0,
    is_active: isActive,
  })

  const uploadImage = async (bannerId: string, file: File) => {
    // Клиентская защита: фото > 5 МБ бэкенд не примет — отсекаем сразу с понятной ошибкой.
    if (file.size > 5 * 1024 * 1024) {
      toast(`Фото ${(file.size / 1024 / 1024).toFixed(1)} МБ — слишком большое. Максимум 5 МБ.`, 'error')
      return
    }
    setUploading(true)
    // Таймаут, чтобы загрузка не могла «висеть вечно», если сервер не отвечает.
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await authFetch(`${API_BASE_URL}/api/hero-banners/${bannerId}/image`, { method: 'POST', body: fd, signal: controller.signal })
      if (res.ok) { const data = await res.json(); setImage(data.url) }
      else { const err = await res.json().catch(() => ({})); toast(`Ошибка загрузки (${res.status}): ${err.detail || 'проверьте формат и размер фото'}`, 'error') }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        toast('Загрузка не ответила за 45 сек. Попробуйте фото меньшего размера или ещё раз.', 'error')
      } else {
        toast('Не удалось загрузить фото. Проверьте соединение и попробуйте снова.', 'error')
      }
    } finally {
      window.clearTimeout(timeoutId)
      setUploading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0]
    if (!raw) return
    // Сжимаем до загрузки, чтобы уложиться в лимит nginx (~1 МБ) и грузить быстро.
    const file = await compressImageForUpload(raw)
    const existingId = banner?.id || createdId
    if (existingId) {
      await uploadImage(existingId, file)
    } else {
      // Новый баннер — сначала сохраняем (нужен id), потом грузим фото
      setSaving(true)
      const savedId = await onSave({ ...buildPayload(), title: title.trim() || 'Новый баннер' })
      setSaving(false)
      if (savedId) { setCreatedId(savedId); await uploadImage(savedId, file) }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await onSave(buildPayload(), banner?.id || createdId || undefined)
    setSaving(false)
    onClose()
  }

  const inputCls = "w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/20 focus:outline-none"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-slate-800 p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-white">{banner?.id ? 'Редактировать баннер' : 'Новый баннер'}</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        {/* Живой предпросмотр — как будет выглядеть на сайте */}
        <div className="mb-5">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">Предпросмотр</div>
          <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 via-white to-gray-100 p-5 ring-1 ring-black/5">
            <div className="grid items-center gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                {badge && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />{badge}
                  </span>
                )}
                <div className="mt-2 text-2xl font-bold leading-tight text-gray-900">
                  {title || <span className="text-gray-400">Заголовок</span>}{highlight ? ' ' : ''}
                  {highlight && <span className="text-yellow-500">{highlight}</span>}
                </div>
                {description && <div className="mt-1.5 line-clamp-2 text-sm text-gray-500">{description}</div>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {ctaLabel && <span className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">{ctaLabel}</span>}
                  {secondaryLabel && <span className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700">{secondaryLabel}</span>}
                </div>
              </div>
              <div className="flex items-center justify-center">
                {image
                  ? <img src={getImageUrl(image)} alt="" className="h-28 w-auto object-contain drop-shadow-xl" />
                  : <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-gray-100 text-4xl text-gray-300">🖼</div>}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Плашка сверху (badge)</label>
            <input type="text" value={badge} onChange={e => setBadge(e.target.value)} className={inputCls} placeholder="Новая коллекция 2026" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Заголовок * (чёрный)</label>
              <input type="text" required value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Умная техника" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Вторая строка (жёлтая)</label>
              <input type="text" value={highlight} onChange={e => setHighlight(e.target.value)} className={inputCls} placeholder="будущего" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Описание</label>
            <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} className={inputCls} placeholder="Короткий текст под заголовком" />
          </div>

          {/* Изображение */}
          <div>
            <label className="mb-1 block text-sm text-slate-400">Изображение (PNG без фона — лучше всего)</label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || saving}
                className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50">
                {uploading ? '⏳ Загрузка…' : '📁 Загрузить фото'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              {image && <button type="button" onClick={() => setImage('')} className="text-xs text-red-400 hover:text-red-300">Убрать фото</button>}
            </div>
            <input type="text" value={image} onChange={e => setImage(e.target.value)} className={`${inputCls} mt-2 text-sm`} placeholder="или путь/URL: /iphone-17-pro.png" />
          </div>

          {/* Кнопки баннера */}
          <div className="rounded-xl bg-white/5 p-4">
            <div className="mb-3 text-sm font-medium text-white">Основная кнопка</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="text" value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} className={inputCls} placeholder="Текст: Смотреть каталог" />
              <input type="text" value={ctaLink} onChange={e => setCtaLink(e.target.value)} className={inputCls} placeholder="Ссылка: /catalog" />
            </div>
            <div className="mb-3 mt-4 text-sm font-medium text-white">Вторая кнопка (необязательно)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="text" value={secondaryLabel} onChange={e => setSecondaryLabel(e.target.value)} className={inputCls} placeholder="Текст: В каталог" />
              <input type="text" value={secondaryLink} onChange={e => setSecondaryLink(e.target.value)} className={inputCls} placeholder="Ссылка: /catalog или https://t.me/…" />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Ссылка с http(s):// открывается как внешняя, остальные — как страницы сайта (напр. /catalog, /trade-in).</p>
          </div>

          {/* Порядок + активность */}
          <div className="flex flex-wrap items-center gap-6 rounded-xl bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">Порядок:</label>
              <input type="text" inputMode="numeric" value={sortOrder} onChange={e => setSortOrder(e.target.value.replace(/\D/g, ''))} className="w-16 rounded-lg bg-white/10 px-3 py-2 text-center text-white focus:bg-white/20 focus:outline-none" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-white">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-5 w-5 rounded" />
              <span>👁 Показывать на сайте</span>
            </label>
          </div>

          <div className="flex gap-4 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-white/10 py-3 text-white hover:bg-white/20">Отмена</button>
            <button type="submit" disabled={saving || uploading} className="flex-1 rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50">
              {saving ? '⏳ Сохранение…' : banner?.id ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

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
        toast(`Ошибка загрузки: ${err.detail || res.status}`, 'error')
      }
    } catch { toast('Ошибка загрузки изображения', 'error') }
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
  const [quickFilters, setQuickFilters] = useState<{ label: string; query: string }[]>(
    category?.quick_filters ?? []
  )
  const [newFilterLabel, setNewFilterLabel] = useState('')
  const [newFilterQuery, setNewFilterQuery] = useState('')

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

  const addFilter = () => {
    const label = newFilterLabel.trim()
    if (!label) return
    const query = newFilterQuery.trim() || label
    setQuickFilters(prev => [...prev, { label, query }])
    setNewFilterLabel('')
    setNewFilterQuery('')
  }

  const removeFilter = (index: number) => {
    setQuickFilters(prev => prev.filter((_, i) => i !== index))
  }

  const moveFilter = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= quickFilters.length) return
    const arr = [...quickFilters]
    ;[arr[index], arr[newIndex]] = [arr[newIndex], arr[index]]
    setQuickFilters(arr)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      name: formData.name,
      slug: formData.slug,
      is_active: formData.is_active,
      quick_filters: quickFilters.length > 0 ? quickFilters : null,
    }
    if (formData.description) payload.description = formData.description
    if (formData.image_url) payload.image_url = formData.image_url
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-800 p-6 sm:p-8" onClick={e => e.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{category ? '✏️ Редактировать' : '📂 Новая'} категория</h2>
            <p className="text-sm text-slate-400 mt-1">{category ? 'Измените данные категории' : 'Заполните информацию о категории'}</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-slate-400 hover:bg-white/20 hover:text-white transition-colors">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Preview */}
          {formData.image_url && (
            <div className="flex justify-center rounded-2xl bg-white/5 p-4">
              <img src={formData.image_url} alt="" className="h-20 w-20 rounded-xl object-cover" onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />
            </div>
          )}

          {/* Name + Slug row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-400 uppercase tracking-wider">Название *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => {
                  const name = e.target.value
                  setFormData(prev => ({
                    ...prev,
                    name,
                    ...(!category ? { slug: generateSlug(name) } : {}),
                  }))
                }}
                placeholder="Смартфоны"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-yellow-400/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-400 uppercase tracking-wider">Slug *</label>
              <input
                type="text"
                required
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                placeholder="smartphones"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-yellow-400/50"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-400 uppercase tracking-wider">URL изображения</label>
            <input
              type="text"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              placeholder="https://example.com/image.png"
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-yellow-400/50"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-400 uppercase tracking-wider">Описание</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              placeholder="Краткое описание категории..."
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-yellow-400/50 resize-none"
            />
          </div>

          <label className="flex items-center gap-3 rounded-xl bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition-colors">
            <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="h-5 w-5 rounded accent-yellow-400" />
            <div>
              <div className="text-sm font-medium text-white">Активна</div>
              <div className="text-xs text-slate-400">Категория видна на сайте</div>
            </div>
          </label>

          {/* Quick Filters */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-400 uppercase tracking-wider">Быстрые фильтры (теги)</label>
            <p className="mb-2 text-xs text-slate-500">Теги для быстрой фильтрации в каталоге (напр. «iPhone 17 Pro Max», «Galaxy S26 Ultra»)</p>
            
            {quickFilters.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {quickFilters.map((qf, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <span className="flex-1 text-sm text-white truncate">{qf.label}</span>
                    {qf.label !== qf.query && (
                      <span className="text-xs text-slate-500 truncate max-w-[120px]">→ {qf.query}</span>
                    )}
                    <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                      <button type="button" onClick={() => moveFilter(i, -1)} disabled={i === 0} className="text-slate-500 hover:text-white disabled:opacity-30 text-xs px-1">↑</button>
                      <button type="button" onClick={() => moveFilter(i, 1)} disabled={i === quickFilters.length - 1} className="text-slate-500 hover:text-white disabled:opacity-30 text-xs px-1">↓</button>
                      <button type="button" onClick={() => removeFilter(i)} className="text-red-400 hover:text-red-300 text-sm px-1">×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newFilterLabel}
                onChange={(e) => setNewFilterLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFilter() } }}
                placeholder="Название тега"
                className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-yellow-400/50"
              />
              <input
                type="text"
                value={newFilterQuery}
                onChange={(e) => setNewFilterQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFilter() } }}
                placeholder="Поиск (опц.)"
                className="w-28 rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-yellow-400/50"
              />
              <button type="button" onClick={addFilter} className="rounded-xl bg-yellow-400/20 px-4 py-2.5 text-sm font-medium text-yellow-400 hover:bg-yellow-400/30 transition-colors flex-shrink-0">+</button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-white/10 py-3 font-medium text-white hover:bg-white/20 transition-colors">Отмена</button>
            <button type="submit" className="flex-1 rounded-xl bg-yellow-400 py-3 font-bold text-gray-900 hover:bg-yellow-300 transition-colors">
              {category ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============ GROUP CREATION MODAL ============
// Полноценное создание группы товаров с загрузкой фото прямо при создании.
// Шаг 1: Заполняешь основу + варианты → жмёшь «Создать» → товары создаются.
// Шаг 2: Сразу после создания — загружай фото на каждый цвет/товар из той же модалки.

interface GroupAxis {
  field: 'color' | 'storage' | 'connectivity' | 'processor'
  label: string
  placeholder: string
  hint?: string
}

const GROUP_CATEGORY_AXES: Record<string, GroupAxis[]> = {
  smartphones: [
    { field: 'color', label: 'Цвета', placeholder: 'Белый', hint: 'Каждый цвет = отдельная карточка товара' },
    { field: 'storage', label: 'Память', placeholder: '256 ГБ', hint: 'Объём встроенной памяти' },
    { field: 'connectivity', label: 'Связь (SIM)', placeholder: 'SIM + eSIM', hint: 'Тип SIM-карт' },
  ],
  'smartphones:samsung': [
    { field: 'color', label: 'Цвета', placeholder: 'Серый титан', hint: 'Каждый цвет = отдельная карточка товара' },
    { field: 'connectivity', label: 'ОЗУ', placeholder: '12 ГБ', hint: 'Объём оперативной памяти' },
    { field: 'storage', label: 'Память', placeholder: '256 ГБ', hint: 'Объём встроенной памяти' },
    { field: 'processor', label: 'SIM', placeholder: 'SIM + eSIM', hint: 'Тип SIM-карт' },
  ],
  'smartphones:xiaomi': [
    { field: 'color', label: 'Цвета', placeholder: 'Черный', hint: 'Каждый цвет = отдельная карточка товара' },
    { field: 'connectivity', label: 'ОЗУ', placeholder: '12 ГБ', hint: 'Объём оперативной памяти' },
    { field: 'storage', label: 'Память', placeholder: '256 ГБ', hint: 'Объём встроенной памяти' },
    { field: 'processor', label: 'SIM', placeholder: 'SIM + eSIM', hint: 'Тип SIM-карт' },
  ],
  tablets: [
    { field: 'color', label: 'Цвета', placeholder: 'Space Gray' },
    { field: 'connectivity', label: 'ОЗУ', placeholder: '8 ГБ', hint: 'Объём оперативной памяти' },
    { field: 'storage', label: 'Память', placeholder: '256 ГБ', hint: 'Объём встроенной памяти' },
    { field: 'processor', label: 'Связь', placeholder: 'WiFi + Cellular', hint: 'Тип связи (WiFi, 5G...)' },
  ],
  laptops: [
    { field: 'color', label: 'Цвет', placeholder: 'серебристый', hint: 'Каждый цвет = отдельная карточка' },
    { field: 'processor', label: 'Процессор', placeholder: 'M4 Pro, 14C CPU, 20C GPU', hint: 'Модель чипа + ядра, например: M4 Pro, 14C CPU, 20C GPU' },
    { field: 'connectivity', label: 'ОЗУ', placeholder: '24 ГБ', hint: 'Объём оперативной памяти' },
    { field: 'storage', label: 'Память SSD', placeholder: '512 ГБ', hint: 'Объём накопителя' },
  ],
  watches: [
    { field: 'color', label: 'Цвета', placeholder: 'Титан' },
    { field: 'processor', label: 'Тип ремешка', placeholder: 'Sport Band' },
    { field: 'storage', label: 'Размер ремешка', placeholder: 'S/M' },
    { field: 'connectivity', label: 'Размер циферблата', placeholder: '42 мм' },
  ],
  headphones: [
    { field: 'color', label: 'Цвета', placeholder: 'Чёрный' },
  ],
  tv: [
    { field: 'color', label: 'Цвета', placeholder: 'Черный' },
    { field: 'storage', label: 'Диагональ', placeholder: '55"' },
  ],
  gaming: [
    { field: 'color', label: 'Цвета', placeholder: 'Чёрный' },
    { field: 'storage', label: 'Комплектация', placeholder: 'Digital' },
    { field: 'connectivity', label: 'Память', placeholder: '512 ГБ', hint: 'Объём встроенного накопителя' },
  ],
  accessories: [
    { field: 'color', label: 'Цвета', placeholder: 'Чёрный' },
    { field: 'storage', label: 'Размер / тип', placeholder: 'M' },
  ],
  monobloki: [
    { field: 'color', label: 'Цвет', placeholder: 'серебристый', hint: 'Каждый цвет = отдельная карточка' },
    { field: 'processor', label: 'Процессор', placeholder: 'M4, M4 Pro…', hint: 'Модель чипа' },
    { field: 'connectivity', label: 'ОЗУ', placeholder: '16 ГБ', hint: 'Объём оперативной памяти' },
    { field: 'storage', label: 'Память SSD', placeholder: '512 ГБ', hint: 'Объём накопителя' },
  ],
  'umnye-ochki': [
    { field: 'processor', label: 'Оправа', placeholder: 'матовая черная', hint: 'Цвет и тип оправы' },
    { field: 'storage', label: 'Линзы', placeholder: 'прозрачные', hint: 'Тип линз' },
    { field: 'connectivity', label: 'Размер', placeholder: 'S, M, L', hint: 'Размер оправы' },
  ],
}

const GROUP_DEFAULT_AXES: GroupAxis[] = [
  { field: 'color', label: 'Цвета', placeholder: 'Чёрный' },
  { field: 'storage', label: 'Параметр 1', placeholder: '256 ГБ' },
  { field: 'connectivity', label: 'Параметр 2', placeholder: 'SIM + eSIM' },
]

interface GroupProductRow {
  name: string
  color: string
  storage: string
  connectivity: string
  processor: string
  price: string
  stock: string
  enabled: boolean
}

interface CreatedProduct {
  id: string
  name: string
  color: string
  images: { id: string; url: string; variant_color: string | null; is_main: boolean }[]
}

function GroupCreationModal({
  categories, onClose, onCreated, authFetch
}: {
  categories: Category[]
  onClose: () => void
  onCreated: () => void
  authFetch: AuthFetchFn
}) {
  // ── Step tracking ──
  const [step, setStep] = useState<'configure' | 'photos'>('configure')

  // ── Step 1: Configuration ──
  const [baseName, setBaseName] = useState('')
  const [brand, setBrand] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [basePriceStr, setBasePriceStr] = useState('')
  const [description, setDescription] = useState('')
  const [warranty, setWarranty] = useState('')

  const [axisValues, setAxisValues] = useState<Record<string, string[]>>({
    color: [], storage: [], connectivity: [], processor: [],
  })
  const [newInputs, setNewInputs] = useState<Record<string, string>>({
    color: '', storage: '', connectivity: '', processor: '',
  })
  const [overrides, setOverrides] = useState<Record<string, { price: string; stock: string; enabled: boolean }>>({})

  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState('')
  const [createdCount, setCreatedCount] = useState(0)

  // ── Step 2: Photo upload ──
  const [createdProducts, setCreatedProducts] = useState<CreatedProduct[]>([])
  const [activeProductIdx, setActiveProductIdx] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [modelCodes, setModelCodes] = useState<Record<string, string>>({})
  const [savingCode, setSavingCode] = useState<string | null>(null)

  // Category
  const selectedCat = categories.find(c => c.id === categoryId)
  const catSlug = selectedCat?.slug || ''
  const axisKey = brand && GROUP_CATEGORY_AXES[`${catSlug}:${brand.toLowerCase()}`]
    ? `${catSlug}:${brand.toLowerCase()}`
    : catSlug
  const axesDef = GROUP_CATEGORY_AXES[axisKey] || GROUP_DEFAULT_AXES

  // Matrix
  const buildMatrix = (): GroupProductRow[] => {
    const colors = axisValues.color.length > 0 ? axisValues.color : ['']
    const storages = axisValues.storage.length > 0 ? axisValues.storage : ['']
    const conns = axisValues.connectivity.length > 0 ? axisValues.connectivity : ['']
    const processors = axisValues.processor.length > 0 ? axisValues.processor : ['']
    const isLaptop = catSlug === 'laptops'
    const isMonoblok = catSlug === 'monobloki'
    const isSmartGlasses = catSlug === 'umnye-ochki'
    const phoneBrand = brand?.toLowerCase() || ''
    const isRamAxisPhone = catSlug === 'smartphones' && (phoneBrand === 'samsung' || phoneBrand === 'xiaomi')

    const result: GroupProductRow[] = []
    for (const c of colors) {
      for (const proc of processors) {
        for (const cn of conns) {
          for (const s of storages) {
            let fullName: string
            if (isLaptop || isMonoblok) {
              // Format: {baseName} ({processor}, {ram}, {storage} SSD), {color}
              const specParts = [proc, cn, s ? `${s} SSD` : ''].filter(Boolean)
              const specs = specParts.length > 0 ? ` (${specParts.join(', ')})` : ''
              fullName = c ? `${baseName}${specs}, ${c}` : `${baseName}${specs}`
            } else if (isSmartGlasses) {
              // Format: Ray-Ban Meta Gen 2 (матовая черная оправа, линзы прозрачные) L
              const specParts = [
                proc ? `${proc} оправа` : '',
                s ? `линзы ${s}` : '',
              ].filter(Boolean)
              const specs = specParts.length > 0 ? ` (${specParts.join(', ')})` : ''
              fullName = cn ? `${baseName}${specs} ${cn}` : `${baseName}${specs}`
            } else if (isRamAxisPhone) {
              // Format: Samsung S25 Ultra 12ГБ/256ГБ SIM + eSIM, чёрный
              const spec = [cn, s].filter(Boolean).join('/')
              const parts = [baseName, spec, proc].filter(Boolean)
              fullName = c ? `${parts.join(' ')}, ${c}` : parts.join(' ')
            } else if (catSlug === 'tablets') {
              const spec = [cn, s].filter(Boolean).map(v => v.replace(/(?:\s*ГБ|\s*ТБ)$/i, '')).join('/')
              const unit = s ? (s.toLowerCase().includes('тб') ? ' ТБ' : ' ГБ') : ''
              const memStr = spec ? `${spec}${unit}` : ''
              const parts = [baseName, memStr, proc].filter(Boolean)
              fullName = c ? `${parts.join(' ')}, ${c}` : parts.join(' ')
            } else if (catSlug === 'watches') {
              // proc = Тип ремешка, s = Размер ремешка, cn = Размер циферблата.
              // New expected order: baseName + cn + Color (корпус) + proc (ремешок) + s (размер ремешка)
              const parts = [baseName, cn, c, proc, s].filter(Boolean)
              fullName = parts.join(' ')
            } else {
              const parts = [baseName, proc, s, cn].filter(Boolean)
              fullName = c ? `${parts.join(' ')}, ${c}` : parts.join(' ')
            }
            const key = `${c}|${proc}|${s}|${cn}`
            const ov = overrides[key]
            result.push({
              name: fullName, color: c, storage: s, connectivity: cn, processor: proc,
              price: ov?.price || basePriceStr, stock: ov?.stock || '0',
              enabled: ov?.enabled !== false,
            })
          }
        }
      }
    }
    return result
  }

  const matrix = buildMatrix()
  const enabledCount = matrix.filter(m => m.enabled).length

  const addAxisValue = (field: string) => {
    const val = newInputs[field]?.trim()
    if (!val || axisValues[field]?.includes(val)) return
    setAxisValues(prev => ({ ...prev, [field]: [...(prev[field] || []), val] }))
    setNewInputs(prev => ({ ...prev, [field]: '' }))
  }

  const removeAxisValue = (field: string, val: string) => {
    setAxisValues(prev => ({ ...prev, [field]: (prev[field] || []).filter(v => v !== val) }))
  }

  const updateOverride = (key: string, field: 'price' | 'stock' | 'enabled', value: string | boolean) => {
    setOverrides(prev => ({
      ...prev,
      [key]: {
        price: prev[key]?.price || '', stock: prev[key]?.stock || '',
        enabled: prev[key]?.enabled !== false, [field]: value,
      },
    }))
  }

  // ── Create products ──
  const handleCreate = async () => {
    const toCreate = matrix.filter(m => m.enabled)
    if (toCreate.length === 0) return
    setCreating(true)
    setCreatedCount(0)

    const created: CreatedProduct[] = []

    try {
      for (let i = 0; i < toCreate.length; i++) {
        const item = toCreate[i]
        setProgress(`${i + 1}/${toCreate.length} — ${item.name}`)

        const price = parseFloat(item.price) || 0
        if (price <= 0) continue

        const payload: Record<string, unknown> = {
          name: item.name, price,
          stock_quantity: parseInt(item.stock) || 0,
          is_active: true, condition: 'new',
          brand: brand || null, category_id: categoryId || null,
          description: description || null, color: item.color || null,
          warranty_months: warranty ? parseInt(warranty) || null : null,
          attributes: { storage: item.storage || null, connectivity: item.connectivity || null, processor: item.processor || null }
        }

        const res = await authFetch(`${API_BASE_URL}/api/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          const saved = await res.json()
          created.push({ id: saved.id, name: item.name, color: item.color, images: [] })
          setCreatedCount(created.length)
        } else {
          const err = await res.json().catch(() => ({}))
          console.error(`Не удалось создать "${item.name}":`, err)
        }
      }

      if (created.length >= 2) {
        setProgress('Объединяю в группу…')
        await authFetch(`${API_BASE_URL}/api/product-groups/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_ids: created.map(p => p.id) }),
        })
      }

      setCreatedProducts(created)
      setActiveProductIdx(0)
      setStep('photos')
      setProgress('')
      setCreating(false)
    } catch (err) {
      toast(`Ошибка: ${err instanceof Error ? err.message : 'Неизвестно'}`, 'error')
      setCreating(false)
      setProgress('')
    }
  }

  // ── Photo upload for step 2 ──
  const activeProduct = createdProducts[activeProductIdx]

  const handleUploadPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length || !activeProduct) return
    setUploading(true)

    for (const file of files) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        if (activeProduct.color) fd.append('variant_color', activeProduct.color)
        let url = `${API_BASE_URL}/api/products/${activeProduct.id}/images`
        if (activeProduct.color) url += `?variant_color=${encodeURIComponent(activeProduct.color)}`
        await authFetch(url, { method: 'POST', body: fd })
      } catch { /* skip */ }
    }

    // Reload images for this product
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products/${activeProduct.id}/images`)
      if (res.ok) {
        const imgs = await res.json()
        setCreatedProducts(prev => prev.map((p, i) =>
          i === activeProductIdx ? { ...p, images: imgs } : p
        ))
      }
    } catch { /* skip */ }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const deleteImage = async (imageId: string) => {
    if (!activeProduct) return
    try {
      await authFetch(`${API_BASE_URL}/api/products/${activeProduct.id}/images/${imageId}`, { method: 'DELETE' })
      setCreatedProducts(prev => prev.map((p, i) =>
        i === activeProductIdx ? { ...p, images: p.images.filter(img => img.id !== imageId) } : p
      ))
    } catch { /* skip */ }
  }

  const setMainImage = async (imageId: string) => {
    if (!activeProduct) return
    try {
      await authFetch(`${API_BASE_URL}/api/products/${activeProduct.id}/images/${imageId}/set-main`, {
        method: 'PATCH',
      })
      setCreatedProducts(prev => prev.map((p, i) =>
        i === activeProductIdx
          ? { ...p, images: p.images.map(img => ({ ...img, is_main: img.id === imageId })) }
          : p
      ))
    } catch { /* skip */ }
  }

  const hasAnyValues = Object.values(axisValues).some(v => v.length > 0)

  // ── Unique colors for step 2 sidebar grouping ──
  const colorGroups = createdProducts.reduce<Record<string, CreatedProduct[]>>((acc, p) => {
    const key = p.color || 'Без цвета'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={async () => {
      const msg = step === 'configure'
        ? 'Вы уверены, что хотите выйти? Введённые данные не сохранятся.'
        : 'Выйти? Товары уже созданы, фото можно добавить позже через редактирование.'
      if (await confirmDialog({ title: 'Выйти из мастера?', message: msg, confirmLabel: 'Выйти', cancelLabel: 'Остаться' })) onClose()
    }}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-slate-800" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-white">
              {step === 'configure' ? 'Создать группу товаров' : 'Загрузить фото'}
            </h2>
            {/* Step indicator */}
            <div className="flex items-center gap-1.5">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                step === 'configure' ? 'bg-yellow-400 text-gray-900' : 'bg-green-500 text-white'
              }`}>{step === 'configure' ? '1' : '✓'}</div>
              <div className="h-px w-4 bg-white/20"/>
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                step === 'photos' ? 'bg-yellow-400 text-gray-900' : 'bg-white/10 text-slate-500'
              }`}>2</div>
            </div>
          </div>
          <button
            onClick={async () => {
              const msg = step === 'configure'
                ? 'Вы уверены, что хотите выйти? Введённые данные не сохранятся.'
                : 'Выйти? Товары уже созданы, фото можно добавить позже через редактирование.'
              if (!(await confirmDialog({ title: 'Выйти из мастера?', message: msg, confirmLabel: 'Выйти', cancelLabel: 'Остаться' }))) return
              onClose()
            }}
            className="text-xl text-slate-400 hover:text-white"
          >×</button>
        </div>

        {/* ═══════════════════ STEP 1: CONFIGURE ═══════════════════ */}
        {step === 'configure' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* Base info */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Основная информация</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-slate-400">Базовое название *</label>
                    <input type="text" value={baseName} onChange={e => setBaseName(e.target.value)}
                      placeholder="Apple iPhone 17 Pro Max"
                      className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none" />
                    <p className="mt-1 text-[10px] text-slate-600">Память, SIM и цвет добавятся автоматически из вариантов ниже</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Бренд</label>
                    <select value={brand} onChange={e => setBrand(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-white focus:bg-white/15 focus:outline-none">
                      <option value="">—</option>
                      {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Категория</label>
                    <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-white focus:bg-white/15 focus:outline-none">
                      <option value="">—</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Базовая цена * ₽</label>
                    <input type="text" inputMode="decimal" value={basePriceStr}
                      onChange={e => setBasePriceStr(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="145990"
                      className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Гарантия (мес.)</label>
                    <input type="text" inputMode="numeric" value={warranty}
                      onChange={e => setWarranty(e.target.value.replace(/\D/g, ''))}
                      placeholder="12"
                      className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-slate-400">Описание</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                      placeholder="Общее описание для всех товаров группы"
                      className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:bg-white/15 focus:outline-none" />
                  </div>
                </div>
              </div>

              {/* Axes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Варианты</h3>
                  {selectedCat && <span className="text-[10px] text-slate-600">{selectedCat.name}</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {axesDef.map(axisDef => {
                    const vals = axisValues[axisDef.field] || []
                    const input = newInputs[axisDef.field] || ''
                    return (
                      <div key={axisDef.field} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2.5">
                        <div>
                          <div className="text-sm font-semibold text-white">{axisDef.label}</div>
                          {axisDef.hint && <div className="text-[10px] text-slate-500">{axisDef.hint}</div>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                          {vals.map(val => (
                            <span key={val} className="group inline-flex items-center gap-1 rounded-lg bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 text-xs font-medium text-yellow-300">
                              {val}
                              <button onClick={() => removeAxisValue(axisDef.field, val)} className="text-yellow-400/60 hover:text-red-400">×</button>
                            </span>
                          ))}
                          {vals.length === 0 && <span className="text-[10px] text-slate-600 italic">пусто</span>}
                        </div>
                        <div className="flex gap-1.5">
                          <input type="text" value={input}
                            onChange={e => setNewInputs(prev => ({ ...prev, [axisDef.field]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAxisValue(axisDef.field) } }}
                            placeholder={axisDef.placeholder}
                            className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:bg-white/15 focus:outline-none" />
                          <button type="button" onClick={() => addAxisValue(axisDef.field)}
                            className="rounded-lg bg-yellow-400/20 px-3 py-1.5 text-sm font-bold text-yellow-300 hover:bg-yellow-400/30">+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Preview table */}
              {hasAnyValues && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Товары ({enabledCount} из {matrix.length})
                    </h3>
                    <div className="text-[10px] text-slate-600">
                      {axesDef.map(a => {
                        const count = (axisValues[a.field] || []).length
                        return count > 0 ? `${count} ${a.label.toLowerCase()}` : null
                      }).filter(Boolean).join(' × ')}
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5 text-left text-[10px] text-slate-500 uppercase tracking-wider">
                          <th className="p-2 w-8">
                            <input type="checkbox" checked={enabledCount === matrix.length} onChange={() => {
                              const allEnabled = enabledCount === matrix.length
                              matrix.forEach(m => {
                                const key = `${m.color}|${m.processor}|${m.storage}|${m.connectivity}`
                                updateOverride(key, 'enabled', !allEnabled)
                              })
                            }} className="h-3.5 w-3.5 rounded accent-yellow-400 cursor-pointer" />
                          </th>
                          <th className="p-2">Название</th>
                          <th className="p-2 w-28">Цена ₽</th>
                          <th className="p-2 w-20">Склад</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.map((item, i) => {
                          const key = `${item.color}|${item.processor}|${item.storage}|${item.connectivity}`
                          return (
                            <tr key={i} className={`border-t border-white/5 ${item.enabled ? 'hover:bg-white/[0.02]' : 'opacity-35'}`}>
                              <td className="p-2">
                                <input type="checkbox" checked={item.enabled}
                                  onChange={() => updateOverride(key, 'enabled', !item.enabled)}
                                  className="h-3.5 w-3.5 rounded accent-yellow-400 cursor-pointer" />
                              </td>
                              <td className="p-2">
                                <div className="font-medium text-white text-xs">{item.name}</div>
                                <div className="text-[10px] text-slate-600">{[item.color, item.processor, item.connectivity, item.storage].filter(Boolean).join(' · ')}</div>
                              </td>
                              <td className="p-2">
                                <input type="text" inputMode="decimal"
                                  value={overrides[key]?.price ?? ''}
                                  onChange={e => updateOverride(key, 'price', e.target.value.replace(/[^\d.]/g, ''))}
                                  placeholder={basePriceStr || '—'}
                                  className="w-full rounded-lg bg-white/10 px-2 py-1 text-xs text-white placeholder-slate-600 focus:bg-white/15 focus:outline-none" />
                              </td>
                              <td className="p-2">
                                <input type="text" inputMode="numeric"
                                  value={overrides[key]?.stock ?? ''}
                                  onChange={e => updateOverride(key, 'stock', e.target.value.replace(/\D/g, ''))}
                                  placeholder="0"
                                  className="w-full rounded-lg bg-white/10 px-2 py-1 text-xs text-white placeholder-slate-600 focus:bg-white/15 focus:outline-none" />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer step 1 */}
            <div className="border-t border-white/10 px-6 py-4">
              {progress && (
                <div className="mb-3 rounded-xl bg-blue-500/10 border border-blue-500/20 p-2.5 text-sm text-blue-300">
                  ⏳ {progress} {createdCount > 0 && `(${createdCount} создано)`}
                </div>
              )}
              <div className="flex items-center justify-between">
                <button onClick={async () => { if (await confirmDialog({ title: 'Выйти из мастера?', message: 'Вы уверены, что хотите выйти? Введённые данные не сохранятся.', confirmLabel: 'Выйти', cancelLabel: 'Остаться' })) onClose() }} disabled={creating} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm text-white hover:bg-white/20 disabled:opacity-40">Отмена</button>
                <button onClick={handleCreate}
                  disabled={creating || enabledCount === 0 || !baseName.trim() || !basePriceStr}
                  className="rounded-xl bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40 transition-colors">
                  {creating ? `⏳ Создаю…` : `Создать ${enabledCount} товаров → далее фото`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════ STEP 2: PHOTO UPLOAD ═══════════════════ */}
        {step === 'photos' && (
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar — product list */}
              <div className="w-56 shrink-0 border-r border-white/10 overflow-y-auto bg-white/[0.02]">
                <div className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {createdProducts.length} товаров создано
                </div>
                {Object.entries(colorGroups).map(([color, products]) => (
                  <div key={color}>
                    {/* Color header */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03]">
                      {color !== 'Без цвета' && (
                        <div className="h-3 w-3 rounded-full ring-1 ring-white/20"
                          style={{ backgroundColor: CSS_COLOR_MAP_GROUP[color.toLowerCase()] || '#888' }} />
                      )}
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">{color}</span>
                    </div>
                    {products.map((p) => {
                      const idx = createdProducts.indexOf(p)
                      const isActive = idx === activeProductIdx
                      const hasPhotos = p.images.length > 0
                      return (
                        <button key={p.id} onClick={() => setActiveProductIdx(idx)}
                          className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                            isActive
                              ? 'border-l-yellow-400 bg-white/[0.06]'
                              : 'border-l-transparent hover:bg-white/[0.03]'
                          }`}>
                          <div className={`text-xs font-medium truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>
                            {p.name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {hasPhotos ? (
                              <span className="text-[10px] text-green-400">✓ {p.images.length} фото</span>
                            ) : (
                              <span className="text-[10px] text-slate-600">нет фото</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* Main — photo upload area */}
              <div className="flex-1 overflow-y-auto p-5">
                {activeProduct && (
                  <div className="space-y-4">
                    {/* Product header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-bold text-white">{activeProduct.name}</h3>
                        {activeProduct.color && (
                          <span className="text-xs text-slate-400">Цвет: {activeProduct.color}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setActiveProductIdx(Math.max(0, activeProductIdx - 1))}
                          disabled={activeProductIdx === 0}
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 disabled:opacity-30">
                          ←
                        </button>
                        <span className="text-xs text-slate-500">{activeProductIdx + 1} / {createdProducts.length}</span>
                        <button onClick={() => setActiveProductIdx(Math.min(createdProducts.length - 1, activeProductIdx + 1))}
                          disabled={activeProductIdx === createdProducts.length - 1}
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 disabled:opacity-30">
                          →
                        </button>
                      </div>
                    </div>

                    {/* Model code field (laptops/tablets) */}
                    {(selectedCat?.slug === 'laptops' || selectedCat?.slug === 'tablets') && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Код модели (SKU)</div>
                        <div className="text-[10px] text-slate-600">Например MX2F3 — добавится в скобках в конце названия</div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={modelCodes[activeProduct.id] ?? ''}
                            onChange={e => setModelCodes(prev => ({ ...prev, [activeProduct.id]: e.target.value }))}
                            placeholder="MX2F3"
                            className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder-slate-600 focus:bg-white/15 focus:outline-none"
                          />
                          <button
                            disabled={savingCode === activeProduct.id}
                            onClick={async () => {
                              const code = (modelCodes[activeProduct.id] || '').trim()
                              if (!code) return
                              setSavingCode(activeProduct.id)
                              // Build new name: strip old code if present, append new
                              const baseName = activeProduct.name.replace(/\s*\([A-Z0-9]+\)$/, '').trim()
                              const newName = `${baseName} (${code})`
                              try {
                                const res = await authFetch(`${API_BASE_URL}/api/products/${activeProduct.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ name: newName }),
                                })
                                if (res.ok) {
                                  setCreatedProducts(prev => prev.map((p, i) =>
                                    i === activeProductIdx ? { ...p, name: newName } : p
                                  ))
                                }
                              } finally {
                                setSavingCode(null)
                              }
                            }}
                            className="rounded-lg bg-yellow-400/20 px-4 py-2 text-sm font-semibold text-yellow-300 hover:bg-yellow-400/30 disabled:opacity-40"
                          >
                            {savingCode === activeProduct.id ? '…' : 'Сохранить'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Drop zone */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] py-8 transition-colors hover:border-yellow-400/40 hover:bg-white/[0.04]"
                    >
                      <div className="text-3xl mb-2">📸</div>
                      <div className="text-sm font-medium text-white">
                        {uploading ? 'Загружаю…' : 'Нажмите, чтобы загрузить фото'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        Можно выбрать несколько файлов сразу
                        {activeProduct.color && ` • Автоматически привяжутся к цвету «${activeProduct.color}»`}
                      </div>
                      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                        onChange={handleUploadPhotos} disabled={uploading} />
                    </div>

                    {/* Photos grid */}
                    {activeProduct.images.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                        {activeProduct.images.map((img, imgIdx) => (
                          <div key={img.id} className="group relative aspect-square overflow-hidden rounded-xl bg-white/5 border border-white/10">
                            <img src={getImageUrl(img.url)} alt="" className="h-full w-full object-cover" />
                            {/* Main badge */}
                            {img.is_main && (
                              <div className="absolute top-1.5 left-1.5 rounded-md bg-yellow-400 px-1.5 py-0.5 text-[9px] font-bold text-gray-900">
                                ОБЛОЖКА
                              </div>
                            )}
                            {/* Color badge */}
                            {img.variant_color && (
                              <div className="absolute top-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                                {img.variant_color}
                              </div>
                            )}
                            {/* Hover actions */}
                            <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {!img.is_main && (
                                <button onClick={() => setMainImage(img.id)}
                                  className="flex-1 rounded-md bg-yellow-400/20 py-1 text-[10px] font-semibold text-yellow-300 hover:bg-yellow-400/40">
                                  ★ Обложка
                                </button>
                              )}
                              <button onClick={() => deleteImage(img.id)}
                                className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/40">
                                ✕
                              </button>
                            </div>
                            {/* Number */}
                            <div className="absolute bottom-1.5 right-1.5 rounded bg-black/50 px-1 text-[9px] text-white/60 opacity-0 group-hover:opacity-100">
                              {imgIdx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeProduct.images.length === 0 && (
                      <div className="rounded-xl bg-white/[0.02] border border-white/5 p-6 text-center">
                        <div className="text-slate-600 text-sm">Фото пока не загружены</div>
                        <div className="text-slate-700 text-xs mt-1">
                          Загрузите фото для этого товара выше, или перейдите к следующему
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer step 2 */}
            <div className="border-t border-white/10 px-6 py-3 flex items-center justify-between">
              <div className="text-sm text-slate-400">
                {createdProducts.filter(p => p.images.length > 0).length} из {createdProducts.length} товаров с фото
              </div>
              <div className="flex gap-2">
                <button onClick={() => { onCreated() }}
                  className="rounded-xl bg-white/10 px-5 py-2.5 text-sm text-white hover:bg-white/20">
                  Пропустить фото
                </button>
                <button onClick={() => { onCreated() }}
                  className="rounded-xl bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-500">
                  Готово ✓
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Color map for sidebar dots in group modal (same as ProductPage)
const CSS_COLOR_MAP_GROUP: Record<string, string> = {
  'черный': '#1c1c1e', 'black': '#1c1c1e', 'чёрный': '#1c1c1e',
  'белый': '#f5f5f7', 'white': '#f5f5f7',
  'серый': '#8e8e93', 'gray': '#8e8e93', 'серебристый': '#c7c7cc',
  'синий': '#0071e3', 'blue': '#0071e3', 'голубой': '#5ac8fa',
  'красный': '#ff3b30', 'red': '#ff3b30',
  'зеленый': '#34c759', 'зелёный': '#34c759', 'green': '#34c759',
  'желтый': '#ffd60a', 'жёлтый': '#ffd60a',
  'оранжевый': '#ff9f0a', 'orange': '#ff9f0a', 'cosmic orange': '#e8651a',
  'розовый': '#ff2d55', 'pink': '#ff2d55',
  'фиолетовый': '#bf5af2', 'purple': '#bf5af2',
  'золотой': '#f5c518', 'gold': '#f5c518',
  'титан': '#8e8e93', 'titanium': '#8e8e93',
  'space black': '#1c1c1e', 'space gray': '#4a4a4a',
  'natural': '#e8d5b7', 'starlight': '#f5f5ea',
  'midnight': '#1c1c2e', 'deep blue': '#0a1930',
}
