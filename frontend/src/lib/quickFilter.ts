// ─────────────────────────────────────────────────────────────────────────────
// Быстрый фильтр каталога («Watch Ultra», «iPhone 17», «Зарядки»). Ищет внутри
// выбранной категории и бренда; пока там что-то есть, чужие категории и бренды не
// подмешиваются. Если по названию пусто — идём ступенями шире:
//   1. название и бренд — в категории и бренде;
//   2. описание и slug — там же (чипы вроде «зарядк», которых нет в названии);
//   3. название — во всех категориях выбранного бренда (Mac mini лежит не в ноутбуках);
//      без бренда так не делаем: «Ремешки» не должны показать все часы с ремешком;
//   4. название — без бренда, только если такого бренда в каталоге нет вовсе.
// Чужой бренд не подставляется никогда: у Samsung не появятся Apple Watch.
// ─────────────────────────────────────────────────────────────────────────────
import type { Product } from '../data/products'
import { normalizeSearchText, rankSearch } from './searchRank'

export interface QuickFilterScope {
  /** slug категории или 'all' */
  category: string
  /** id бренда в нижнем регистре, 'all' или 'android' (все, кроме Apple) */
  brand: string
  query: string
  /** Запросы всех быстрых фильтров категории — более конкретные вычитаются */
  siblings: string[]
}

export function matchesBrand(p: Product, brand: string): boolean {
  if (brand === 'all') return true
  const own = (p.brand || '').toLowerCase()
  return brand === 'android' ? own !== 'apple' : own === brand
}

export function selectQuickFilter(
  products: readonly Product[],
  { category, brand, query, siblings }: QuickFilterScope,
  tiebreak?: (a: Product, b: Product) => number,
): Product[] {
  const q = normalizeSearchText(query)
  // Фраза целиком по границам слов: «…14 m5 pro» не должно совпасть с «MacBook Pro 14 (M5, …)»
  const has = (hay: string, phrase: string) => ` ${hay} `.includes(` ${phrase} `)
  const narrower = siblings.map(normalizeSearchText).filter(s => s !== q && s.startsWith(`${q} `))
  const drop = (list: Product[]) =>
    list.filter(p => !narrower.some(s => has(normalizeSearchText(`${p.name} ${p.brand}`), s)))
  const byName = (list: readonly Product[]) => drop(rankSearch(list, query, p => `${p.name} ${p.brand}`, undefined, tiebreak))

  const inBrand = products.filter(p => matchesBrand(p, brand))
  const scoped = inBrand.filter(p => category === 'all' || p.categorySlug === category)

  let found = byName(scoped)
  if (found.length) return found
  found = drop(scoped.filter(p => normalizeSearchText(`${p.name} ${p.brand} ${p.description} ${p.slug}`).includes(q)))
  if (found.length) return tiebreak ? found.sort(tiebreak) : found
  if (brand === 'all') return []
  if (inBrand.length) return byName(inBrand)
  return byName(products)
}
