export interface Product {
  id: string
  slug: string
  name: string
  brand: string
  model?: string
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
  condition?: string
}

/**
 * Цена в рублях без копеек: «67 990 ₽».
 * API отдаёт Decimal строкой («67990.00») — приводим к числу, иначе строка
 * печатается как есть, с точкой и нулями. Нечисловое значение возвращаем как было.
 */
export function formatPrice(price: number | string): string {
  const value = typeof price === 'number' ? price : Number(price)
  if (!Number.isFinite(value)) return `${price} ₽`
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽'
}

export function getBadgeText(badge: Product['badge']): string {
  switch (badge) {
    case 'hit': return 'Хит'
    case 'new': return 'Новинка'
    case 'sale': return 'Скидка'
    default: return ''
  }
}

export function formatProductName(name: string): string {
  // Fix Watch name ordering
  const match = name.match(/^(.*?)\s*(ремешок\s+.*?)[,\s]+\s*(корпус\s+.*)$/i);
  if (match) {
    return `${match[1]} ${match[3]} ${match[2]}`
  }
  return name;
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
  condition: string | null
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

export interface QuickFilter {
  label: string
  query: string
  brand?: string
}

export interface ApiCategoryOut {
  id: string
  name: string
  slug: string
  description: string | null
  image_url: string | null
  is_active: boolean
  parent_id: string | null
  quick_filters: QuickFilter[] | null
  product_fields: { key: string; label: string; field_type: 'text' | 'number' | 'select' | 'boolean'; placeholder: string; options: string[]; hint?: string | null; is_required: boolean; is_variant: boolean }[] | null
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
  quickFilters: QuickFilter[]
  quickFiltersConfigured: boolean
  productFields: { key: string; label: string; field_type: 'text' | 'number' | 'select' | 'boolean'; placeholder: string; options: string[]; hint?: string | null; is_required: boolean; is_variant: boolean }[]
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
    name: formatProductName(p.name),
    brand: p.brand || '',
    model: p.model || undefined,
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
    quickFilters: c.quick_filters ?? [],
    quickFiltersConfigured: c.quick_filters !== null,
    productFields: c.product_fields ?? [],
  }
}
