import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { 
  PhoneIcon, 
  MailIcon, 
  ClockIcon,
  ShieldIcon,
  TruckIcon,
  CheckIcon,
  ChevronLeftIcon
} from '../components/ui/Icons'
import { postJson } from '../lib/http'
import { type Product, formatPrice } from '../data/products'

interface OrderPayload {
  name: string
  phone: string
  email: string
  comment: string
  product_id?: string
  quantity?: number
}

interface LocationState {
  product?: Product
  quantity?: number
}

export function CartPage() {
  const location = useLocation()
  const state = location.state as LocationState | null
  const selectedProduct = state?.product
  const selectedQuantity = state?.quantity || 1
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    comment: selectedProduct 
      ? `Заказ: ${selectedProduct.name} (${selectedQuantity} шт.)` 
      : '',
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const payload: OrderPayload = {
        ...formData,
        ...(selectedProduct && {
          product_id: selectedProduct.id,
          quantity: selectedQuantity,
        }),
      }
      await postJson<OrderPayload>('/api/orders', payload)
      setIsSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-4 py-20">
        <Container>
          <div className="mx-auto max-w-lg">
            <div className="overflow-hidden rounded-3xl border border-green-100 bg-white shadow-xl">
              <div className="bg-gradient-to-br from-green-400 to-emerald-500 px-8 py-12 text-center text-white">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                  <CheckIcon className="h-10 w-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold">Заявка отправлена!</h2>
              </div>
              <div className="px-8 py-10 text-center">
                <p className="mb-2 text-lg text-gray-700">
                  Спасибо за обращение!
                </p>
                <p className="mb-8 text-gray-500">
                  Мы свяжемся с вами в течение 15 минут для подтверждения заказа.
                </p>
                {selectedProduct && (
                  <div className="mb-8 rounded-2xl bg-gray-50 p-4">
                    <div className="flex items-center gap-4">
                      <span className="text-4xl">{selectedProduct.image}</span>
                      <div className="text-left">
                        <div className="font-medium text-gray-900">{selectedProduct.name}</div>
                        <div className="text-sm text-gray-500">{selectedQuantity} шт.</div>
                        <div className="font-semibold text-yellow-600">
                          {formatPrice(selectedProduct.price * selectedQuantity)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <Button to="/" size="lg" className="w-full">
                  Вернуться на главную
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white">
        <Container className="py-8">
          <nav className="mb-4 flex items-center gap-2 text-sm">
            <Link to="/" className="text-gray-500 hover:text-yellow-600">Главная</Link>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900">Оформление заказа</span>
          </nav>
          <h1 className="text-3xl font-bold text-gray-900">
            {selectedProduct ? 'Оформление заказа' : 'Оставить заявку'}
          </h1>
          <p className="mt-2 text-gray-600">
            {selectedProduct 
              ? 'Заполните форму для оформления заказа'
              : 'Заполните форму, и мы свяжемся с вами для консультации'
            }
          </p>
        </Container>
      </div>

      <Container className="py-12">
        <div className="grid gap-12 lg:grid-cols-5">
          {/* Form */}
          <div className="lg:col-span-3">
            {/* Selected Product Card */}
            {selectedProduct && (
              <div className="mb-8 overflow-hidden rounded-2xl border border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50">
                <div className="p-6">
                  <div className="flex items-center gap-6">
                    <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm">
                      <span className="text-5xl">{selectedProduct.image}</span>
                    </div>
                    <div className="flex-1">
                      <div className="mb-1 text-sm text-gray-500">{selectedProduct.brand}</div>
                      <h3 className="mb-2 text-lg font-semibold text-gray-900">
                        {selectedProduct.name}
                      </h3>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">Количество: {selectedQuantity} шт.</span>
                        <span className="text-xl font-bold text-gray-900">
                          {formatPrice(selectedProduct.price * selectedQuantity)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              <div className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm">
                <h2 className="mb-6 text-xl font-bold text-gray-900">
                  Контактная информация
                </h2>
                
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="name"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Ваше имя <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm transition-all focus:border-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-100"
                      placeholder="Иван Иванов"
                    />
                  </div>
                  
                  <div>
                    <label
                      htmlFor="phone"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Телефон <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: e.target.value })
                      }
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm transition-all focus:border-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-100"
                      placeholder="+7 (999) 123-45-67"
                    />
                  </div>
                  
                  <div>
                    <label
                      htmlFor="email"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm transition-all focus:border-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-100"
                      placeholder="example@mail.ru"
                    />
                  </div>
                  
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="comment"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Комментарий к заказу
                    </label>
                    <textarea
                      id="comment"
                      rows={4}
                      value={formData.comment}
                      onChange={(e) =>
                        setFormData({ ...formData, comment: e.target.value })
                      }
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm transition-all focus:border-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-100"
                      placeholder="Дополнительные пожелания, адрес доставки и т.д."
                    />
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                size="lg"
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <svg className="h-5 w-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Отправляем...
                  </>
                ) : selectedProduct ? (
                  `Оформить заказ на ${formatPrice(selectedProduct.price * selectedQuantity)}`
                ) : (
                  'Отправить заявку'
                )}
              </Button>

              <p className="text-center text-xs text-gray-500">
                Нажимая кнопку, вы соглашаетесь с{' '}
                <a href="#" className="text-yellow-600 hover:underline">политикой конфиденциальности</a>
              </p>
            </form>
          </div>

          {/* Sidebar */}
          <div className="space-y-6 lg:col-span-2">
            {/* Benefits */}
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-bold text-gray-900">
                Почему выбирают нас
              </h2>
              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-yellow-100 text-yellow-600">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Быстрый ответ</h3>
                    <p className="text-sm text-gray-500">Перезвоним в течение 15 минут</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-600">
                    <ShieldIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Гарантия 1 год</h3>
                    <p className="text-sm text-gray-500">На всю технику официальная гарантия</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                    <TruckIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Доставка по Москве</h3>
                    <p className="text-sm text-gray-500">Бесплатно от 5 000 ₽</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Консультация</h3>
                    <p className="text-sm text-gray-500">Поможем выбрать подходящий товар</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contacts */}
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-bold text-gray-900">
                Контакты
              </h2>
              <div className="space-y-4">
                <a href="tel:+79991234567" className="flex items-center gap-3 text-gray-700 transition-colors hover:text-yellow-600">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                    <PhoneIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">+7 (999) 123-45-67</div>
                    <div className="text-xs text-gray-400">Звоните бесплатно</div>
                  </div>
                </a>
                
                <a href="mailto:info@takesmart.ru" className="flex items-center gap-3 text-gray-700 transition-colors hover:text-yellow-600">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                    <MailIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">info@takesmart.ru</div>
                    <div className="text-xs text-gray-400">Напишите нам</div>
                  </div>
                </a>
                
                <div className="flex items-center gap-3 text-gray-700">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                    <ClockIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">Пн-Вс: 10:00 - 21:00</div>
                    <div className="text-xs text-gray-400">Без выходных</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Back to catalog */}
            <Link
              to="/catalog"
              className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-yellow-400 hover:text-yellow-600"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Вернуться в каталог
            </Link>
          </div>
        </div>
      </Container>
    </div>
  )
}
