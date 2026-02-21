import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { useCart, MAX_QUANTITY_PER_ITEM, MAX_TOTAL_ITEMS } from '../lib/cart'
import { formatPrice } from '../data/products'
import { API_BASE_URL } from '../lib/config'

function isImageUrl(url?: string): boolean {
  if (!url) return false
  return url.startsWith('http') || url.startsWith('/products') || url.startsWith('/uploads')
}
function getImageUrl(url: string): string {
  if (url.startsWith('/uploads')) return `${API_BASE_URL}${url}`
  return url
}

// ─── Валидация имени ──────────────────────────────────────────────────────

function validateName(value: string): string | null {
  if (!value.trim()) return 'Введите имя'
  if (value.trim().length < 2) return 'Имя должно быть не менее 2 символов'
  if (value.trim().length > 100) return 'Имя слишком длинное'
  if (!/^[а-яА-ЯёЁa-zA-Z\s\-]+$/.test(value.trim()))
    return 'Имя может содержать только буквы, пробелы и дефисы'
  return null
}

// ─── Маска и валидация телефона ──────────────────────────────────────────
function formatPhone(raw: string): string {
  // Оставим только цифры
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''

  // Нормализуем: 8XXX → 7XXX
  const norm = digits.startsWith('8') ? '7' + digits.slice(1) : digits

  // Формат: +7 (XXX) XXX-XX-XX
  const d = norm.startsWith('7') ? norm : '7' + norm
  const p1 = d.slice(1, 4)
  const p2 = d.slice(4, 7)
  const p3 = d.slice(7, 9)
  const p4 = d.slice(9, 11)

  let result = '+7'
  if (p1) result += ` (${p1}`
  if (p1.length === 3) result += ')'
  if (p2) result += ` ${p2}`
  if (p3) result += `-${p3}`
  if (p4) result += `-${p4}`
  return result
}

function validatePhone(value: string): string | null {
  if (!value.trim()) return 'Введите номер телефона'
  const digits = value.replace(/\D/g, '')
  if (digits.length < 11) return 'Неполный номер телефона'
  if (digits.length > 11) return 'Слишком много цифр'
  const norm = digits.startsWith('8') ? '7' + digits.slice(1) : digits
  if (!norm.startsWith('7')) return 'Номер должен начинаться на +7 или 8'
  return null
}

interface OrderPayload {
  name: string
  phone: string
  email: string
  comment: string
  items: Array<{
    product_id: string
    name: string
    price: number
    quantity: number
    image: string
  }>
  total_amount: number
  payment_method: string
  delivery_method: string
  delivery_address: string
}

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Наличными', icon: '💵', desc: 'При получении', markup: 0 },
  { id: 'card', label: 'Картой', icon: '💳', desc: '+15% к цене', markup: 0.15 },
]

const DELIVERY_METHODS = [
  { id: 'pickup', label: 'Самовывоз', icon: '🏪', desc: 'Бесплатно', price: 0 },
  { id: 'courier', label: 'Курьер', icon: '🚗', desc: 'По Москве', price: 500 },
  { id: 'post', label: 'Почта', icon: '📦', desc: 'По России', price: 800 },
]

export function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, getTotal } = useCart()
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    comment: '',
  })
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({})  
  const [paymentMethod, setPaymentMethod] = useState('card')
  const [deliveryMethod, setDeliveryMethod] = useState('pickup')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitWarning, setLimitWarning] = useState<string | null>(null)

  // Общее количество товаров
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)

  // Обработчик изменения количества с показом предупреждения
  const handleQuantityChange = (productId: string, newQuantity: number) => {
    setLimitWarning(null)
    if (newQuantity > MAX_QUANTITY_PER_ITEM) {
      setLimitWarning(`Максимум ${MAX_QUANTITY_PER_ITEM} единиц одного товара`)
      return
    }
    const currentItem = items.find(i => i.product.id === productId)
    const diff = newQuantity - (currentItem?.quantity || 0)
    if (totalQuantity + diff > MAX_TOTAL_ITEMS) {
      setLimitWarning(`Максимум ${MAX_TOTAL_ITEMS} товаров в заказе`)
      return
    }
    updateQuantity(productId, newQuantity)
  }

  const deliveryPrice = DELIVERY_METHODS.find(d => d.id === deliveryMethod)?.price || 0
  const paymentMarkup = PAYMENT_METHODS.find(p => p.id === paymentMethod)?.markup || 0
  const subtotal = getTotal()
  const cardMarkupAmount = paymentMarkup > 0 ? Math.round(subtotal * paymentMarkup) : 0
  const total = subtotal + deliveryPrice + cardMarkupAmount

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLimitWarning(null)
    
    // Клиентская валидация
    const nameErr = validateName(formData.name)
    const phoneErr = validatePhone(formData.phone)
    if (nameErr || phoneErr) {
      setFieldErrors({ name: nameErr ?? undefined, phone: phoneErr ?? undefined })
      return
    }
    setFieldErrors({})
    
    if (items.length === 0) {
      setError('Корзина пуста')
      return
    }
    
    // Валидация лимитов
    if (totalQuantity > MAX_TOTAL_ITEMS) {
      setError(`Максимум ${MAX_TOTAL_ITEMS} товаров в заказе`)
      return
    }
    
    for (const item of items) {
      if (item.quantity > MAX_QUANTITY_PER_ITEM) {
        setError(`Максимум ${MAX_QUANTITY_PER_ITEM} единиц одного товара`)
        return
      }
      if (item.quantity < 1 || item.product.price < 0) {
        setError('Некорректные данные в корзине')
        return
      }
    }

    if (deliveryMethod !== 'pickup' && !deliveryAddress.trim()) {
      setError('Укажите адрес доставки')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const payload: OrderPayload = {
        ...formData,
        items: items.map(item => ({
          product_id: item.product.id,
          name: item.product.name,
          price: item.product.price,
          quantity: item.quantity,
          image: item.product.image
        })),
        total_amount: total,
        payment_method: paymentMethod,
        delivery_method: deliveryMethod,
        delivery_address: deliveryMethod === 'pickup' ? 'Самовывоз' : deliveryAddress,
      }
      
      const res = await fetch(`${API_BASE_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      if (!res.ok) {
        if (res.status === 429) throw new Error('Слишком много попыток. Подождите несколько минут и повторите')
        throw new Error('Ошибка при оформлении заказа')
      }
      
      clearCart()
      setIsSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Success
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-20">
        <Container>
          <div className="mx-auto max-w-lg text-center">
            <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-green-100">
              <span className="text-5xl">✅</span>
            </div>
            <h1 className="mb-4 text-3xl font-bold text-gray-900">Заказ оформлен!</h1>
            <p className="mb-8 text-lg text-gray-600">
              Мы свяжемся с вами в течение 15 минут для подтверждения заказа.
            </p>
            <Button to="/" size="lg">На главную</Button>
          </div>
        </Container>
      </div>
    )
  }

  // Empty cart
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-20">
        <Container>
          <div className="mx-auto max-w-lg text-center">
            <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gray-100">
              <span className="text-5xl">🛒</span>
            </div>
            <h1 className="mb-4 text-3xl font-bold text-gray-900">Корзина пуста</h1>
            <p className="mb-8 text-lg text-gray-600">
              Добавьте товары из каталога
            </p>
            <Button to="/catalog" size="lg">Перейти в каталог</Button>
          </div>
        </Container>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <Container>
        {/* Breadcrumbs */}
        <nav className="mb-8 flex items-center gap-2 text-sm">
          <Link to="/" className="text-gray-500 hover:text-yellow-600">Главная</Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900">Корзина</span>
        </nav>

        <h1 className="mb-8 text-3xl font-bold text-gray-900">Оформление заказа</h1>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Left column */}
            <div className="lg:col-span-2 space-y-8">
              {/* Cart Items */}
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold">🛒 Товары ({items.length})</h2>
                  <button type="button" onClick={clearCart} className="text-sm text-red-500 hover:text-red-600">
                    Очистить
                  </button>
                </div>
                
                <div className="divide-y">
                  {items.map(item => (
                    <div key={item.product.id} className="flex gap-4 py-4">
                      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                        {isImageUrl(item.product.image) ? (
                          <img
                            src={getImageUrl(item.product.image)}
                            alt={item.product.name}
                            className="h-full w-full object-contain p-1"
                          />
                        ) : (
                          <span className="text-4xl">{item.product.image || '📦'}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-gray-500">{item.product.brand}</div>
                        <div className="font-semibold">{item.product.name}</div>
                        <div className="mt-2 flex items-center gap-4">
                          {/* Quantity */}
                          <div className="flex items-center gap-2 rounded-lg border px-2">
                            <button type="button" onClick={() => handleQuantityChange(item.product.id, item.quantity - 1)} className="px-2 py-1 text-gray-500 hover:text-gray-900">−</button>
                            <span className="w-8 text-center">{item.quantity}</span>
                            <button 
                              type="button" 
                              onClick={() => handleQuantityChange(item.product.id, item.quantity + 1)} 
                              className={`px-2 py-1 ${item.quantity >= MAX_QUANTITY_PER_ITEM || totalQuantity >= MAX_TOTAL_ITEMS ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900'}`}
                              disabled={item.quantity >= MAX_QUANTITY_PER_ITEM || totalQuantity >= MAX_TOTAL_ITEMS}
                            >+</button>
                          </div>
                          <button type="button" onClick={() => removeItem(item.product.id)} className="text-sm text-red-500">Удалить</button>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatPrice(item.product.price * item.quantity)}</div>
                        {item.quantity > 1 && (
                          <div className="text-sm text-gray-500">{formatPrice(item.product.price)} / шт</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Лимит предупреждение */}
                {limitWarning && (
                  <div className="mt-4 rounded-lg bg-orange-50 p-3 text-sm text-orange-700">
                    ⚠️ {limitWarning}
                  </div>
                )}
                
                {/* Счётчик товаров */}
                <div className="mt-4 text-sm text-gray-500 text-right">
                  Товаров в заказе: {totalQuantity} / {MAX_TOTAL_ITEMS}
                </div>
              </div>

              {/* Payment Method */}
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <h2 className="mb-6 text-xl font-bold">💳 Способ оплаты</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PAYMENT_METHODS.map(method => (
                    <label
                      key={method.id}
                      className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-5 transition-all ${
                        paymentMethod === method.id 
                          ? method.markup > 0 
                            ? 'border-orange-400 bg-orange-50' 
                            : 'border-green-400 bg-green-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={method.id}
                        checked={paymentMethod === method.id}
                        onChange={() => setPaymentMethod(method.id)}
                        className="sr-only"
                      />
                      <span className="text-4xl">{method.icon}</span>
                      <span className="text-lg font-semibold">{method.label}</span>
                      {method.markup > 0 ? (
                        <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
                          +15% к цене
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                          Без наценки
                        </span>
                      )}
                      {paymentMethod === method.id && (
                        <span className={`absolute right-3 top-3 ${method.markup > 0 ? 'text-orange-500' : 'text-green-500'}`}>✓</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* Delivery Method */}
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <h2 className="mb-6 text-xl font-bold">🚚 Способ доставки</h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  {DELIVERY_METHODS.map(method => (
                    <label
                      key={method.id}
                      className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                        deliveryMethod === method.id ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="delivery"
                        value={method.id}
                        checked={deliveryMethod === method.id}
                        onChange={() => setDeliveryMethod(method.id)}
                        className="sr-only"
                      />
                      <span className="text-3xl">{method.icon}</span>
                      <span className="font-semibold">{method.label}</span>
                      <span className="text-sm text-gray-500">{method.desc}</span>
                      <span className="font-medium text-yellow-600">
                        {method.price === 0 ? 'Бесплатно' : `+${formatPrice(method.price)}`}
                      </span>
                      {deliveryMethod === method.id && (
                        <span className="absolute right-2 top-2 text-yellow-500">✓</span>
                      )}
                    </label>
                  ))}
                </div>
                
                {deliveryMethod !== 'pickup' && (
                  <div className="mt-6">
                    <label className="mb-2 block font-medium">Адрес доставки *</label>
                    <textarea
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 p-4 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
                      placeholder="Город, улица, дом, квартира"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Contact Info */}
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <h2 className="mb-6 text-xl font-bold">👤 Контактные данные</h2>
                
                {error && (
                  <div className="mb-6 rounded-xl bg-red-50 p-4 text-red-600">⚠️ {error}</div>
                )}
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-2 block font-medium">Имя *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => {
                        const val = e.target.value
                        setFormData({ ...formData, name: val })
                        setFieldErrors(prev => ({ ...prev, name: validateName(val) ?? undefined }))
                      }}
                      className={`w-full rounded-xl border p-4 focus:outline-none focus:ring-2 ${
                        fieldErrors.name
                          ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                          : 'border-gray-200 focus:border-yellow-400 focus:ring-yellow-100'
                      }`}
                      placeholder="Иван Иванов"
                    />
                    {fieldErrors.name && (
                      <p className="mt-1 text-sm text-red-500">{fieldErrors.name}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block font-medium">Телефон *</label>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => {
                        const formatted = formatPhone(e.target.value)
                        setFormData({ ...formData, phone: formatted })
                        setFieldErrors(prev => ({ ...prev, phone: validatePhone(formatted) ?? undefined }))
                      }}
                      className={`w-full rounded-xl border p-4 focus:outline-none focus:ring-2 ${
                        fieldErrors.phone
                          ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                          : 'border-gray-200 focus:border-yellow-400 focus:ring-yellow-100'
                      }`}
                      placeholder="+7 (999) 123-45-67"
                    />
                    {fieldErrors.phone && (
                      <p className="mt-1 text-sm text-red-500">{fieldErrors.phone}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block font-medium">Email *</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full rounded-xl border border-gray-200 p-4 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-2 block font-medium">Комментарий</label>
                    <textarea
                      value={formData.comment}
                      onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 p-4 focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
                      placeholder="Дополнительные пожелания..."
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right column - Summary */}
            <div>
              <div className="sticky top-24 rounded-2xl bg-white p-6 shadow-sm">
                <h2 className="mb-6 text-xl font-bold">Итого</h2>
                
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Товары ({items.length})</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                  {cardMarkupAmount > 0 && (
                    <div className="flex justify-between text-orange-600">
                      <span>Оплата картой +15%</span>
                      <span>+{formatPrice(cardMarkupAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Доставка</span>
                    <span>{deliveryPrice === 0 ? 'Бесплатно' : formatPrice(deliveryPrice)}</span>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>К оплате</span>
                      <span className="text-yellow-600">{formatPrice(total)}</span>
                    </div>
                  </div>
                </div>
                
                {cardMarkupAmount > 0 && (
                  <div className="mt-4 rounded-xl bg-orange-50 p-3 text-sm text-orange-700">
                    ⚠️ При оплате картой действует наценка 15%. Оплата наличными без наценки.
                  </div>
                )}
                
                <Button type="submit" disabled={isSubmitting} size="lg" className="mt-6 w-full">
                  {isSubmitting ? 'Оформляем...' : 'Оформить заказ'}
                </Button>
                
                <p className="mt-4 text-center text-xs text-gray-500">
                  Нажимая кнопку, вы соглашаетесь с политикой конфиденциальности
                </p>
              </div>
            </div>
          </div>
        </form>
      </Container>
    </div>
  )
}
