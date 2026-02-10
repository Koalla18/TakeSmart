export interface Product {
  id: string
  name: string
  brand: string
  category: string
  categorySlug: string
  price: number
  oldPrice?: number
  badge?: 'hit' | 'new' | 'sale'
  inStock: boolean
  image: string
  description: string
  specs: { label: string; value: string }[]
}

export const products: Product[] = [
  {
    id: '1',
    name: 'iPhone 15 Pro Max 256 ГБ',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 124990,
    oldPrice: 139990,
    badge: 'hit',
    inStock: true,
    image: '📱',
    description: 'Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.',
    specs: [
      { label: 'Дисплей', value: '6.7" Super Retina XDR' },
      { label: 'Процессор', value: 'Apple A17 Pro' },
      { label: 'Память', value: '256 ГБ' },
      { label: 'Камера', value: '48 Мп + 12 Мп + 12 Мп' },
      { label: 'Батарея', value: '4422 мАч' },
    ],
  },
  {
    id: '2',
    name: 'iPhone 15 Pro 128 ГБ',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 109990,
    badge: 'new',
    inStock: true,
    image: '📱',
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
    name: 'iPhone 14 128 ГБ',
    brand: 'Apple',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 69990,
    oldPrice: 79990,
    badge: 'sale',
    inStock: true,
    image: '📱',
    description: 'Отличный выбор для тех, кто хочет получить премиальное качество Apple по доступной цене.',
    specs: [
      { label: 'Дисплей', value: '6.1" Super Retina XDR' },
      { label: 'Процессор', value: 'Apple A15 Bionic' },
      { label: 'Память', value: '128 ГБ' },
    ],
  },
  {
    id: '4',
    name: 'Samsung Galaxy S24 Ultra',
    brand: 'Samsung',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 109990,
    inStock: true,
    image: '📱',
    description: 'Флагман Samsung с Galaxy AI, S Pen и революционной камерой 200 Мп.',
    specs: [
      { label: 'Дисплей', value: '6.8" Dynamic AMOLED 2X' },
      { label: 'Процессор', value: 'Snapdragon 8 Gen 3' },
      { label: 'Память', value: '256 ГБ' },
      { label: 'Камера', value: '200 Мп' },
    ],
  },
  {
    id: '5',
    name: 'MacBook Pro 14" M3 Pro',
    brand: 'Apple',
    category: 'Ноутбуки',
    categorySlug: 'laptops',
    price: 249990,
    badge: 'new',
    inStock: true,
    image: '💻',
    description: 'Профессиональный ноутбук с чипом M3 Pro и дисплеем Liquid Retina XDR.',
    specs: [
      { label: 'Дисплей', value: '14.2" Liquid Retina XDR' },
      { label: 'Процессор', value: 'Apple M3 Pro' },
      { label: 'Память', value: '18 ГБ / 512 ГБ SSD' },
      { label: 'Автономность', value: 'до 17 часов' },
    ],
  },
  {
    id: '6',
    name: 'MacBook Air 15" M3',
    brand: 'Apple',
    category: 'Ноутбуки',
    categorySlug: 'laptops',
    price: 179990,
    inStock: true,
    image: '💻',
    description: 'Самый тонкий 15-дюймовый ноутбук в мире с чипом M3.',
    specs: [
      { label: 'Дисплей', value: '15.3" Liquid Retina' },
      { label: 'Процессор', value: 'Apple M3' },
      { label: 'Память', value: '8 ГБ / 256 ГБ SSD' },
    ],
  },
  {
    id: '7',
    name: 'iPad Pro 12.9" M2',
    brand: 'Apple',
    category: 'Планшеты',
    categorySlug: 'tablets',
    price: 139990,
    inStock: true,
    image: '📱',
    description: 'Самый мощный iPad с чипом M2 и дисплеем Liquid Retina XDR.',
    specs: [
      { label: 'Дисплей', value: '12.9" Liquid Retina XDR' },
      { label: 'Процессор', value: 'Apple M2' },
      { label: 'Память', value: '256 ГБ' },
    ],
  },
  {
    id: '8',
    name: 'AirPods Pro 2',
    brand: 'Apple',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 24990,
    oldPrice: 29990,
    badge: 'sale',
    inStock: true,
    image: '🎧',
    description: 'Беспроводные наушники с активным шумоподавлением и пространственным аудио.',
    specs: [
      { label: 'Тип', value: 'Внутриканальные TWS' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: '6 ч (30 ч с кейсом)' },
    ],
  },
  {
    id: '9',
    name: 'AirPods Max',
    brand: 'Apple',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 59990,
    inStock: true,
    image: '🎧',
    description: 'Премиальные накладные наушники с невероятным звуком.',
    specs: [
      { label: 'Тип', value: 'Накладные' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: 'до 20 часов' },
    ],
  },
  {
    id: '10',
    name: 'Sony WH-1000XM5',
    brand: 'Sony',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 39990,
    oldPrice: 44990,
    badge: 'hit',
    inStock: true,
    image: '🎧',
    description: 'Лучшие наушники с шумоподавлением от Sony.',
    specs: [
      { label: 'Тип', value: 'Накладные' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: 'до 30 часов' },
    ],
  },
  {
    id: '11',
    name: 'Apple Watch Ultra 2',
    brand: 'Apple',
    category: 'Часы',
    categorySlug: 'watches',
    price: 79990,
    badge: 'new',
    inStock: true,
    image: '⌚',
    description: 'Самые защищённые и функциональные Apple Watch.',
    specs: [
      { label: 'Дисплей', value: '49 мм OLED' },
      { label: 'Защита', value: 'WR100, IP6X' },
      { label: 'GPS', value: 'Двухдиапазонный' },
    ],
  },
  {
    id: '12',
    name: 'Apple Watch Series 9',
    brand: 'Apple',
    category: 'Часы',
    categorySlug: 'watches',
    price: 44990,
    inStock: true,
    image: '⌚',
    description: 'Умные часы с чипом S9 и жестовым управлением.',
    specs: [
      { label: 'Дисплей', value: '45 мм OLED' },
      { label: 'Чип', value: 'Apple S9' },
      { label: 'Защита', value: 'WR50' },
    ],
  },
  {
    id: '13',
    name: 'PlayStation 5',
    brand: 'Sony',
    category: 'Игровые консоли',
    categorySlug: 'gaming',
    price: 54990,
    badge: 'hit',
    inStock: true,
    image: '🎮',
    description: 'Игровая консоль нового поколения от Sony.',
    specs: [
      { label: 'Процессор', value: 'AMD Zen 2' },
      { label: 'GPU', value: 'AMD RDNA 2' },
      { label: 'Память', value: '825 ГБ SSD' },
    ],
  },
  {
    id: '14',
    name: 'Nintendo Switch OLED',
    brand: 'Nintendo',
    category: 'Игровые консоли',
    categorySlug: 'gaming',
    price: 34990,
    inStock: true,
    image: '🎮',
    description: 'Гибридная консоль с ярким OLED-экраном.',
    specs: [
      { label: 'Дисплей', value: '7" OLED' },
      { label: 'Память', value: '64 ГБ' },
      { label: 'Автономность', value: '4.5-9 часов' },
    ],
  },
  {
    id: '15',
    name: 'Xiaomi 14 Ultra',
    brand: 'Xiaomi',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 99990,
    badge: 'new',
    inStock: true,
    image: '📱',
    description: 'Флагман Xiaomi с камерой Leica и чипом Snapdragon 8 Gen 3.',
    specs: [
      { label: 'Дисплей', value: '6.73" AMOLED' },
      { label: 'Процессор', value: 'Snapdragon 8 Gen 3' },
      { label: 'Камера', value: 'Leica 50 Мп' },
    ],
  },
  {
    id: '16',
    name: 'MagSafe Charger',
    brand: 'Apple',
    category: 'Аксессуары',
    categorySlug: 'accessories',
    price: 4990,
    inStock: true,
    image: '🔌',
    description: 'Беспроводное зарядное устройство с магнитным креплением.',
    specs: [
      { label: 'Мощность', value: '15 Вт' },
      { label: 'Совместимость', value: 'iPhone 12 и новее' },
    ],
  },
  {
    id: '17',
    name: 'Samsung Galaxy Buds3 Pro',
    brand: 'Samsung',
    category: 'Наушники',
    categorySlug: 'headphones',
    price: 21990,
    badge: 'new',
    inStock: true,
    image: '🎧',
    description: 'Премиальные TWS-наушники Samsung с Galaxy AI.',
    specs: [
      { label: 'Тип', value: 'Внутриканальные TWS' },
      { label: 'Шумоподавление', value: 'Активное (ANC)' },
      { label: 'Время работы', value: '7 ч' },
    ],
  },
  {
    id: '18',
    name: 'Nothing Phone (2a)',
    brand: 'Nothing',
    category: 'Смартфоны',
    categorySlug: 'smartphones',
    price: 39990,
    inStock: false,
    image: '📱',
    description: 'Стильный смартфон с уникальным дизайном Glyph Interface.',
    specs: [
      { label: 'Дисплей', value: '6.7" AMOLED' },
      { label: 'Процессор', value: 'MediaTek Dimensity 7200 Pro' },
      { label: 'Память', value: '128 ГБ' },
    ],
  },
]

export const categories = [
  { id: 'smartphones', name: 'Смартфоны', icon: '📱', count: 156, description: 'iPhone, Samsung, Xiaomi' },
  { id: 'laptops', name: 'Ноутбуки', icon: '💻', count: 48, description: 'MacBook, Dell, HP' },
  { id: 'tablets', name: 'Планшеты', icon: '📱', count: 32, description: 'iPad, Samsung Tab' },
  { id: 'headphones', name: 'Наушники', icon: '🎧', count: 87, description: 'AirPods, Sony, JBL' },
  { id: 'watches', name: 'Часы', icon: '⌚', count: 45, description: 'Apple Watch, Samsung' },
  { id: 'accessories', name: 'Аксессуары', icon: '🔌', count: 234, description: 'Чехлы, зарядки, кабели' },
  { id: 'gaming', name: 'Игровые консоли', icon: '🎮', count: 28, description: 'PlayStation, Nintendo' },
  { id: 'tv', name: 'ТВ и аудио', icon: '📺', count: 64, description: 'Samsung, LG, Sony' },
]

export const brands = [
  { id: 'apple', name: 'Apple', logo: '🍎' },
  { id: 'samsung', name: 'Samsung', logo: '📱' },
  { id: 'xiaomi', name: 'Xiaomi', logo: '📱' },
  { id: 'sony', name: 'Sony', logo: '🎮' },
  { id: 'nintendo', name: 'Nintendo', logo: '🎮' },
  { id: 'jbl', name: 'JBL', logo: '🎧' },
  { id: 'marshall', name: 'Marshall', logo: '🎧' },
  { id: 'nothing', name: 'Nothing', logo: '📱' },
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
  return products.find(p => p.id === id)
}

export function getProductsByCategory(categorySlug: string): Product[] {
  return products.filter(p => p.categorySlug === categorySlug)
}

export function getFeaturedProducts(count = 8): Product[] {
  return products.slice(0, count)
}
