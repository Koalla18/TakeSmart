import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'

const tradeInDevices = [
  {
    name: 'iPhone 15 Pro Max',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-15-pro-max-naturaltitanium-select?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 65 000 ₽',
    newPrice: 'от 94 000 ₽',
    category: 'iPhone'
  },
  {
    name: 'iPhone 14 Pro Max',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-14-pro-max-deeppurple-select?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 50 000 ₽',
    newPrice: 'от 94 000 ₽',
    category: 'iPhone'
  },
  {
    name: 'iPhone 13 Pro',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-13-pro-max-gold-select?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 35 000 ₽',
    newPrice: 'от 94 000 ₽',
    category: 'iPhone'
  },
  {
    name: 'iPhone 15',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-15-finish-select-202309-6-1inch-black?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 40 000 ₽',
    newPrice: 'от 79 990 ₽',
    category: 'iPhone'
  },
  {
    name: 'MacBook Pro 14" M3',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/mbp14-m3-max-pro-spaceblack-select-202310?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 80 000 ₽',
    newPrice: 'от 199 990 ₽',
    category: 'Mac'
  },
  {
    name: 'MacBook Air M2',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macbook-air-midnight-select-20220606?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 45 000 ₽',
    newPrice: 'от 119 990 ₽',
    category: 'Mac'
  },
  {
    name: 'iPad Pro M4',
    image: 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/ipad-pro-model-select-gallery-1-202405?wid=400&hei=400&fmt=png-alpha',
    tradeValue: 'до 40 000 ₽',
    newPrice: 'от 109 990 ₽',
    category: 'iPad'
  },
  {
    name: 'Apple Watch Ultra 2',
    image: '/watch-ultra-2.png',
    tradeValue: 'до 35 000 ₽',
    newPrice: 'от 79 990 ₽',
    category: 'Watch'
  }
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

const categories = ['Все', 'iPhone', 'Mac', 'iPad', 'Watch']

export function TradeInPage() {
  const [selectedCategory, setSelectedCategory] = useState('Все')
  
  const filteredDevices = selectedCategory === 'Все' 
    ? tradeInDevices 
    : tradeInDevices.filter(d => d.category === selectedCategory)

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
                <Link 
                  to="/catalog"
                  className="inline-flex items-center justify-center rounded-full bg-blue-500 hover:bg-blue-600 px-8 py-4 text-white font-semibold transition-all hover:shadow-lg hover:shadow-blue-500/30 text-lg"
                >
                  Оценить устройство
                </Link>
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

      {/* Trade-in Value Calculator */}
      <Section className="py-24 bg-white">
        <Container>
          <div className="text-center mb-12">
            <span className="inline-block rounded-full bg-green-100 px-5 py-2 text-sm font-semibold text-green-700 mb-4">
              Оценка стоимости
            </span>
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
              Сколько стоит ваше устройство?
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Выберите вашу модель и узнайте примерную стоимость Trade-in
            </p>
          </div>

          {/* Category Filter */}
          <div className="flex justify-center gap-2 mb-10 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  selectedCategory === cat
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Device Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredDevices.map((device, i) => (
              <div 
                key={i}
                className="group rounded-3xl bg-gray-50 hover:bg-white border border-transparent hover:border-gray-200 p-6 transition-all duration-500 hover:shadow-xl"
              >
                <div className="flex justify-center mb-6">
                  <img 
                    src={device.image}
                    alt={device.name}
                    className="w-32 h-32 object-contain group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <h3 className="font-semibold text-gray-900 mb-3 text-center">{device.name}</h3>
                <div className="text-center space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-bold text-green-700">{device.tradeValue}</span>
                  </div>
                  <p className="text-sm text-gray-500">
                    при покупке нового {device.newPrice}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <p className="text-sm text-gray-400 mb-6">
              * Стоимость зависит от состояния устройства. Точную оценку можно получить в магазине.
            </p>
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
              <Button 
                to="/catalog" 
                size="lg"
                className="bg-white text-blue-700 hover:bg-gray-100 font-semibold text-lg px-10"
              >
                Перейти в каталог
              </Button>
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
                <span className="text-sm">ТЦ Багратионовский, А-27</span>
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
