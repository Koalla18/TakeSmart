import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { 
  PhoneIcon, 
  MailIcon, 
  ChevronLeftIcon,
  ClockIcon 
} from '../components/ui/Icons'
import { getJson, deleteJson } from '../lib/http'

interface Order {
  id: number
  name: string
  phone: string
  email: string
  comment: string | null
  product_id?: string
  quantity?: number
  created_at: string
}

export function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const loadOrders = () => {
    setIsLoading(true)
    getJson<Order[]>('/api/orders')
      .then((data) => {
        setOrders(data)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки')
        setIsLoading(false)
      })
  }
  
  useEffect(() => {
    loadOrders()
  }, [])
  
  const handleDelete = async (id: number) => {
    if (!confirm('Удалить эту заявку?')) return
    
    setDeletingId(id)
    try {
      await deleteJson(`/api/orders/${id}`)
      setOrders(orders.filter(o => o.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setDeletingId(null)
    }
  }

  // Stats calculation
  const todayOrders = orders.filter(o => {
    const today = new Date().toDateString()
    const orderDate = new Date(o.created_at).toDateString()
    return today === orderDate
  }).length
  
  const weekOrders = orders.filter(o => {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    return new Date(o.created_at) >= weekAgo
  }).length

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent"></div>
          <span className="text-gray-600">Загрузка данных...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-xl">
          <div className="bg-gradient-to-br from-red-500 to-rose-600 px-8 py-10 text-center text-white">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Ошибка загрузки</h2>
          </div>
          <div className="p-8 text-center">
            <p className="mb-6 text-gray-600">{error}</p>
            <Button onClick={() => window.location.reload()}>
              Повторить попытку
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800">
        <Container className="py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-bold text-gray-900">ADMIN</span>
              </div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Панель управления</h1>
              <p className="mt-1 text-gray-400">Заявки и заказы от клиентов</p>
            </div>
            <Link
              to="/"
              className="flex items-center gap-2 text-sm font-medium text-gray-400 transition-colors hover:text-white"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              На сайт
            </Link>
          </div>
        </Container>
      </div>

      <Container className="py-8">
        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500">Всего заявок</div>
                <div className="mt-1 text-3xl font-bold text-gray-900">{orders.length}</div>
              </div>
              <div className="rounded-xl bg-gray-100 p-3">
                <svg className="h-6 w-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500">Сегодня</div>
                <div className="mt-1 text-3xl font-bold text-yellow-600">{todayOrders}</div>
              </div>
              <div className="rounded-xl bg-yellow-100 p-3">
                <svg className="h-6 w-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500">За неделю</div>
                <div className="mt-1 text-3xl font-bold text-green-600">{weekOrders}</div>
              </div>
              <div className="rounded-xl bg-green-100 p-3">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500">С комментарием</div>
                <div className="mt-1 text-3xl font-bold text-purple-600">{orders.filter(o => o.comment).length}</div>
              </div>
              <div className="rounded-xl bg-purple-100 p-3">
                <svg className="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Orders list */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-bold text-gray-900">Список заявок</h2>
            <button
              onClick={loadOrders}
              className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Обновить
            </button>
          </div>
          
          {orders.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
                <svg className="h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Заявок пока нет</h3>
              <p className="text-gray-500">Новые заявки от клиентов появятся здесь</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orders.map((order) => (
                <div key={order.id} className="group p-6 transition-colors hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {/* Order number badge */}
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 text-sm font-bold text-gray-900 shadow-sm">
                        #{order.id}
                      </div>
                      
                      <div className="min-w-0 flex-1">
                        {/* Name */}
                        <h3 className="font-semibold text-gray-900">{order.name}</h3>
                        
                        {/* Contact info */}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          <a 
                            href={`tel:${order.phone}`} 
                            className="flex items-center gap-1.5 text-sm text-gray-600 transition-colors hover:text-yellow-600"
                          >
                            <PhoneIcon className="h-4 w-4" />
                            {order.phone}
                          </a>
                          <a 
                            href={`mailto:${order.email}`} 
                            className="flex items-center gap-1.5 text-sm text-gray-600 transition-colors hover:text-yellow-600"
                          >
                            <MailIcon className="h-4 w-4" />
                            {order.email}
                          </a>
                        </div>
                        
                        {/* Product info if exists */}
                        {order.product_id && (
                          <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-1.5 text-sm">
                            <span className="font-medium text-yellow-800">Товар:</span>
                            <span className="text-yellow-700">{order.product_id}</span>
                            {order.quantity && order.quantity > 1 && (
                              <span className="text-yellow-600">× {order.quantity}</span>
                            )}
                          </div>
                        )}
                        
                        {/* Comment */}
                        {order.comment && (
                          <div className="mt-3 rounded-xl bg-gray-100 p-3 text-sm text-gray-700">
                            <span className="font-medium">Комментарий:</span> {order.comment}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Right side: date + actions */}
                    <div className="flex flex-col items-end gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <ClockIcon className="h-3.5 w-3.5" />
                        {new Date(order.created_at).toLocaleString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      
                      {/* Actions */}
                      <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <a
                          href={`tel:${order.phone}`}
                          className="rounded-lg bg-green-100 p-2 text-green-600 transition-colors hover:bg-green-200"
                          title="Позвонить"
                        >
                          <PhoneIcon className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => handleDelete(order.id)}
                          disabled={deletingId === order.id}
                          className="rounded-lg bg-red-100 p-2 text-red-600 transition-colors hover:bg-red-200 disabled:opacity-50"
                          title="Удалить"
                        >
                          {deletingId === order.id ? (
                            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Container>
    </div>
  )
}
