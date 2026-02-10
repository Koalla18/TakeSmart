import { Link } from 'react-router-dom'
import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard } from '../components/ProductCard'
import { products, categories, brands, getFeaturedProducts } from '../data/products'
import { 
  ShieldIcon, 
  TruckIcon, 
  CardIcon, 
  PhoneIcon, 
  ArrowRightIcon, 
  ChevronRightIcon,
  SmartphoneIcon,
  LaptopIcon,
  HeadphonesIcon,
  WatchIcon,
  GamepadIcon,
  CameraIcon
} from '../components/ui/Icons'

const categoryIcons: Record<string, React.ReactNode> = {
  smartphones: <SmartphoneIcon className="h-8 w-8" />,
  laptops: <LaptopIcon className="h-8 w-8" />,
  headphones: <HeadphonesIcon className="h-8 w-8" />,
  watches: <WatchIcon className="h-8 w-8" />,
  gaming: <GamepadIcon className="h-8 w-8" />,
  accessories: <CameraIcon className="h-8 w-8" />,
}

const categoryImages: Record<string, string> = {
  smartphones: '📱',
  laptops: '💻',
  headphones: '🎧',
  watches: '⌚',
  gaming: '🎮',
  accessories: '🔌',
}

const benefits = [
  { 
    icon: <ShieldIcon className="h-8 w-8" />, 
    title: 'Гарантия до 3 лет', 
    description: 'Официальная гарантия на всю технику. Сервисное обслуживание по всей России.'
  },
  { 
    icon: <TruckIcon className="h-8 w-8" />, 
    title: 'Доставка за 2 часа', 
    description: 'Бесплатная доставка по Москве в день заказа. Доставка по России от 1 дня.'
  },
  { 
    icon: <CardIcon className="h-8 w-8" />, 
    title: 'Рассрочка 0%', 
    description: 'Рассрочка без первого взноса и переплат на срок до 24 месяцев.'
  },
  { 
    icon: <PhoneIcon className="h-8 w-8" />, 
    title: 'Поддержка 24/7', 
    description: 'Консультации по любым вопросам. Ответим в любое время суток.'
  },
]

const stats = [
  { value: '10+', label: 'лет на рынке' },
  { value: '50 000+', label: 'довольных клиентов' },
  { value: '1000+', label: 'товаров в каталоге' },
  { value: '99%', label: 'положительных отзывов' },
]

export function HomePage() {
  const featuredProducts = getFeaturedProducts()
  
  return (
    <div className="overflow-hidden">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        {/* Background pattern */}
        <div 
          className="absolute inset-0 opacity-5"
          style={{ 
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` 
          }}
        />
        
        <Container className="relative py-16 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            {/* Content */}
            <div className="text-center lg:text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-yellow-400/10 px-4 py-2 text-sm font-medium text-yellow-400">
                <span className="flex h-2 w-2 rounded-full bg-yellow-400" />
                Техника с выгодой до 30%
              </div>
              
              <h1 className="mb-6 text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
                Умная техника{' '}
                <span className="relative">
                  <span className="relative z-10 text-yellow-400">нового поколения</span>
                  <span className="absolute bottom-2 left-0 -z-0 h-3 w-full bg-yellow-400/20" />
                </span>
              </h1>
              
              <p className="mx-auto mb-8 max-w-lg text-lg text-gray-400 lg:mx-0">
                Смартфоны, ноутбуки и аксессуары от ведущих брендов. Официальная гарантия, Trade-in, рассрочка без переплат.
              </p>
              
              <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
                <Button to="/catalog" size="lg" className="shadow-lg shadow-yellow-400/25">
                  Смотреть каталог
                  <ArrowRightIcon className="ml-2 h-5 w-5" />
                </Button>
                <Button to="/cart" variant="outline" size="lg" className="border-white/20 text-white hover:bg-white/10">
                  Оставить заявку
                </Button>
              </div>
              
              {/* Quick stats */}
              <div className="mt-12 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4">
                {stats.map((stat, i) => (
                  <div key={i} className="text-center lg:text-left">
                    <div className="text-2xl font-bold text-white">{stat.value}</div>
                    <div className="text-sm text-gray-500">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Hero image / Featured product showcase */}
            <div className="relative hidden lg:block">
              <div className="relative aspect-square">
                {/* Decorative circles */}
                <div className="absolute -right-4 -top-4 h-72 w-72 rounded-full bg-yellow-400/10 blur-3xl" />
                <div className="absolute -bottom-8 -left-8 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
                
                {/* Product cards showcase */}
                <div className="relative z-10 flex h-full items-center justify-center">
                  <div className="grid grid-cols-2 gap-4">
                    {products.slice(0, 4).map((product, i) => (
                      <Link
                        key={product.id}
                        to={`/product/${product.id}`}
                        className={`group relative rounded-2xl bg-white/5 backdrop-blur-sm p-6 transition-all hover:bg-white/10 hover:scale-105 ${
                          i === 0 || i === 3 ? 'translate-y-6' : ''
                        }`}
                      >
                        <div className="text-5xl mb-3">{product.image}</div>
                        <div className="text-sm font-medium text-white truncate">{product.name}</div>
                        <div className="text-yellow-400 font-semibold mt-1">{product.price.toLocaleString()} ₽</div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
        
        {/* Wave separator */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 120L60 110C120 100 240 80 360 70C480 60 600 60 720 65C840 70 960 80 1080 85C1200 90 1320 90 1380 90L1440 90V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z" fill="white"/>
          </svg>
        </div>
      </section>

      {/* Categories Grid */}
      <Section>
        <Container>
          <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="mb-2 text-3xl font-bold text-gray-900">Каталог товаров</h2>
              <p className="text-gray-600">Выберите интересующую категорию</p>
            </div>
            <Link
              to="/catalog"
              className="group flex items-center gap-1 text-sm font-semibold text-yellow-600 hover:text-yellow-700"
            >
              Весь каталог
              <ChevronRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.slice(0, 6).map((category, i) => (
              <Link
                key={category.id}
                to={`/catalog?category=${category.id}`}
                className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 p-6 transition-all hover:shadow-xl ${
                  i === 0 ? 'sm:col-span-2 sm:row-span-2' : ''
                }`}
              >
                <div className="relative z-10">
                  <div className={`inline-flex rounded-xl bg-white p-3 shadow-sm transition-colors group-hover:bg-yellow-400 group-hover:text-gray-900 ${
                    i === 0 ? 'mb-6' : 'mb-4'
                  }`}>
                    {categoryIcons[category.id] || <SmartphoneIcon className="h-8 w-8" />}
                  </div>
                  <h3 className={`font-semibold text-gray-900 ${i === 0 ? 'text-2xl mb-2' : 'text-lg mb-1'}`}>
                    {category.name}
                  </h3>
                  <p className={`text-gray-500 ${i === 0 ? 'text-base' : 'text-sm'}`}>
                    {category.description}
                  </p>
                  <div className={`mt-4 flex items-center gap-1 font-medium text-yellow-600 transition-colors group-hover:text-yellow-700 ${
                    i === 0 ? 'text-base' : 'text-sm'
                  }`}>
                    Смотреть товары
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
                {/* Decorative emoji */}
                <div className={`absolute transition-all group-hover:scale-110 ${
                  i === 0 
                    ? 'bottom-4 right-4 text-8xl opacity-20' 
                    : '-bottom-2 -right-2 text-6xl opacity-10'
                }`}>
                  {categoryImages[category.id]}
                </div>
              </Link>
            ))}
          </div>
        </Container>
      </Section>

      {/* Featured Products */}
      <Section className="bg-gray-50">
        <Container>
          <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-yellow-600">
                Хиты продаж
              </div>
              <h2 className="text-3xl font-bold text-gray-900">Популярные товары</h2>
            </div>
            <Link
              to="/catalog"
              className="group flex items-center gap-1 text-sm font-semibold text-yellow-600 hover:text-yellow-700"
            >
              Все товары
              <ChevronRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          
          <div className="mt-10 text-center">
            <Button to="/catalog" variant="secondary" size="lg">
              Смотреть весь каталог
              <ArrowRightIcon className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </Container>
      </Section>

      {/* Benefits */}
      <Section>
        <Container>
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold text-gray-900">Почему выбирают нас</h2>
            <p className="mx-auto max-w-2xl text-gray-600">
              Работаем для вас с 2014 года. Гарантируем качество и лучший сервис.
            </p>
          </div>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((benefit, i) => (
              <div 
                key={i} 
                className="group rounded-2xl border border-gray-100 bg-white p-6 transition-all hover:border-yellow-200 hover:shadow-xl hover:shadow-yellow-100/50"
              >
                <div className="mb-4 inline-flex rounded-xl bg-yellow-50 p-3 text-yellow-600 transition-colors group-hover:bg-yellow-400 group-hover:text-gray-900">
                  {benefit.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{benefit.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{benefit.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Brands */}
      <Section className="bg-gray-900 text-white">
        <Container>
          <div className="mb-10 text-center">
            <h2 className="mb-3 text-3xl font-bold">Официальный партнер</h2>
            <p className="text-gray-400">Работаем напрямую с производителями</p>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-12">
            {brands.map((brand) => (
              <Link
                key={brand.id}
                to={`/catalog?brand=${brand.id}`}
                className="group flex flex-col items-center gap-2 transition-opacity hover:opacity-100"
              >
                <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-white/5 px-4 transition-colors group-hover:bg-white/10">
                  <span className="text-3xl">{brand.logo}</span>
                </div>
                <span className="text-sm text-gray-400 group-hover:text-yellow-400">{brand.name}</span>
              </Link>
            ))}
          </div>
        </Container>
      </Section>

      {/* New Arrivals */}
      <Section>
        <Container>
          <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-green-600">
                Новинки
              </div>
              <h2 className="text-3xl font-bold text-gray-900">Только что поступили</h2>
            </div>
            <Link
              to="/catalog?sort=new"
              className="group flex items-center gap-1 text-sm font-semibold text-yellow-600 hover:text-yellow-700"
            >
              Все новинки
              <ChevronRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.filter(p => p.badge === 'new').slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </Container>
      </Section>

      {/* CTA Section */}
      <Section className="bg-gradient-to-r from-yellow-400 via-yellow-400 to-amber-400">
        <Container>
          <div className="flex flex-col items-center gap-8 lg:flex-row lg:justify-between">
            <div className="text-center lg:text-left">
              <h2 className="mb-3 text-3xl font-bold text-gray-900">Не нашли нужный товар?</h2>
              <p className="max-w-lg text-lg text-gray-800">
                Оставьте заявку, и наши специалисты подберут оптимальный вариант. Ответим в течение 15 минут!
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Button to="/cart" variant="secondary" size="lg">
                Оставить заявку
                <ArrowRightIcon className="ml-2 h-5 w-5" />
              </Button>
              <a 
                href="tel:+79991234567" 
                className="flex items-center justify-center gap-2 rounded-xl bg-white/20 px-6 py-3 font-semibold text-gray-900 transition-colors hover:bg-white/30"
              >
                <PhoneIcon className="h-5 w-5" />
                +7 (999) 123-45-67
              </a>
            </div>
          </div>
        </Container>
      </Section>

      {/* Trust badges */}
      <Section className="bg-white py-12">
        <Container>
          <div className="flex flex-wrap items-center justify-center gap-8 text-center text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <ShieldIcon className="h-5 w-5 text-green-500" />
              Безопасная оплата
            </div>
            <div className="flex items-center gap-2">
              <TruckIcon className="h-5 w-5 text-blue-500" />
              Доставка по России
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🔄</span>
              Возврат 14 дней
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">💬</span>
              Онлайн-поддержка
            </div>
          </div>
        </Container>
      </Section>
    </div>
  )
}
