import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { useCart, MAX_QUANTITY_PER_ITEM, MAX_TOTAL_ITEMS } from '../lib/cart'
import { formatPrice } from '../data/products'
import { API_BASE_URL } from '../lib/config'
import { ymEcommercePurchase, ymReachGoal } from '../lib/metrika'

function isImageUrl(url?: string): boolean {
  if (!url) return false
  return url.startsWith('http') || url.startsWith('/api/media') || url.startsWith('/products') || url.startsWith('/uploads') || url.startsWith('/static')
}
function getImageUrl(url: string): string {
  if (url.startsWith('/uploads') || url.startsWith('/static')) return `${API_BASE_URL}${url}`
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
  customer_name: string
  customer_email: string
  customer_phone: string | null
  shipping_address: string
  shipping_city: string
  shipping_postal_code: string | null
  customer_note: string | null
  items: Array<{
    product_id: string
    quantity: number
  }>
}

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Наличными', icon: '💵', desc: 'При получении', markup: 0 },
  { id: 'card', label: 'Картой', icon: '💳', desc: '+16% к цене', markup: 0.16 },
  { id: 'qr', label: 'QR-код в магазине', icon: '📱', desc: '+13% к цене', markup: 0.13 },
]

const DELIVERY_METHODS = [
  { id: 'pickup', label: 'Самовывоз', icon: '🏪', desc: 'Бесплатно', price: 0 },
  { id: 'courier', label: 'Курьер', icon: '🚗', desc: 'По Москве', price: 1000 },
  { id: 'post', label: 'Почта', icon: '📦', desc: 'По России', price: 800 },
]

const STORE_ADDRESS = 'г. Москва, ул. Барклая, д. 10, ТЦ «Багратионовский», павильон А60'

export function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, getTotal } = useCart()
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    comment: '',
  })
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({})  
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [deliveryMethod, setDeliveryMethod] = useState('pickup')
  // Структурированный адрес доставки
  const [addressFields, setAddressFields] = useState({
    city: '',
    street: '',
    house: '',
    apartment: '',
  })
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [orderNumber, setOrderNumber] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limitWarning, setLimitWarning] = useState<string | null>(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)

  // Общее количество товаров
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)

  // Обработчик изменения количества с показом предупреждения
  const handleQuantityChange = (productId: string, newQuantity: number) => {
    setLimitWarning(null)
    const currentItem = items.find(i => i.product.id === productId)
    const stockLimit = currentItem?.product.stockQuantity != null ? currentItem.product.stockQuantity : MAX_QUANTITY_PER_ITEM
    const effectiveMax = Math.min(MAX_QUANTITY_PER_ITEM, stockLimit)
    if (newQuantity > effectiveMax) {
      setLimitWarning(stockLimit < MAX_QUANTITY_PER_ITEM ? `В наличии только ${stockLimit} шт.` : `Максимум ${MAX_QUANTITY_PER_ITEM} единиц одного товара`)
      return
    }
    const diff = newQuantity - (currentItem?.quantity || 0)
    if (totalQuantity + diff > MAX_TOTAL_ITEMS) {
      setLimitWarning(`Максимум ${MAX_TOTAL_ITEMS} товаров в заказе`)
      return
    }
    updateQuantity(productId, newQuantity)
  }

  // ─── Вспомогательные проверки адреса ──────────────────────────────────────
  // Проверяет, не является ли строка «мусорной» (одинаковые/случайные символы)
  const isJunkString = (s: string): boolean => {
    const t = s.trim().toLowerCase()
    // Слишком много повторяющихся символов (например «аааааа», «qqqqqq»)
    if (/(.)(\1){3,}/.test(t)) return true
    // Только цифры там где должны быть буквы — для города/улицы проверяем отдельно
    return false
  }

  // Валидация полей адреса
  const validateAddressFields = (): boolean => {
    if (deliveryMethod === 'pickup') return true
    const errs: Record<string, string> = {}
    const { city, street, house, apartment } = addressFields

    // Город
    const cityT = city.trim()
    if (!cityT) {
      errs.city = 'Укажите город'
    } else if (cityT.length < 2) {
      errs.city = 'Слишком короткое название города'
    } else if (cityT.length > 100) {
      errs.city = 'Не более 100 символов'
    } else if (!/^[а-яА-ЯёЁa-zA-Z\s\-\.]+$/.test(cityT)) {
      errs.city = 'Город может содержать только буквы, пробелы и дефисы'
    } else if (isJunkString(cityT)) {
      errs.city = 'Укажите корректное название города'
    }

    // Улица
    const streetT = street.trim()
    if (!streetT) {
      errs.street = 'Укажите улицу'
    } else if (streetT.length < 3) {
      errs.street = 'Слишком короткое название улицы'
    } else if (streetT.length > 100) {
      errs.street = 'Не более 100 символов'
    } else if (!/^[а-яА-ЯёЁa-zA-Z0-9\s\-\.«»"]+$/.test(streetT)) {
      errs.street = 'Улица содержит недопустимые символы'
    } else if (isJunkString(streetT)) {
      errs.street = 'Укажите корректное название улицы'
    }

    // Дом — только цифры, дроби (3/4), корпус (10к2, 10к/2), литера (10А)
    const houseT = house.trim()
    if (!houseT) {
      errs.house = 'Укажите номер дома'
    } else if (houseT.length > 20) {
      errs.house = 'Не более 20 символов'
    } else if (!/^\d+([а-яА-ЯёЁa-zA-Z]{0,3})?([\/\-]\d+([а-яА-ЯёЁa-zA-Z]{0,3})?)?$/.test(houseT)) {
      errs.house = 'Формат: 10, 10А, 10/2, 10к1, 10-2'
    }

    // Квартира — необязательно, но если заполнена — только цифры/буквы
    const aptT = apartment.trim()
    if (aptT) {
      if (aptT.length > 20) {
        errs.apartment = 'Не более 20 символов'
      } else if (!/^[а-яА-ЯёЁa-zA-Z0-9\-\/]+$/.test(aptT)) {
        errs.apartment = 'Только цифры и буквы'
      }
    }

    setAddressErrors(errs)
    return Object.keys(errs).length === 0
  }

  const buildDeliveryAddress = (): string => {
    if (deliveryMethod === 'pickup') return STORE_ADDRESS
    const { city, street, house, apartment } = addressFields
    let addr = `${city.trim()}, ${street.trim()}, д. ${house.trim()}`
    if (apartment.trim()) addr += `, кв. ${apartment.trim()}`
    return addr
  }

  const subtotal = getTotal()
  const deliveryPrice = DELIVERY_METHODS.find(d => d.id === deliveryMethod)?.price || 0
  const paymentMarkup = PAYMENT_METHODS.find(p => p.id === paymentMethod)?.markup || 0
  const cardMarkupAmount = paymentMarkup > 0 ? Math.round(subtotal * paymentMarkup) : 0
  const total = subtotal + deliveryPrice + cardMarkupAmount

  // ─── Вспомогательная функция: непосредственная отправка заказа ──────────────
  const submitOrder = async (orderItems: Array<{ product_id: string; quantity: number }>) => {
    const deliveryAddress = buildDeliveryAddress()
    const paymentLabel = PAYMENT_METHODS.find(p => p.id === paymentMethod)?.label || paymentMethod
    const deliveryLabel = DELIVERY_METHODS.find(d => d.id === deliveryMethod)?.label || deliveryMethod
    const noteParts: string[] = []
    noteParts.push(`Оплата: ${paymentLabel}`)
    noteParts.push(`Доставка: ${deliveryLabel}`)
    if (formData.comment.trim()) noteParts.push(`Комментарий: ${formData.comment.trim()}`)

    const shippingCity = deliveryMethod === 'pickup' ? 'Москва' : (addressFields.city.trim() || 'Москва')
    const phoneDigits = formData.phone.replace(/\D/g, '')
    const phoneNorm = phoneDigits.startsWith('8') ? '+7' + phoneDigits.slice(1) : '+' + phoneDigits

    const payload: OrderPayload = {
      customer_name: formData.name.trim(),
      customer_email: formData.email.trim() || 'noemail@takesmart.ru',
      customer_phone: phoneNorm || null,
      shipping_address: deliveryAddress,
      shipping_city: shippingCity,
      shipping_postal_code: null,
      customer_note: noteParts.join(' | ') || null,
      items: orderItems,
    }

    // Защита от зависшего запроса: обрываем fetch, если сервер не ответил за 30 сек.
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000)

    let res: Response
    try {
      res = await fetch(`${API_BASE_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Сервер не отвечает. Проверьте соединение и попробуйте ещё раз.')
      }
      throw new Error('Не удалось связаться с сервером. Проверьте интернет-соединение.')
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (!res.ok) {
      if (res.status === 422) {
        const data = await res.json().catch(() => null)
        const details = data?.details as Array<{ field?: string | null; message: string }> | undefined
        if (details?.length) {
          throw new Error(details.map(d => (d.field ? `${d.field}: ${d.message}` : d.message)).join('\n'))
        }
      }
      if (res.status === 429) throw new Error('Слишком много попыток. Подождите несколько минут и повторите')
      if (res.status === 409) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.detail || 'Недостаточно товара на складе. Уменьшите количество или удалите товар из корзины.')
      }
      throw new Error('Ошибка при оформлении заказа')
    }

    const order = await res.json()

    // Аналитика: успешный заказ (цель + e-commerce purchase). Считаем до clearCart,
    // пока items/total ещё актуальны в этом замыкании.
    ymReachGoal('order_success', { revenue: total })
    ymEcommercePurchase(
      String(order.order_number ?? order.id ?? ''),
      items.map(item => ({
        id: item.product.id,
        name: item.product.name,
        price: item.product.price,
        brand: item.product.brand || undefined,
        category: item.product.category || undefined,
        quantity: item.quantity,
      })),
      total,
    )

    clearCart()
    setOrderNumber(order.order_number ?? null)
    setIsSuccess(true)
  }

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

    // Валидация адреса доставки
    if (!validateAddressFields()) {
      setError('Пожалуйста, заполните все поля адреса')
      return
    }

    if (!consentChecked) {
      setConsentError('Подтвердите согласие на обработку персональных данных')
      setError('Подтвердите согласие на обработку персональных данных')
      return
    }
    setConsentError(null)

    setIsSubmitting(true)
    setError(null)

    try {
      await submitOrder(items.map(item => ({ product_id: item.product.id, quantity: item.quantity })))
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
            {orderNumber && (
              <div className="mb-4 rounded-xl bg-yellow-50 px-6 py-3 text-center">
                <span className="text-sm text-gray-500">Номер заказа</span>
                <div className="text-2xl font-bold text-yellow-600">{orderNumber}</div>
              </div>
            )}
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
    <div className="min-h-screen bg-gray-50 py-12 pb-32 lg:pb-12">
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
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Очистить корзину? Все товары будут удалены.'))
                        clearCart()
                    }}
                    className="text-sm text-red-500 hover:text-red-600"
                  >
                    Очистить
                  </button>
                </div>
                
                <div className="divide-y">
                  {items.map(item => (
                    <div key={item.product.id} className="flex gap-3 py-4">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 sm:h-20 sm:w-20">
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
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-500">{item.product.brand}</div>
                        <div className="line-clamp-2 font-semibold">{item.product.name}</div>
                        <div className="mt-2 flex items-center gap-4">
                          {/* Quantity */}
                          <div className="flex items-center gap-2 rounded-lg border px-2">
                            <button type="button" onClick={() => handleQuantityChange(item.product.id, item.quantity - 1)} className="px-2 py-1 text-gray-500 hover:text-gray-900">−</button>
                            <span className="w-8 text-center">{item.quantity}</span>
                            <button 
                              type="button" 
                              onClick={() => handleQuantityChange(item.product.id, item.quantity + 1)} 
                              className={`px-2 py-1 ${item.quantity >= Math.min(MAX_QUANTITY_PER_ITEM, item.product.stockQuantity ?? MAX_QUANTITY_PER_ITEM) || totalQuantity >= MAX_TOTAL_ITEMS ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900'}`}
                              disabled={item.quantity >= Math.min(MAX_QUANTITY_PER_ITEM, item.product.stockQuantity ?? MAX_QUANTITY_PER_ITEM) || totalQuantity >= MAX_TOTAL_ITEMS}
                            >+</button>
                          </div>
                          <button type="button" onClick={() => removeItem(item.product.id)} className="text-sm text-red-500">Удалить</button>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="font-bold">{formatPrice(item.product.price * item.quantity)}</div>
                        {item.quantity > 1 && (
                          <div className="text-xs text-gray-500">{formatPrice(item.product.price)} / шт</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Уведомление о б/у технике */}
                {items.some(item => item.product.condition === 'used') && (
                  <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                    <div className="font-semibold">⚠️ В вашей корзине есть б/у техника</div>
                    <p className="mt-1 text-amber-700">
                      Товары с пометкой «б/у» были в использовании. Перед покупкой рекомендуем уточнить состояние у менеджера.
                    </p>
                  </div>
                )}

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
                          +{Math.round(method.markup * 100)}% к цене
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
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold">🚚 Способ доставки</h2>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  {DELIVERY_METHODS.map(method => {
                    return (
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
                          onChange={() => { setDeliveryMethod(method.id); setAddressErrors({}) }}
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
                    )
                  })}
                </div>
                
                {/* Самовывоз — показываем адрес */}
                {deliveryMethod === 'pickup' && (
                  <div className="mt-6 rounded-xl bg-gray-50 p-4">
                    <div className="mb-1 font-semibold text-gray-900">📍 Адрес самовывоза:</div>
                    <p className="text-gray-700">{STORE_ADDRESS}</p>
                    <p className="mt-1 text-sm text-gray-500">М. Багратионовская · Пн-Вс 10:00–20:00</p>
                  </div>
                )}

                {/* Доставка — структурированная форма адреса */}
                {deliveryMethod !== 'pickup' && (
                  <div className="mt-6 space-y-4">
                    <div className="font-semibold text-gray-900">📍 Адрес доставки</div>
                    
                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Город */}
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-sm font-medium text-gray-700">
                          Город <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={addressFields.city}
                          onChange={(e) => {
                            setAddressFields(p => ({ ...p, city: e.target.value }))
                            if (addressErrors.city) setAddressErrors(p => ({ ...p, city: '' }))
                          }}
                          className={`w-full rounded-xl border p-3 focus:outline-none focus:ring-2 ${
                            addressErrors.city ? 'border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-yellow-400 focus:ring-yellow-100'
                          }`}
                          placeholder="Москва"
                        />
                        {addressErrors.city && <p className="mt-1 text-sm text-red-500">{addressErrors.city}</p>}
                      </div>
                      
                      {/* Улица */}
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-sm font-medium text-gray-700">
                          Улица <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={addressFields.street}
                          onChange={(e) => {
                            setAddressFields(p => ({ ...p, street: e.target.value }))
                            if (addressErrors.street) setAddressErrors(p => ({ ...p, street: '' }))
                          }}
                          className={`w-full rounded-xl border p-3 focus:outline-none focus:ring-2 ${
                            addressErrors.street ? 'border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-yellow-400 focus:ring-yellow-100'
                          }`}
                          placeholder="ул. Ленина"
                        />
                        {addressErrors.street && <p className="mt-1 text-sm text-red-500">{addressErrors.street}</p>}
                      </div>
                      
                      {/* Дом */}
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700">
                          Дом <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={addressFields.house}
                          onChange={(e) => {
                            setAddressFields(p => ({ ...p, house: e.target.value }))
                            if (addressErrors.house) setAddressErrors(p => ({ ...p, house: '' }))
                          }}
                          className={`w-full rounded-xl border p-3 focus:outline-none focus:ring-2 ${
                            addressErrors.house ? 'border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-yellow-400 focus:ring-yellow-100'
                          }`}
                          placeholder="10к1"
                        />
                        {addressErrors.house && <p className="mt-1 text-sm text-red-500">{addressErrors.house}</p>}
                      </div>
                      
                      {/* Квартира */}
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700">
                          Квартира / офис
                        </label>
                        <input
                          type="text"
                          value={addressFields.apartment}
                          onChange={(e) => {
                            setAddressFields(p => ({ ...p, apartment: e.target.value }))
                            if (addressErrors.apartment) setAddressErrors(p => ({ ...p, apartment: '' }))
                          }}
                          className={`w-full rounded-xl border p-3 focus:outline-none focus:ring-2 ${
                            addressErrors.apartment ? 'border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-yellow-400 focus:ring-yellow-100'
                          }`}
                          placeholder="42"
                        />
                        {addressErrors.apartment && <p className="mt-1 text-sm text-red-500">{addressErrors.apartment}</p>}
                      </div>
                    </div>
                    
                    {/* Превью итогового адреса */}
                    {(addressFields.city || addressFields.street || addressFields.house) && (
                      <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
                        📦 Доставим по адресу: <span className="font-medium">{buildDeliveryAddress()}</span>
                      </div>
                    )}
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
                      <span>Наценка ({PAYMENT_METHODS.find(p => p.id === paymentMethod)?.label} +{Math.round(paymentMarkup * 100)}%)</span>
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
                  <div className="mt-3 rounded-xl bg-orange-50 p-3 text-sm text-orange-700">
                    ⚠️ При оплате {paymentMethod === 'card' ? 'картой' : 'по QR-коду'} действует наценка {Math.round(paymentMarkup * 100)}%. Оплата наличными без наценки.
                  </div>
                )}

                <div className="mt-6 rounded-xl border border-gray-200 p-4">
                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(e) => {
                        setConsentChecked(e.target.checked)
                        if (e.target.checked) {
                          setConsentError(null)
                          if (error === 'Подтвердите согласие на обработку персональных данных') {
                            setError(null)
                          }
                        }
                      }}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-400"
                    />
                    <span>
                      Я даю согласие на обработку персональных данных в соответствии с{' '}
                      <Link to="/personal-data" className="text-yellow-600 hover:underline">Согласием</Link>.
                    </span>
                  </label>
                  {consentError && (
                    <p className="mt-2 text-xs text-red-600">{consentError}</p>
                  )}
                </div>
                
                <Button type="submit" disabled={isSubmitting} size="lg" className="mt-6 w-full">
                  {isSubmitting ? 'Оформляем...' : 'Оформить заказ'}
                </Button>
                
                <p className="mt-4 text-center text-xs text-gray-500">
                  Нажимая кнопку, вы принимаете условия{' '}
                  <Link to="/offer" className="text-yellow-600 hover:underline">публичной оферты</Link>{' '}
                  и{' '}
                  <Link to="/privacy-policy" className="text-yellow-600 hover:underline">политики конфиденциальности</Link>.
                </p>
              </div>
            </div>
          </div>

          {/* ── Mobile sticky checkout bar ──────────────────────────────────── */}
          <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-2xl shadow-gray-900/10 backdrop-blur-sm lg:hidden">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-gray-500">К оплате</div>
                <div className="text-lg font-bold text-yellow-600">{formatPrice(total)}</div>
                {cardMarkupAmount > 0 && (
                  <div className="text-xs text-orange-600">+{Math.round(paymentMarkup * 100)}% — {PAYMENT_METHODS.find(p => p.id === paymentMethod)?.label}</div>
                )}
              </div>
              <Button type="submit" disabled={isSubmitting} size="md" className="shrink-0">
                {isSubmitting ? 'Оформляем...' : 'Оформить заказ'}
              </Button>
            </div>
          </div>
        </form>
      </Container>
    </div>
  )
}
