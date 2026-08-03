import { useEffect, useMemo, useState } from 'react'
import { Container, Section } from '../components/ui/Layout'
import { API_BASE_URL } from '../lib/config'

/* ── Trade-in device catalog (frontend-only) ─────────────────────────── */

interface DeviceOption {
  label: string
  models: { name: string; tradeValue: [number, number] }[]
}

const FALLBACK_DEVICE_CATALOG: Record<string, DeviceOption> = {
  iphone: {
    label: 'iPhone',
    models: [
      { name: 'iPhone 16 Pro Max', tradeValue: [55000, 85000] },
      { name: 'iPhone 16 Pro', tradeValue: [50000, 75000] },
      { name: 'iPhone 16', tradeValue: [40000, 60000] },
      { name: 'iPhone 15 Pro Max', tradeValue: [45000, 70000] },
      { name: 'iPhone 15 Pro', tradeValue: [40000, 60000] },
      { name: 'iPhone 15', tradeValue: [30000, 48000] },
      { name: 'iPhone 14 Pro Max', tradeValue: [35000, 55000] },
      { name: 'iPhone 14 Pro', tradeValue: [30000, 50000] },
      { name: 'iPhone 14', tradeValue: [22000, 38000] },
      { name: 'iPhone 13 Pro Max', tradeValue: [28000, 45000] },
      { name: 'iPhone 13 Pro', tradeValue: [25000, 40000] },
      { name: 'iPhone 13', tradeValue: [18000, 30000] },
      { name: 'iPhone 12 Pro Max', tradeValue: [20000, 32000] },
      { name: 'iPhone 12 Pro', tradeValue: [17000, 28000] },
      { name: 'iPhone 12', tradeValue: [13000, 22000] },
      { name: 'iPhone 11 Pro Max', tradeValue: [14000, 24000] },
      { name: 'iPhone 11 Pro', tradeValue: [12000, 20000] },
      { name: 'iPhone 11', tradeValue: [8000, 16000] },
      { name: 'iPhone SE (2/3)', tradeValue: [5000, 12000] },
    ],
  },
  samsung: {
    label: 'Samsung',
    models: [
      { name: 'Galaxy S25 Ultra', tradeValue: [50000, 78000] },
      { name: 'Galaxy S25+', tradeValue: [38000, 58000] },
      { name: 'Galaxy S25', tradeValue: [30000, 48000] },
      { name: 'Galaxy S24 Ultra', tradeValue: [42000, 65000] },
      { name: 'Galaxy S24+', tradeValue: [30000, 48000] },
      { name: 'Galaxy S24', tradeValue: [22000, 38000] },
      { name: 'Galaxy S23 Ultra', tradeValue: [32000, 52000] },
      { name: 'Galaxy S23', tradeValue: [18000, 30000] },
      { name: 'Galaxy Z Fold 5', tradeValue: [45000, 70000] },
      { name: 'Galaxy Z Flip 5', tradeValue: [22000, 38000] },
    ],
  },
  macbook: {
    label: 'MacBook',
    models: [
      { name: 'MacBook Pro 16" (M3/M4)', tradeValue: [80000, 140000] },
      { name: 'MacBook Pro 14" (M3/M4)', tradeValue: [60000, 110000] },
      { name: 'MacBook Air 15" (M3)', tradeValue: [45000, 75000] },
      { name: 'MacBook Air 13" (M3)', tradeValue: [35000, 60000] },
      { name: 'MacBook Pro 14" (M2)', tradeValue: [50000, 85000] },
      { name: 'MacBook Air (M2)', tradeValue: [28000, 48000] },
      { name: 'MacBook Air (M1)', tradeValue: [18000, 35000] },
    ],
  },
  ipad: {
    label: 'iPad',
    models: [
      { name: 'iPad Pro 13" (M4)', tradeValue: [50000, 80000] },
      { name: 'iPad Pro 11" (M4)', tradeValue: [38000, 62000] },
      { name: 'iPad Air (M2)', tradeValue: [25000, 42000] },
      { name: 'iPad mini 7', tradeValue: [22000, 35000] },
      { name: 'iPad (10-го поколения)', tradeValue: [15000, 25000] },
      { name: 'iPad Pro (M1/M2)', tradeValue: [25000, 50000] },
      { name: 'iPad Air (M1)', tradeValue: [18000, 30000] },
    ],
  },
  xiaomi: {
    label: 'Xiaomi',
    models: [
      { name: 'Xiaomi 14 Ultra', tradeValue: [30000, 50000] },
      { name: 'Xiaomi 14 Pro', tradeValue: [25000, 42000] },
      { name: 'Xiaomi 14', tradeValue: [18000, 32000] },
      { name: 'Xiaomi 13 Pro', tradeValue: [18000, 30000] },
      { name: 'Xiaomi 13', tradeValue: [12000, 22000] },
      { name: 'Redmi Note 13 Pro+', tradeValue: [8000, 16000] },
      { name: 'POCO F6 Pro', tradeValue: [12000, 22000] },
    ],
  },
  watch: {
    label: 'Часы',
    models: [
      { name: 'Apple Watch Ultra 2', tradeValue: [30000, 50000] },
      { name: 'Apple Watch Series 9', tradeValue: [15000, 28000] },
      { name: 'Apple Watch SE (2023)', tradeValue: [8000, 16000] },
      { name: 'Samsung Galaxy Watch 6', tradeValue: [8000, 16000] },
    ],
  },
  other: {
    label: 'Другое',
    models: [
      { name: 'AirPods Pro 2', tradeValue: [5000, 12000] },
      { name: 'AirPods Max', tradeValue: [15000, 30000] },
      { name: 'Sony PlayStation 5', tradeValue: [18000, 32000] },
      { name: 'Nintendo Switch OLED', tradeValue: [10000, 18000] },
    ],
  },
}

interface TradeInOffer {
  id: string
  device_type: string
  device_label: string
  name: string
  min_price: number
  max_price: number
  sort_order: number
  is_active: boolean
}

const conditionMultipliers: { id: string; label: string; emoji: string; desc: string; mult: number }[] = [
  { id: 'perfect', label: 'Идеальное', emoji: '✨', desc: 'Как новое, без следов использования', mult: 1.0 },
  { id: 'good', label: 'Хорошее', emoji: '👍', desc: 'Мелкие следы использования', mult: 0.85 },
  { id: 'fair', label: 'Среднее', emoji: '👌', desc: 'Заметные потёртости, мелкие царапины', mult: 0.65 },
  { id: 'poor', label: 'С дефектами', emoji: '🔧', desc: 'Серьёзные повреждения, трещины', mult: 0.4 },
]

const steps = [
  {
    number: '01',
    title: 'Оценка устройства',
    description: 'Принесите ваше устройство в магазин или отправьте фото онлайн. Мы оценим его состояние за 5 минут.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    )
  },
  {
    number: '02',
    title: 'Выбор нового',
    description: 'Подберите любой товар из нашего каталога. Стоимость вашего устройства будет вычтена из цены.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    )
  },
  {
    number: '03',
    title: 'Обмен и скидка',
    description: 'Передайте старое устройство и получите новое со скидкой. Всё в одном визите — быстро и удобно.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    )
  },
  {
    number: '04',
    title: 'Все данные в безопасности',
    description: 'Мы полностью стираем все данные с принятого устройства. Конфиденциальность гарантирована.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    )
  }
]

export function TradeInPage() {
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null)
  const [offers, setOffers] = useState<TradeInOffer[]>([])
  const [hasRemoteCatalog, setHasRemoteCatalog] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/api/trade-in`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data: TradeInOffer[]) => {
        if (!cancelled) {
          setOffers(data)
          setHasRemoteCatalog(true)
        }
      })
      .catch(() => {
        // Пока миграция не применена либо сеть недоступна, калькулятор остаётся рабочим.
        if (!cancelled) setOffers([])
      })
    return () => { cancelled = true }
  }, [])

  const deviceCatalog = useMemo<Record<string, DeviceOption>>(() => {
    if (!hasRemoteCatalog) return FALLBACK_DEVICE_CATALOG
    return offers.reduce<Record<string, DeviceOption>>((catalog, offer) => {
      const entry = catalog[offer.device_type] ?? {
        label: offer.device_label,
        models: [],
      }
      entry.models.push({
        name: offer.name,
        tradeValue: [Number(offer.min_price), Number(offer.max_price)],
      })
      catalog[offer.device_type] = entry
      return catalog
    }, {})
  }, [hasRemoteCatalog, offers])

  const device = selectedType ? deviceCatalog[selectedType] : null
  const model = device?.models.find(m => m.name === selectedModel)
  const condition = conditionMultipliers.find(c => c.id === selectedCondition)

  const estimatedMin = model && condition ? Math.round(model.tradeValue[0] * condition.mult / 1000) * 1000 : 0
  const estimatedMax = model && condition ? Math.round(model.tradeValue[1] * condition.mult / 1000) * 1000 : 0

  const telegramMessage = model && condition
    ? `Здравствуйте! Хочу оценить устройство по Trade-in:\n\n📱 ${model.name}\n📋 Состояние: ${condition.label}\n💰 Предв. оценка: ${estimatedMin.toLocaleString('ru-RU')} – ${estimatedMax.toLocaleString('ru-RU')} ₽\n\nЖду обратной связи!`
    : 'Здравствуйте! Хочу узнать стоимость моего устройства по Trade-in.'
  const telegramUrl = `https://t.me/takesmart_manager?text=${encodeURIComponent(telegramMessage)}`

  const resetCalculator = () => {
    setSelectedType(null)
    setSelectedModel(null)
    setSelectedCondition(null)
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — Apple-style full-bleed */}
      <section className="relative overflow-hidden bg-black">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900/40 via-black to-purple-900/30" />
          {/* Abstract gradient orbs */}
          <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full bg-blue-500/20 blur-[120px]" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-purple-500/20 blur-[100px]" />
        </div>
        
        <Container>
          <div className="relative grid lg:grid-cols-2 gap-12 items-center py-24 lg:py-32 min-h-[85vh]">
            {/* Left content */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 px-5 py-2.5 text-sm font-medium text-white mb-8">
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
                Trade-in программа
              </div>
              
              <h1 className="text-5xl lg:text-7xl font-bold text-white mb-6 leading-[1.05] tracking-tight">
                Обменяй старое
                <span className="block bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  на новое
                </span>
              </h1>
              
              <p className="text-xl text-gray-400 mb-10 max-w-lg leading-relaxed">
                Получите скидку до 50% на новое устройство, сдав своё старое. 
                Просто, быстро, выгодно.
              </p>

              <div className="flex flex-wrap gap-4 mb-12">
                <a 
                  href="#calculator"
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-blue-500 hover:bg-blue-600 px-8 py-4 text-white font-semibold transition-all hover:shadow-lg hover:shadow-blue-500/30 text-lg"
                >
                  Оценить устройство
                </a>
                <a 
                  href="https://t.me/takesmart_manager"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/5 backdrop-blur px-8 py-4 text-white font-semibold transition-all hover:bg-white/15 text-lg"
                >
                  Написать менеджеру
                </a>
              </div>

              {/* Quick stats */}
              <div className="flex gap-10">
                <div>
                  <div className="text-3xl font-bold text-white">50%</div>
                  <div className="text-sm text-gray-500 mt-1">максимальная скидка</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-white">5 мин</div>
                  <div className="text-sm text-gray-500 mt-1">на оценку устройства</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-white">1 000+</div>
                  <div className="text-sm text-gray-500 mt-1">обменов совершено</div>
                </div>
              </div>
            </div>
            
            {/* Right — floating devices */}
            <div className="hidden lg:flex items-center justify-center relative">
              <div className="relative w-[420px] h-[400px]">
                {/* Old device going out */}
                <div className="absolute left-0 bottom-8 opacity-50 -rotate-6">
                  <img 
                    src="/iphone-15-blue.png?v=2"
                    alt="iPhone 15 — Ваше устройство"
                    className="w-36 h-auto object-contain drop-shadow-lg"
                  />
                  <div className="mt-3 text-center text-sm text-gray-500">Ваш iPhone</div>
                </div>
                
                {/* Arrow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/40">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                </div>
                
                {/* New device coming in */}
                <div className="absolute right-0 top-0 rotate-3">
                  <img 
                    src="/iphone-17-pro.png"
                    alt="iPhone 17 Pro — Новый"
                    className="w-52 h-auto object-contain drop-shadow-2xl"
                  />
                  <div className="mt-3 text-center text-sm text-white font-medium">iPhone 17 Pro</div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* How it works */}
      <Section className="py-24 bg-gray-50">
        <Container>
          <div className="text-center mb-16">
            <span className="inline-block rounded-full bg-blue-100 px-5 py-2 text-sm font-semibold text-blue-700 mb-4">
              Как это работает
            </span>
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
              Четыре простых шага
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              От оценки до нового устройства — весь процесс занимает не более 15 минут
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, i) => (
              <div 
                key={i}
                className="group relative rounded-3xl bg-white p-8 border border-gray-100 hover:border-blue-200 hover:shadow-xl transition-all duration-500"
              >
                {/* Step number */}
                <div className="text-6xl font-bold text-gray-100 mb-4 group-hover:text-blue-100 transition-colors">
                  {step.number}
                </div>
                
                {/* Icon */}
                <div className="mb-4 inline-flex rounded-2xl bg-gray-900 p-3.5 text-white group-hover:bg-blue-500 transition-colors">
                  {step.icon}
                </div>
                
                <h3 className="text-xl font-bold text-gray-900 mb-3">{step.title}</h3>
                <p className="text-gray-500 leading-relaxed">{step.description}</p>
                
                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                    <div className="w-6 h-[2px] bg-gray-200" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Trade-in Calculator */}
      <Section id="calculator" className="py-24 bg-white">
        <Container>
          <div className="text-center mb-12">
            <span className="inline-block rounded-full bg-green-100 px-5 py-2 text-sm font-semibold text-green-700 mb-4">
              Оценка стоимости
            </span>
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
              Сколько стоит ваше устройство?
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Выберите устройство и узнайте предварительную стоимость за 30 секунд
            </p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="rounded-3xl bg-gray-50 border border-gray-200 overflow-hidden">
              {/* Progress bar */}
              <div className="flex border-b border-gray-200 bg-white">
                {['Тип', 'Модель', 'Состояние'].map((step, i) => {
                  const stepNum = i + 1
                  const isActive = (stepNum === 1 && !selectedType) || 
                                   (stepNum === 2 && selectedType && !selectedModel) ||
                                   (stepNum === 3 && selectedModel && !selectedCondition)
                  const isDone = (stepNum === 1 && selectedType) ||
                                 (stepNum === 2 && selectedModel) ||
                                 (stepNum === 3 && selectedCondition)
                  return (
                    <div 
                      key={step}
                      className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors ${
                        isActive ? 'text-blue-600 bg-blue-50' : isDone ? 'text-green-600 bg-green-50' : 'text-gray-400'
                      }`}
                    >
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
                      }`}>
                        {isDone ? '✓' : stepNum}
                      </span>
                      <span className="hidden sm:inline">{step}</span>
                    </div>
                  )
                })}
              </div>

              <div className="p-6 sm:p-10">
                {/* Step 1: device type */}
                {!selectedType && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-6">Что хотите сдать?</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {Object.entries(deviceCatalog).map(([key, cat]) => (
                        <button
                          key={key}
                          onClick={() => { setSelectedType(key); setSelectedModel(null); setSelectedCondition(null) }}
                          className="group rounded-2xl border-2 border-gray-200 bg-white p-5 text-center transition-all hover:border-blue-400 hover:shadow-md active:scale-[0.97]"
                        >
                          <div className="text-3xl mb-2">
                            {key === 'iphone' ? '📱' : key === 'samsung' ? '📲' : key === 'macbook' ? '💻' : key === 'ipad' ? '📟' : key === 'xiaomi' ? '📱' : key === 'watch' ? '⌚' : '🎮'}
                          </div>
                          <div className="font-semibold text-gray-900 group-hover:text-blue-600">{cat.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 2: model */}
                {selectedType && !selectedModel && device && (
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold text-gray-900">Выберите модель</h3>
                      <button onClick={() => setSelectedType(null)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                        ← Назад
                      </button>
                    </div>
                    <div className="grid gap-2">
                      {device.models.map((m) => (
                        <button
                          key={m.name}
                          onClick={() => { setSelectedModel(m.name); setSelectedCondition(null) }}
                          className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4 text-left transition-all hover:border-blue-400 hover:shadow-sm active:scale-[0.99]"
                        >
                          <span className="font-medium text-gray-900">{m.name}</span>
                          <span className="text-sm text-gray-400">до {m.tradeValue[1].toLocaleString('ru-RU')} ₽</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 3: condition */}
                {selectedModel && !selectedCondition && (
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold text-gray-900">Состояние устройства</h3>
                      <button onClick={() => setSelectedModel(null)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                        ← Назад
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {conditionMultipliers.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setSelectedCondition(c.id)}
                          className="rounded-2xl border-2 border-gray-200 bg-white p-5 text-left transition-all hover:border-blue-400 hover:shadow-md active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-2xl">{c.emoji}</span>
                            <span className="font-semibold text-gray-900">{c.label}</span>
                          </div>
                          <p className="text-sm text-gray-500">{c.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Result */}
                {selectedCondition && model && condition && (
                  <div className="text-center">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-lg font-semibold text-gray-900">Результат оценки</h3>
                      <button onClick={resetCalculator} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                        Рассчитать заново
                      </button>
                    </div>
                    
                    <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white mb-6">
                      <div className="text-sm text-blue-200 mb-1">Предварительная оценка</div>
                      <div className="text-lg text-blue-100 mb-3">{model.name} • {condition.label}</div>
                      <div className="text-5xl font-bold mb-1">
                        {estimatedMin.toLocaleString('ru-RU')} – {estimatedMax.toLocaleString('ru-RU')} ₽
                      </div>
                      <div className="text-sm text-blue-200 mt-3">
                        Точная стоимость определяется после осмотра
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <a
                        href={telegramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-500 hover:bg-blue-600 px-8 py-4 text-white font-semibold transition-all hover:shadow-lg hover:shadow-blue-500/30 text-lg"
                      >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                        </svg>
                        Отправить заявку
                      </a>
                      <a
                        href="tel:+79998021022"
                        className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-gray-300 px-8 py-4 font-semibold text-gray-700 transition-all hover:border-gray-400 hover:bg-gray-50"
                      >
                        📞 Позвонить
                      </a>
                    </div>

                    <p className="text-xs text-gray-400 mt-6">
                      * Оценка является предварительной и может измениться после осмотра устройства специалистом
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* Benefits */}
      <Section className="py-24 bg-gray-50">
        <Container>
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
              Почему Trade-in в <span className="text-yellow-500">TakeSmart</span>?
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Мы делаем обмен максимально выгодным и удобным
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: '💰',
                title: 'Лучшая цена',
                description: 'Мы предлагаем максимальную оценку вашего устройства — до 50% от стоимости нового.'
              },
              {
                icon: '⚡',
                title: 'Моментальный обмен',
                description: 'Весь процесс занимает 15 минут. Вы уходите с новым устройством в тот же день.'
              },
              {
                icon: '🔒',
                title: 'Безопасность данных',
                description: 'Мы полностью стираем все данные с принятого устройства при вас.'
              },
              {
                icon: '📱',
                title: 'Любые устройства',
                description: 'Принимаем iPhone, Samsung, Xiaomi, MacBook, iPad и другие устройства.'
              },
              {
                icon: '✅',
                title: 'Даже с дефектами',
                description: 'Принимаем устройства с мелкими дефектами — царапины, потёртости, замененный экран.'
              },
              {
                icon: '🎁',
                title: 'Дополнительная скидка',
                description: 'При Trade-in вы получаете дополнительную скидку 5% на аксессуары.'
              }
            ].map((benefit, i) => (
              <div 
                key={i}
                className="rounded-3xl bg-white border border-gray-200 p-8 hover:shadow-lg hover:border-gray-300 transition-all"
              >
                <div className="text-4xl mb-4">{benefit.icon}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{benefit.title}</h3>
                <p className="text-gray-500 leading-relaxed">{benefit.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <Section className="py-24 bg-white">
        <Container>
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Частые вопросы</h2>
            </div>

            <div className="space-y-4">
              {[
                {
                  q: 'Какие устройства вы принимаете по Trade-in?',
                  a: 'Мы принимаем все модели iPhone (от iPhone 8 и новее), Samsung Galaxy (от S20), Xiaomi, MacBook, iPad, Apple Watch и другие устройства. Полный список можно уточнить у менеджера.'
                },
                {
                  q: 'Как определяется стоимость устройства?',
                  a: 'Оценка зависит от модели, состояния экрана и корпуса, работоспособности всех функций, комплектации. Финальная цена определяется нашим специалистом после осмотра.'
                },
                {
                  q: 'Можно ли сделать Trade-in онлайн?',
                  a: 'Да! Отправьте фото вашего устройства нашему менеджеру в WhatsApp, и мы сделаем предварительную оценку. Финальная стоимость подтверждается при осмотре в магазине.'
                },
                {
                  q: 'Принимаете ли вы устройства с разбитым экраном?',
                  a: 'Да, мы принимаем устройства с повреждениями, но стоимость Trade-in будет ниже. Точную оценку можно получить у менеджера.'
                },
                {
                  q: 'Нужно ли приносить коробку и зарядку?',
                  a: 'Не обязательно, но наличие оригинальной комплектации может увеличить стоимость оценки вашего устройства.'
                }
              ].map((item, i) => (
                <details 
                  key={i}
                  className="group rounded-2xl border border-gray-200 bg-white overflow-hidden"
                >
                  <summary className="flex items-center justify-between cursor-pointer p-6 font-semibold text-gray-900 hover:bg-gray-50 transition-colors">
                    {item.q}
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-4 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-6 pb-6 text-gray-600 leading-relaxed">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <Section className="py-24 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full bg-blue-400/20 blur-[100px]" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-indigo-400/20 blur-[100px]" />
        </div>
        <Container>
          <div className="relative text-center max-w-3xl mx-auto">
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              Готовы обменять?
            </h2>
            <p className="text-xl text-blue-200 mb-10">
              Приходите в наш магазин или свяжитесь с нами, чтобы узнать стоимость вашего устройства
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a 
                href="#calculator"
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="inline-flex items-center justify-center rounded-xl bg-white px-10 py-4 text-blue-700 font-semibold text-lg hover:bg-gray-100 transition-all"
              >
                Оценить устройство
              </a>
              <a 
                href="https://t.me/takesmart_manager"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border-2 border-white/30 bg-white/10 backdrop-blur px-10 py-3 text-white font-semibold text-lg hover:bg-white/20 transition-all"
              >
                Написать в Telegram
              </a>
            </div>
            
            <div className="mt-12 flex justify-center gap-8 text-white/80">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm">ТЦ Багратионовский, А60</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">Пн-Вс 10:00 – 20:00</span>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </div>
  )
}
