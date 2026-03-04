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
  // Mock данные удалены — товары загружаются из API
]

export const categories: { id: string; name: string; icon: string; count: number; description: string }[] = []
// Категории загружаются из API

export const brands: { id: string; name: string; logo: string }[] = []
// Бренды формируются из реальных данных товаров

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

export function getFeaturedProducts(_count = 8): Product[] {
  return [] // Загружается из /api/products/featured
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
