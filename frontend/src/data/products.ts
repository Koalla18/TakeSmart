export interface Product {
  id: string
  slug: string
  name: string
  brand: string
  category: string
  categorySlug: string
  price: number
  oldPrice?: number
  badge?: 'hit' | 'new' | 'sale'
  inStock: boolean
  stockQuantity?: number
  image: string
  description: string
  specs: { label: string; value: string }[]
}

export const products: Product[] = [
  {
    id: '1',
    slug: 'iphone-15-pro-max-256gb-natural',
    name: 'iPhone 15 Pro Max 256 ГБ',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 124990,
    oldPrice: 139990,
    badge: 'hit',
    inStock: true,
    image: '/products/phone/apple/iphone-15-pro-natural-titanium.png',
    description: 'Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.',
    specs: [
      { label: 'Дисплей', value: '6.7" Super Retina XDR' },
      { label: 'Процессор', value: 'Apple A17 Pro' },
      { label: 'Память', value: '256 ГБ' },
      { label: 'Камера', value: '48 Мп + 12 Мп + 12 Мп' },
    ],
  },
  {
    id: '2',
    slug: 'iphone-15-pro-128gb',
    name: 'iPhone 15 Pro 128 ГБ',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 109990,
    badge: 'new',
    inStock: true,
    image: '/products/phone/apple/Iphone-15-pro-Black-Titanium.png',
    description: 'Компактный флагман с титановым дизайном и Action Button.',
    specs: [
      { label: 'Дисплей', value: '6.1" Super Retina XDR' },
      { label: 'Процессор', value: 'Apple A17 Pro' },
      { label: 'Память', value: '128 ГБ' },
      { label: 'Камера', value: '48 Мп + 12 Мп + 12 Мп' },
    ],
  },
  {
    id: '3',
    slug: 'iphone-14-128gb',
    name: 'iPhone 14 128 ГБ',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 69990,
    oldPrice: 79990,
    badge: 'sale',
    inStock: true,
    image: '/products/phone/apple/iphone-14.jpg',
    description: 'Отличный выбор для тех, кто хочет получить премиальное качество Apple по доступной цене.',
    specs: [
      { label: 'Дисплей', value: '6.1" Super Retina XDR' },
      { label: 'Процессор', value: 'Apple A15 Bionic' },
      { label: 'Память', value: '128 ГБ' },
    ],
  },
  {
    id: '4',
    slug: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 154990,
    badge: 'new',
    inStock: true,
    image: '/products/phone/apple/iphone-17-pro.png',
    description: 'Новейший iPhone 17 Pro с улучшенным чипом и камерой нового поколения.',
    specs: [
      { label: 'Дисплей', value: '6.3" Super Retina XDR' },
      { label: 'Процессор', value: 'Apple A19 Pro' },
      { label: 'Память', value: '256 ГБ' },
      { label: 'Камера', value: '48 Мп + 48 Мп + 12 Мп' },
    ],
  },
  {
    id: '5',
    slug: 'samsung-galaxy-s25-ultra',
    name: 'Samsung Galaxy S25 Ultra',
    brand: 'Samsung',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 114990,
    inStock: true,
    image: '/products/phone/samsung/samsung-galaxy-s25.png',
    description: 'Флагман Samsung с Galaxy AI, S Pen и революционной камерой 200 Мп.',
    specs: [
      { label: 'Дисплей', value: '6.9" Dynamic AMOLED 2X' },
      { label: 'Процессор', value: 'Snapdragon 8 Elite' },
      { label: 'Память', value: '256 ГБ' },
      { label: 'Камера', value: '200 Мп' },
    ],
  },
  {
    id: '6',
    slug: 'xiaomi-15',
    name: 'Xiaomi 15',
    brand: 'Xiaomi',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 79990,
    badge: 'new',
    inStock: true,
    image: '/products/phone/xiaomi/Xiaomi-15.png',
    description: 'Флагман Xiaomi с камерой Leica и чипом Snapdragon 8 Elite.',
    specs: [
      { label: 'Дисплей', value: '6.36" AMOLED' },
      { label: 'Процессор', value: 'Snapdragon 8 Elite' },
      { label: 'Память', value: '256 ГБ' },
      { label: 'Камера', value: 'Leica 50 Мп' },
    ],
  },
  {
    id: '7',
    slug: 'macbook-pro-14-m3-pro',
    name: 'MacBook Pro 14" M3 Pro',
    brand: 'Apple',
    category: 'Ноутбуки',
    categorySlug: 'laptops',
    price: 249990,
    badge: 'new',
    inStock: true,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mbp14-spacegray-select-202310?wid=800&hei=800&fmt=jpeg&qlt=90',
    description: 'Профессиональный ноутбук с чипом M3 Pro и дисплеем Liquid Retina XDR.',
    specs: [
      { label: 'Дисплей', value: '14.2" Liquid Retina XDR' },
      { label: 'Процессор', value: 'Apple M3 Pro' },
      { label: 'Память', value: '18 ГБ / 512 ГБ SSD' },
      { label: 'Автономность', value: 'до 17 часов' },
    ],
  },
  {
    id: '8',
    slug: 'macbook-air-15-m3',
    name: 'MacBook Air 15" M3',
    brand: 'Apple',
    category: 'Ноутбуки',
    categorySlug: 'laptops',
    price: 179990,
    inStock: true,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mba15-midnight-select-202306?wid=800&hei=800&fmt=jpeg&qlt=90',
    description: 'Самый тонкий 15-дюймовый ноутбук в мире с чипом M3.',
    specs: [
      { label: 'Дисплей', value: '15.3" Liquid Retina' },
      { label: 'Процессор', value: 'Apple M3' },
      { label: 'Память', value: '8 ГБ / 256 ГБ SSD' },
    ],
  },
  {
    id: '9',
    slug: 'ipad-pro-12-m2',
    name: 'iPad Pro 12.9" M2',
    brand: 'Apple',
    category: 'Планшеты',
    categorySlug: 'tablets',
    price: 139990,
    inStock: true,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/ipad-pro-13-select-wifi-spacegray-202210?wid=800&hei=800&fmt=jpeg&qlt=90',
    description: 'Самый мощный iPad с чипом M2 и дисплеем Liquid Retina XDR.',
    specs: [
      { label: 'Дисплей', value: '12.9" Liquid Retina XDR' },
      { label: 'Процессор', value: 'Apple M2' },
      { label: 'Память', value: '256 ГБ' },
    ],
  },
  {
    id: '10',
    slug: 'airpods-pro-2',
    name: 'AirPods Pro 2',
    brand: 'Apple',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 24990,
    oldPrice: 29990,
    badge: 'sale',
    inStock: true,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MQD83?wid=800&hei=800&fmt=jpeg&qlt=90',
    description: 'Беспроводные наушники с активным шумоподавлением и пространственным аудио.',
    specs: [
      { label: 'Тип', value: 'Внутриканальные TWS' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: '6 ч (30 ч с кейсом)' },
    ],
  },
  {
    id: '11',
    slug: 'airpods-max',
    name: 'AirPods Max',
    brand: 'Apple',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 59990,
    inStock: true,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-max-hero-select-202011_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90',
    description: 'Премиальные накладные наушники с невероятным звуком.',
    specs: [
      { label: 'Тип', value: 'Накладные' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: 'до 20 часов' },
    ],
  },
  {
    id: '12',
    slug: 'sony-wh-1000xm5',
    name: 'Sony WH-1000XM5',
    brand: 'Sony',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 39990,
    oldPrice: 44990,
    badge: 'hit',
    inStock: true,
    image: '/products/headphones/sony/sony-wh-1000xm5-black.png',
    description: 'Лучшие наушники с шумоподавлением от Sony.',
    specs: [
      { label: 'Тип', value: 'Накладные' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: 'до 30 часов' },
    ],
  },
  {
    id: '13',
    slug: 'samsung-galaxy-buds3-pro',
    name: 'Samsung Galaxy Buds3 Pro',
    brand: 'Samsung',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 21990,
    badge: 'new',
    inStock: true,
    image: '/products/headphones/samsung/Samsung-Galaxy-Buds3.png',
    description: 'Премиальные TWS-наушники Samsung с Galaxy AI.',
    specs: [
      { label: 'Тип', value: 'Внутриканальные TWS' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: '7 ч' },
    ],
  },
  {
    id: '14',
    slug: 'apple-watch-ultra-3',
    name: 'Apple Watch Ultra 3',
    brand: 'Apple',
    category: 'Часы',
    categorySlug: 'watches',
    price: 84990,
    badge: 'new',
    inStock: true,
    image: '/products/smart bands/apple-watch-3-ultra.png',
    description: 'Самые защищённые и функциональные Apple Watch третьего поколения Ultra.',
    specs: [
      { label: 'Дисплей', value: '49 мм OLED' },
      { label: 'Защита', value: 'WR100, IP6X' },
      { label: 'GPS', value: 'Двухдиапазонный' },
    ],
  },
  {
    id: '15',
    slug: 'apple-watch-series-11',
    name: 'Apple Watch Series 11',
    brand: 'Apple',
    category: 'Часы',
    categorySlug: 'watches',
    price: 49990,
    inStock: true,
    image: '/products/smart bands/Apple-Watch-Series-11.png',
    description: 'Новейшие умные часы Apple с чипом нового поколения.',
    specs: [
      { label: 'Дисплей', value: '45 мм OLED' },
      { label: 'Чип', value: 'Apple S11' },
      { label: 'Защита', value: 'WR50' },
    ],
  },
  {
    id: '16',
    slug: 'playstation-5-slim',
    name: 'PlayStation 5 Slim',
    brand: 'Sony',
    category: 'Игровые консоли',
    categorySlug: 'gaming',
    price: 54990,
    badge: 'hit',
    inStock: true,
    image: '/products/portative console/playstation-5.png',
    description: 'Компактная версия PlayStation 5.',
    specs: [
      { label: 'Накопитель', value: '1 ТБ SSD' },
      { label: 'Разрешение', value: '4K 120fps' },
    ],
  },
  {
    id: '17',
    slug: 'nintendo-switch-2',
    name: 'Nintendo Switch 2',
    brand: 'Nintendo',
    category: 'Игровые консоли',
    categorySlug: 'gaming',
    price: 39990,
    badge: 'new',
    inStock: true,
    image: '/products/portative console/Nintendo-Switch-2.png',
    description: 'Новое поколение портативной консоли Nintendo с увеличенным экраном.',
    specs: [
      { label: 'Дисплей', value: '8" LCD' },
      { label: 'Память', value: '256 ГБ' },
    ],
  },
  {
    id: '18',
    slug: 'magsafe-charger',
    name: 'MagSafe Charger',
    brand: 'Apple',
    category: 'Аксессуары',
    categorySlug: 'accessories',
    price: 4990,
    inStock: true,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MHXH3?wid=800&hei=800&fmt=jpeg&qlt=90',
    description: 'Беспроводная зарядка MagSafe для iPhone.',
    specs: [
      { label: 'Мощность', value: '15 Вт' },
      { label: 'Совместимость', value: 'iPhone 12+' },
    ],
  },
]

export const categories = [
  { id: 'smartphones', name: 'Смартфоны', icon: '📱', count: 6, description: 'iPhone, Samsung, Xiaomi' },
  { id: 'laptops', name: 'Ноутбуки', icon: '💻', count: 2, description: 'MacBook Pro, MacBook Air' },
  { id: 'tablets', name: 'Планшеты', icon: '📱', count: 1, description: 'iPad Pro' },
  { id: 'headphones', name: 'Наушники', icon: '🎧', count: 4, description: 'AirPods, Sony, Samsung' },
  { id: 'watches', name: 'Часы', icon: '⌚', count: 2, description: 'Apple Watch Ultra, Series' },
  { id: 'accessories', name: 'Аксессуары', icon: '🔌', count: 1, description: 'MagSafe Charger' },
  { id: 'gaming', name: 'Игровые консоли', icon: '🎮', count: 2, description: 'PlayStation, Nintendo' },
  { id: 'tv', name: 'ТВ и аудио', icon: '📺', count: 0, description: 'Samsung, LG, Sony' },
]

export const brands = [
  { id: 'apple', name: 'Apple', logo: '🍎' },
  { id: 'samsung', name: 'Samsung', logo: '📱' },
  { id: 'xiaomi', name: 'Xiaomi', logo: '📱' },
  { id: 'sony', name: 'Sony', logo: '🎮' },
  { id: 'nintendo', name: 'Nintendo', logo: '🎮' },
]

export function formatPrice(price: number): string {
  return price.toLocaleString('ru-RU') + ' ₽'
}

export function getBadgeText(badge: Product['badge']): string {
  switch (badge) {
    case 'hit': return 'Хит'
    case 'new': return 'Новинка'
    case 'sale': return 'Скидка'
    default: return ''
  }
}

export function getProductById(id: string): Product | undefined {
  return products.find(p => p.id === id || p.slug === id)
}

export function getProductsByCategory(categorySlug: string): Product[] {
  return products.filter(p => p.categorySlug === categorySlug)
}

export function getFeaturedProducts(count = 8): Product[] {
  return products.slice(0, count)
}

// ─── API types (зеркало backend схем) ────────────────────────────────────────

export interface ApiProductOut {
  id: string
  name: string
  slug: string
  brand: string | null
  category_id: string | null
  price: number
  discount_price: number | null
  stock_quantity: number
  is_active: boolean
  is_featured: boolean
  main_image_url: string | null
  description: string | null
  short_description: string | null
  sku: string | null
  model: string | null
  color: string | null
  warranty_months: number | null
  created_at: string
  updated_at: string
}

export interface ApiProductVariant {
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

export interface ApiCategoryOut {
  id: string
  name: string
  slug: string
  description: string | null
  image_url: string | null
  is_active: boolean
  parent_id: string | null
  created_at: string
  updated_at: string
}

export interface ApiPaginatedResponse<T> {
  items: T[]
  total: number
  offset: number
  limit: number
  has_next: boolean
}

/** Категория в формате, совместимом с CatalogPage / FilterSidebar */
export interface CatalogCategory {
  id: string       // slug — используется в URL и фильтрах
  name: string
  icon: string
  count: number
  description: string
}

/** Бренд в формате, совместимом с CatalogPage / FilterSidebar */
export interface CatalogBrand {
  id: string       // lowercase name — используется в фильтрах
  name: string
  logo: string
}

/** Маппинг ApiProductOut → Product (для корзины/каталога) */
export function mapApiProduct(
  p: ApiProductOut,
  categorySlug = '',
  categoryName = '',
): Product {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand || '',
    category: categoryName,
    categorySlug,
    price: Number(p.discount_price ?? p.price),
    oldPrice: p.discount_price != null ? Number(p.price) : undefined,
    badge: p.is_featured ? 'hit' : undefined,
    inStock: p.stock_quantity > 0,
    stockQuantity: p.stock_quantity,
    image: p.main_image_url || '',
    description: p.description || p.short_description || '',
    specs: [],
  }
}

/** Маппинг ApiCategoryOut → CatalogCategory */
export function mapApiCategory(c: ApiCategoryOut): CatalogCategory {
  const icons: Record<string, string> = {
    smartphone: '📱', phone: '📱', ноутбук: '💻', laptop: '💻',
    tablet: '📱', планшет: '📱', headphone: '🎧', наушник: '🎧',
    watch: '⌚', часы: '⌚', accessory: '🔌', аксессуар: '🔌',
    gaming: '🎮', игр: '🎮', tv: '📺', аудио: '📺',
  }
  const icon = Object.entries(icons).find(([key]) =>
    c.slug.toLowerCase().includes(key) || c.name.toLowerCase().includes(key)
  )?.[1] ?? '📦'

  return {
    id: c.slug,
    name: c.name,
    icon,
    count: 0,
    description: c.description || '',
  }
}
