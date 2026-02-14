import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { formatPrice } from '../data/products'

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

interface Analytics {
  total_orders: number
  today_orders: number
  week_orders: number
  month_orders: number
  status_counts: Record<string, number>
  total_revenue: number
  today_revenue: number
  week_revenue: number
  avg_order_value: number
  payment_stats: Record<string, number>
  delivery_stats: Record<string, number>
  daily_orders: { date: string; count: number; revenue: number }[]
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  new: { label: 'Новый', color: 'text-blue-600', bg: 'bg-blue-100', icon: '🆕' },
  processing: { label: 'В обработке', color: 'text-orange-600', bg: 'bg-orange-100', icon: '⏳' },
  ready: { label: 'Готов', color: 'text-green-600', bg: 'bg-green-100', icon: '✅' },
  completed: { label: 'Выполнен', color: 'text-gray-600', bg: 'bg-gray-200', icon: '📦' },
  cancelled: { label: 'Отменён', color: 'text-red-600', bg: 'bg-red-100', icon: '❌' },
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: '💵 Наличные',
  card: '💳 Картой',
  online: '🌐 Онлайн',
}

const DELIVERY_LABELS: Record<string, string> = {
  pickup: '🏪 Самовывоз',
  courier: '🚗 Курьер',
  post: '📦 Почта',
}

export function AdminPage() {
  const navigate = useNavigate()
  const { isAuthenticated, logout } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'orders' | 'analytics'>('orders')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, navigate])

  const loadData = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const headers = { ...getAuthHeaders(), Accept: 'application/json' }
      
      const url = statusFilter === 'all' 
        ? `${API_BASE_URL}/api/orders`
        : `${API_BASE_URL}/api/orders?status=${statusFilter}`
        
      const ordersRes = await fetch(url, { headers })
      if (ordersRes.status === 401) {
        logout()
        return
      }
      if (!ordersRes.ok) throw new Error('Ошибка загрузки')
      const ordersData = await ordersRes.json()
      setOrders(ordersData)
      
      const analyticsRes = await fetch(`${API_BASE_URL}/api/analytics`, { headers })
      if (analyticsRes.ok) {
        setAnalytics(await analyticsRes.json())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) loadData()
  }, [isAuthenticated, statusFilter])

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
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus })
      }
    } catch (err) {
      alert('Ошибка обновления статуса')
    } finally {
      setUpdatingStatus(false)
    }
  }

  const deleteOrder = async (orderId: number) => {
    if (!confirm('Удалить заказ?')) return
    try {
      await fetch(`${API_BASE_URL}/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      setOrders(orders.filter(o => o.id !== orderId))
      setSelectedOrder(null)
    } catch (err) {
      alert('Ошибка удаления')
    }
  }

  if (!isAuthenticated) return null

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white">Загрузка...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="mb-4 text-red-400">{error}</div>
          <button onClick={loadData} className="rounded-xl bg-yellow-400 px-6 py-3 font-semibold">
            Повторить
          </button>
        </div>
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
        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Сегодня заказов', value: analytics?.today_orders || 0, icon: '📦', gradient: 'from-blue-500 to-cyan-500' },
            { label: 'Выручка сегодня', value: formatPrice(analytics?.today_revenue || 0), icon: '💰', gradient: 'from-green-500 to-emerald-500' },
            { label: 'Новых заказов', value: analytics?.status_counts?.new || 0, icon: '🆕', gradient: 'from-yellow-500 to-orange-500' },
            { label: 'Средний чек', value: formatPrice(analytics?.avg_order_value || 0), icon: '📊', gradient: 'from-purple-500 to-pink-500' },
          ].map((stat, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl bg-white/5 p-6 backdrop-blur">
              <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br ${stat.gradient} opacity-20 blur-2xl`} />
              <div className="relative">
                <span className="text-2xl">{stat.icon}</span>
                <div className="mt-2 text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-sm text-slate-400">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setActiveTab('orders')}
            className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
              activeTab === 'orders' ? 'bg-yellow-400 text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            📋 Заказы ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
              activeTab === 'analytics' ? 'bg-yellow-400 text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            📊 Аналитика
          </button>
        </div>

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <>
            {/* Status Filter */}
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

            {/* Orders Grid */}
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
                    
                    {order.items && order.items.length > 0 && (
                      <div className="mb-3 flex gap-2">
                        {order.items.slice(0, 4).map((item, i) => (
                          <div key={i} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-xl">
                            {item.image}
                          </div>
                        ))}
                        {order.items.length > 4 && (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-sm text-slate-400">
                            +{order.items.length - 4}
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between border-t border-white/10 pt-3">
                      <div className="text-lg font-bold text-yellow-400">
                        {order.total_amount ? formatPrice(order.total_amount) : '—'}
                      </div>
                      <div className="text-sm text-slate-400">
                        {new Date(order.created_at).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && analytics && (
          <div className="space-y-6">
            {/* Chart */}
            <div className="rounded-2xl bg-white/5 p-6">
              <h3 className="mb-6 text-lg font-semibold text-white">📈 Заказы за 14 дней</h3>
              <div className="flex h-48 items-end gap-2">
                {analytics.daily_orders.map((day, i) => {
                  const max = Math.max(...analytics.daily_orders.map(d => d.count), 1)
                  const h = Math.max((day.count / max) * 100, 8)
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="text-xs text-white">{day.count}</div>
                      <div className="w-full rounded-t bg-gradient-to-t from-yellow-500 to-amber-400" style={{ height: `${h}%` }} />
                      <div className="text-xs text-slate-400">{day.date}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-6">
                <h3 className="mb-4 text-lg font-semibold text-white">💳 Способы оплаты</h3>
                <div className="space-y-3">
                  {Object.entries(analytics.payment_stats).map(([m, c]) => {
                    const t = Object.values(analytics.payment_stats).reduce((a, b) => a + b, 0) || 1
                    const p = Math.round((c / t) * 100)
                    return (
                      <div key={m}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-slate-300">{PAYMENT_LABELS[m] || m}</span>
                          <span className="text-white">{c} ({p}%)</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-yellow-400" style={{ width: `${p}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              
              <div className="rounded-2xl bg-white/5 p-6">
                <h3 className="mb-4 text-lg font-semibold text-white">🚚 Способы доставки</h3>
                <div className="space-y-3">
                  {Object.entries(analytics.delivery_stats).map(([m, c]) => {
                    const t = Object.values(analytics.delivery_stats).reduce((a, b) => a + b, 0) || 1
                    const p = Math.round((c / t) * 100)
                    return (
                      <div key={m}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-slate-300">{DELIVERY_LABELS[m] || m}</span>
                          <span className="text-white">{c} ({p}%)</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-cyan-400" style={{ width: `${p}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Order Modal */}
      {selectedOrder && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedOrder(null)}
        >
          <div 
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-400 text-lg font-bold">
                  #{selectedOrder.id}
                </div>
                <div>
                  <h2 className="text-xl font-bold">Заказ #{selectedOrder.id}</h2>
                  <p className="text-sm text-gray-500">
                    {new Date(selectedOrder.created_at).toLocaleString('ru-RU')}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedOrder(null)}
                className="rounded-xl p-2 text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-6 p-6">
              {/* Status Buttons */}
              <div>
                <label className="mb-3 block text-sm font-medium text-gray-500">Статус</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                    <button
                      key={key}
                      onClick={() => updateStatus(selectedOrder.id, key)}
                      disabled={updatingStatus}
                      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
                        selectedOrder.status === key
                          ? `${config.bg} ${config.color} ring-2 ring-offset-2`
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {config.icon} {config.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer */}
              <div className="rounded-2xl bg-gray-50 p-5">
                <h3 className="mb-4 font-semibold">👤 Клиент</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-sm text-gray-500">Имя</div>
                    <div className="font-medium">{selectedOrder.name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Телефон</div>
                    <a href={`tel:${selectedOrder.phone}`} className="font-medium text-yellow-600 hover:underline">
                      {selectedOrder.phone}
                    </a>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Email</div>
                    <a href={`mailto:${selectedOrder.email}`} className="font-medium text-yellow-600 hover:underline">
                      {selectedOrder.email}
                    </a>
                  </div>
                </div>
              </div>

              {/* Items */}
              {selectedOrder.items && selectedOrder.items.length > 0 && (
                <div className="rounded-2xl bg-gray-50 p-5">
                  <h3 className="mb-4 font-semibold">🛒 Товары</h3>
                  <div className="space-y-3">
                    {selectedOrder.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-4 rounded-xl bg-white p-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-2xl">
                          {item.image}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-sm text-gray-500">{item.quantity} шт. × {formatPrice(item.price)}</div>
                        </div>
                        <div className="font-semibold">{formatPrice(item.price * item.quantity)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-between border-t pt-4">
                    <span className="font-semibold">Итого:</span>
                    <span className="text-xl font-bold text-yellow-600">
                      {formatPrice(selectedOrder.total_amount || 0)}
                    </span>
                  </div>
                </div>
              )}

              {/* Payment & Delivery */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-gray-50 p-5">
                  <h3 className="mb-2 font-semibold">💳 Оплата</h3>
                  <div className="text-lg">{PAYMENT_LABELS[selectedOrder.payment_method || ''] || '—'}</div>
                </div>
                <div className="rounded-2xl bg-gray-50 p-5">
                  <h3 className="mb-2 font-semibold">🚚 Доставка</h3>
                  <div className="text-lg">{DELIVERY_LABELS[selectedOrder.delivery_method || ''] || '—'}</div>
                  {selectedOrder.delivery_address && selectedOrder.delivery_method !== 'pickup' && (
                    <div className="mt-1 text-sm text-gray-600">{selectedOrder.delivery_address}</div>
                  )}
                </div>
              </div>

              {/* Comment */}
              {selectedOrder.comment && (
                <div className="rounded-2xl bg-gray-50 p-5">
                  <h3 className="mb-2 font-semibold">💬 Комментарий</h3>
                  <p className="text-gray-700">{selectedOrder.comment}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 border-t pt-6">
                <button
                  onClick={() => deleteOrder(selectedOrder.id)}
                  className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-100"
                >
                  🗑 Удалить
                </button>
                <a
                  href={`tel:${selectedOrder.phone}`}
                  className="flex-1 rounded-xl bg-yellow-400 py-3 text-center font-semibold hover:bg-yellow-500"
                >
                  📞 Позвонить
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
