// ─────────────────────────────────────────────────────────────────────────────
// Сортировка каталога. Компаратор — лексикографический кортеж, поэтому порядок
// всегда согласован (никаких «A выше B, B выше C, C выше A»):
//   1. наличие: в наличии → предзаказ → нет в наличии
//   2. метка: хит → скидка → новинка → без метки
//   3. группа (категория + бренд): крупные ассортименты и Apple впереди, чтобы
//      витрина не перемешивала часы, чехлы и телефоны разных брендов
//   4. поколение модели: свежее выше (iPhone 17 раньше 16, Series 10 раньше 9)
//   5. цена по возрастанию — от базовой версии к топовой
//   6. название — детерминированный финал
// ─────────────────────────────────────────────────────────────────────────────
import type { Product } from '../data/products'

const BADGE_RANK: Record<string, number> = { hit: 0, sale: 1, new: 2 }

export function availabilityRank(p: Product): number {
  if (p.preorder) return 1
  return p.inStock ? 0 : 2
}

/**
 * Поколение модели из названия: первое число, которое не объём памяти, не размер
 * в мм/дюймах и не год («iPhone 17 Pro Max 256GB» → 17). Нет числа → 0.
 */
export function modelGeneration(name: string): number {
  const re = /(\d+(?:[.,]\d+)?)\s*([a-zа-яё"″]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(name))) {
    const value = parseFloat(m[1].replace(',', '.'))
    const unit = m[2].toLowerCase()
    if (/^(gb|гб|tb|тб|mm|мм|mah|мач|w|вт|hz|гц|"|″)$/.test(unit)) continue
    if (value >= 1000) continue // годы, артикулы
    return value
  }
  return 0
}

/** Компаратор «популярного» порядка для конкретного набора товаров */
export function makePopularComparator(products: readonly Product[]): (a: Product, b: Product) => number {
  const brandCount = new Map<string, number>()
  const catOrder = new Map<string, number>()
  for (const p of products) {
    const b = (p.brand || '').toLowerCase()
    brandCount.set(b, (brandCount.get(b) ?? 0) + 1)
    if (!catOrder.has(p.categorySlug)) catOrder.set(p.categorySlug, catOrder.size)
  }
  const brandWeight = (brand: string) => {
    const b = (brand || '').toLowerCase()
    return b === 'apple' ? Number.MAX_SAFE_INTEGER : brandCount.get(b) ?? 0
  }
  return (a, b) => {
    const av = availabilityRank(a) - availabilityRank(b)
    if (av) return av
    const bd = (BADGE_RANK[a.badge ?? ''] ?? 3) - (BADGE_RANK[b.badge ?? ''] ?? 3)
    if (bd) return bd
    const cat = (catOrder.get(a.categorySlug) ?? 0) - (catOrder.get(b.categorySlug) ?? 0)
    if (cat) return cat
    const bw = brandWeight(b.brand) - brandWeight(a.brand)
    if (bw) return bw
    if (a.brand.toLowerCase() !== b.brand.toLowerCase()) return a.brand.localeCompare(b.brand)
    const gen = modelGeneration(b.name) - modelGeneration(a.name)
    if (gen) return gen
    return a.price - b.price || a.name.localeCompare(b.name)
  }
}
