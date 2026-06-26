import { API_BASE_URL } from './config'

// ─────────────────────────────────────────────────────────────────────────────
// Данные для ленивого мега-меню каталога.
// Категории грузятся один раз (лёгкий запрос), бренды — лениво по разделу.
// НИКОГДА не тянем весь каталог (1000+ товаров) в навигацию.
// ─────────────────────────────────────────────────────────────────────────────

export interface MenuCategory {
  id: string
  name: string
  slug: string
}

export interface MenuBrand {
  name: string
  count: number
}

/** Список активных категорий (без Б/У) для меню. Один лёгкий запрос. */
export async function fetchMenuCategories(): Promise<MenuCategory[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/categories?limit=100&only_active=true`)
    if (!res.ok) return []
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data.items ?? [])
    return list
      .filter((c: any) => !String(c.name).toLowerCase().includes('б/у'))
      .map((c: any) => ({ id: c.id, name: c.name, slug: c.slug }))
  } catch {
    return []
  }
}

/**
 * Бренды одной категории — лениво (по наведению / раскрытию раздела).
 * Сначала лёгкий backend-endpoint `/categories/{id}/brands`; если его ещё нет
 * на сервере — fallback на товары ТОЛЬКО этой категории (не весь каталог).
 */
export async function fetchCategoryBrands(categoryId: string): Promise<MenuBrand[]> {
  // 1) Предпочтительный путь — выделенный лёгкий endpoint
  try {
    const res = await fetch(`${API_BASE_URL}/api/categories/${categoryId}/brands`)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) {
        return data.map((b: any) => ({ name: String(b.name), count: Number(b.count ?? 0) }))
      }
    }
  } catch {
    /* fall through to fallback */
  }

  // 2) Fallback — вывести бренды из товаров одной категории (лимит 300)
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/products?category_id=${categoryId}&limit=300&only_active=true`
    )
    if (!res.ok) return []
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.items ?? [])
    const counts = new Map<string, number>()
    for (const p of items) {
      const brand = String(p.brand ?? '').trim()
      if (brand) counts.set(brand, (counts.get(brand) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
      .map(([name, count]) => ({ name, count }))
  } catch {
    return []
  }
}

export interface MenuModel {
  name: string
  slug: string
  image: string
}

export interface MenuBrandGroup {
  name: string
  count: number
  models: MenuModel[]
}

/**
 * Бренды + их модели для одной категории — лениво, в один запрос (как у cordstore:
 * колонка бренда, под ней модели). Берём товары ТОЛЬКО этой категории (лимит 300),
 * группируем по бренду, модели дедуплицируем по названию (поле model, иначе name).
 */
export async function fetchCategoryBrandGroups(categoryId: string): Promise<MenuBrandGroup[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/products?category_id=${categoryId}&limit=300&only_active=true`
    )
    if (!res.ok) return []
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.items ?? [])

    const byBrand = new Map<string, { count: number; models: Map<string, MenuModel> }>()
    for (const p of items) {
      const brand = String(p.brand ?? '').trim()
      if (!brand) continue
      const display = String(p.model ?? '').trim() || String(p.name ?? '').trim()
      const slug = String(p.slug ?? '')
      if (!byBrand.has(brand)) byBrand.set(brand, { count: 0, models: new Map() })
      const g = byBrand.get(brand)!
      g.count++
      if (display && slug && !g.models.has(display)) {
        g.models.set(display, { name: display, slug, image: String(p.main_image_url ?? '') })
      }
    }

    return [...byBrand.entries()]
      .map(([name, g]) => ({ name, count: g.count, models: [...g.models.values()] }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
  } catch {
    return []
  }
}

const BRAND_LOGOS: Record<string, string> = {
  apple: '/logos/apple.svg',
  samsung: '/logos/samsung.svg',
  sony: '/logos/sony.svg',
  xiaomi: '/logos/xiaomi.svg',
  nintendo: '/logos/nintendo.svg',
  huawei: '/logos/huawei.svg',
  jbl: '/logos/jbl.svg',
  dji: '/logos/dji.svg',
  gopro: '/logos/gopro.svg',
  playstation: '/logos/playstation.svg',
  xbox: '/logos/xbox.svg',
  yandex: '/logos/yandex.svg',
}

/** Путь к логотипу бренда или null (тогда показываем текст). */
export function brandLogo(name: string): string | null {
  return BRAND_LOGOS[name.trim().toLowerCase()] ?? null
}

/** Эмодзи-иконка категории по названию (для меню). */
export function categoryEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('смартфон') || n.includes('телефон')) return '📱'
  if (n.includes('ноутбук') || n.includes('компьютер')) return '💻'
  if (n.includes('наушник')) return '🎧'
  if (n.includes('час')) return '⌚'
  if (n.includes('планшет')) return '📱'
  if (n.includes('аксессуар')) return '🔌'
  if (n.includes('консол') || n.includes('игр') || n.includes('приставк')) return '🎮'
  if (n.includes('тв') || n.includes('аудио') || n.includes('телевизор')) return '📺'
  if (n.includes('красот') || n.includes('уход')) return '✨'
  if (n.includes('дом')) return '🏠'
  if (n.includes('фото') || n.includes('видео')) return '📷'
  if (n.includes('отдых') || n.includes('outdoor')) return '🏕️'
  return '📦'
}
