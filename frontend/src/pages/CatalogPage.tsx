import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

// Сколько карточек рендерим за раз (бесконечная прокрутка). Не рендерим 1000+ DOM-узлов сразу.
const PAGE_SIZE = 24
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import {
  type CatalogCategory,
  type CatalogBrand,
  type ApiProductOut,
  type ApiCategoryOut,
  type ApiPaginatedResponse,
  type Product,
  mapApiProduct,
  mapApiCategory,
} from '../data/products'
import { API_BASE_URL } from '../lib/config'
import { 
  ChevronDownIcon, 
  FilterIcon, 
  CloseIcon, 
  GridIcon,
  ListIcon,
  SearchIcon 
} from '../components/ui/Icons'

// Дефолтные быстрые фильтры по slug категории  (используются если в API quick_filters = null)
// brand — автоматически ставит фильтр бренда при клике
const DEFAULT_QUICK_FILTERS: Record<string, { label: string; query: string; brand?: string }[]> = {
  smartphones: [
    { label: 'iPhone 17 Pro Max', query: 'iPhone 17 Pro Max', brand: 'apple' },
    { label: 'iPhone 17 Pro', query: 'iPhone 17 Pro', brand: 'apple' },
    { label: 'iPhone 17', query: 'iPhone 17', brand: 'apple' },
    { label: 'iPhone Air', query: 'iPhone Air', brand: 'apple' },
    { label: 'iPhone 16 Pro Max', query: 'iPhone 16 Pro Max', brand: 'apple' },
    { label: 'iPhone 16 Pro', query: 'iPhone 16 Pro', brand: 'apple' },
    { label: 'iPhone 16', query: 'iPhone 16', brand: 'apple' },
    { label: 'iPhone 15', query: 'iPhone 15', brand: 'apple' },
    { label: 'iPhone 14', query: 'iPhone 14', brand: 'apple' },
    { label: 'iPhone 13', query: 'iPhone 13', brand: 'apple' },
    { label: 'Galaxy S26 Ultra', query: 'Galaxy S26 Ultra', brand: 'samsung' },
    { label: 'Galaxy S26+', query: 'Galaxy S26 Plus', brand: 'samsung' },
    { label: 'Galaxy S26', query: 'Galaxy S26', brand: 'samsung' },
    { label: 'Galaxy S25 Ultra', query: 'Galaxy S25 Ultra', brand: 'samsung' },
    { label: 'Galaxy S25+', query: 'Galaxy S25 Plus', brand: 'samsung' },
    { label: 'Galaxy S25', query: 'Galaxy S25', brand: 'samsung' },
    { label: 'Galaxy S24 Ultra', query: 'Galaxy S24 Ultra', brand: 'samsung' },
    { label: 'Galaxy S24', query: 'Galaxy S24', brand: 'samsung' },
    { label: 'Galaxy S23', query: 'Galaxy S23', brand: 'samsung' },
    { label: 'Galaxy Z Fold', query: 'Z Fold', brand: 'samsung' },
    { label: 'Galaxy Z Flip', query: 'Z Flip', brand: 'samsung' },
    { label: 'Xiaomi 15', query: 'Xiaomi 15', brand: 'xiaomi' },
    { label: 'Xiaomi 14', query: 'Xiaomi 14', brand: 'xiaomi' },
    { label: 'Xiaomi 13', query: 'Xiaomi 13', brand: 'xiaomi' },
  ],
  laptops: [
    { label: 'MacBook NEO', query: 'MacBook Neo', brand: 'apple' },
    { label: 'MacBook Air 13"', query: 'MacBook Air 13', brand: 'apple' },
    { label: 'MacBook Air 15"', query: 'MacBook Air 15', brand: 'apple' },
    { label: 'MacBook Pro 14"', query: 'MacBook Pro 14', brand: 'apple' },
    { label: 'MacBook Pro 16"', query: 'MacBook Pro 16', brand: 'apple' },
    { label: 'iMac', query: 'iMac', brand: 'apple' },
    { label: 'Mac mini', query: 'Mac mini', brand: 'apple' },
    { label: 'Surface Laptop', query: 'Surface Laptop', brand: 'microsoft' },
    { label: 'ZenBook', query: 'ZenBook', brand: 'asus' },
    { label: 'ROG', query: 'ROG', brand: 'asus' },
    { label: 'ThinkPad', query: 'ThinkPad', brand: 'lenovo' },
    { label: 'Legion', query: 'Legion', brand: 'lenovo' },
  ],
  tablets: [
    { label: 'iPad 11" (2025)', query: 'iPad 11', brand: 'apple' },
    { label: 'iPad 10.9"', query: 'iPad 10', brand: 'apple' },
    { label: 'iPad Air M3', query: 'iPad Air', brand: 'apple' },
    { label: 'iPad Pro M5', query: 'iPad Pro', brand: 'apple' },
    { label: 'iPad mini', query: 'iPad mini', brand: 'apple' },
    { label: 'Galaxy Tab S10', query: 'Tab S10', brand: 'samsung' },
    { label: 'Galaxy Tab S9', query: 'Tab S9', brand: 'samsung' },
    { label: 'Xiaomi Pad', query: 'Xiaomi Pad', brand: 'xiaomi' },
  ],
  headphones: [
    { label: 'AirPods Pro 3', query: 'AirPods Pro 3', brand: 'apple' },
    { label: 'AirPods Pro 2', query: 'AirPods Pro 2', brand: 'apple' },
    { label: 'AirPods 4', query: 'AirPods 4', brand: 'apple' },
    { label: 'AirPods 3', query: 'AirPods 3', brand: 'apple' },
    { label: 'AirPods Max', query: 'AirPods Max', brand: 'apple' },
    { label: 'Marshall Major V', query: 'Marshall Major', brand: 'marshall' },
    { label: 'Marshall Motif', query: 'Marshall Motif', brand: 'marshall' },
    { label: 'Galaxy Buds', query: 'Galaxy Buds', brand: 'samsung' },
  ],
  'krasota-i-ukhod': [
    { label: 'Стайлеры Airwrap', query: 'Airwrap', brand: 'dyson' },
    { label: 'Выпрямители Airstrait', query: 'Airstrait', brand: 'dyson' },
    { label: 'Выпрямители Corrale', query: 'Corrale', brand: 'dyson' },
    { label: 'Фены Supersonic', query: 'Supersonic', brand: 'dyson' },
    { label: 'Фены Nural', query: 'Nural', brand: 'dyson' },
    { label: 'Машинки для стрижки', query: 'стрижк' },
    { label: 'Электробритвы', query: 'бритв' },
  ],
  'dlia-doma': [
    { label: 'Пылесосы Dyson', query: 'пылесос', brand: 'dyson' },
    { label: 'Роботы-пылесосы', query: 'робот' },
    { label: 'Очистители воздуха', query: 'очистител' },
    { label: 'Увлажнители', query: 'увлажнител' },
    { label: 'Умный дом Яндекс', query: 'яндекс', brand: 'яндекс' },
  ],
  accessories: [
    { label: 'Чехлы Pitaka', query: 'Pitaka' },
    { label: 'Чехлы Apple', query: 'чехол', brand: 'apple' },
    { label: 'Ремешки', query: 'ремешок' },
    { label: 'Apple Pencil', query: 'Apple Pencil', brand: 'apple' },
    { label: 'Зарядки', query: 'зарядк' },
    { label: 'Кабели', query: 'кабел' },
    { label: 'Защитные стекла', query: 'стекл' },
  ],
  watches: [
    { label: 'Apple Watch Ultra 2', query: 'Watch Ultra 2', brand: 'apple' },
    { label: 'Apple Watch Series 10', query: 'Watch Series 10', brand: 'apple' },
    { label: 'Apple Watch Series 9', query: 'Watch Series 9', brand: 'apple' },
    { label: 'Apple Watch SE', query: 'Watch SE', brand: 'apple' },
    { label: 'Galaxy Watch 7', query: 'Watch 7', brand: 'samsung' },
    { label: 'Galaxy Watch Ultra', query: 'Watch Ultra', brand: 'samsung' },
  ],
  gaming: [
    { label: 'PlayStation 5', query: 'PlayStation 5', brand: 'sony' },
    { label: 'Xbox Series X', query: 'Xbox Series', brand: 'microsoft' },
    { label: 'Nintendo Switch', query: 'Switch', brand: 'nintendo' },
    { label: 'Steam Deck', query: 'Steam Deck' },
    { label: 'VR Гарнитуры', query: 'VR' },
    { label: 'Геймпады', query: 'геймпад' },
  ],
  tv: [
    { label: 'Телевизоры Samsung', query: 'телевизор', brand: 'samsung' },
    { label: 'Телевизоры LG', query: 'телевизор', brand: 'lg' },
    { label: 'Телевизоры Xiaomi', query: 'телевизор', brand: 'xiaomi' },
    { label: 'Apple TV', query: 'Apple TV', brand: 'apple' },
    { label: 'Саундбары', query: 'саундбар' },
    { label: 'Умные колонки', query: 'колонк' },
  ],
}

type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'name' | 'new'

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'popular', label: 'По популярности' },
  { value: 'price-asc', label: 'Сначала дешевле' },
  { value: 'price-desc', label: 'Сначала дороже' },
  { value: 'new', label: 'Сначала новинки' },
  { value: 'name', label: 'По названию' },
]

function FilterSidebar({
  selectedCategory,
  setSelectedCategory,
  selectedBrand,
  setSelectedBrand,
  priceRange,
  setPriceRange,
  inStockOnly,
  setInStockOnly,
  onReset,
  isMobile = false,
  onClose,
  categoriesList,
  brandsList,
  categoryBrandsMap,
}: {
  selectedCategory: string
  setSelectedCategory: (v: string) => void
  selectedBrand: string
  setSelectedBrand: (v: string) => void
  priceRange: [number, number]
  setPriceRange: (v: [number, number]) => void
  inStockOnly: boolean
  setInStockOnly: (v: boolean) => void
  onReset: () => void
  isMobile?: boolean
  onClose?: () => void
  categoriesList: CatalogCategory[]
  brandsList: CatalogBrand[]
  categoryBrandsMap: Record<string, CatalogBrand[]>
}) {
  const minPrice = 0
  const maxPrice = 999999999
  
  return (
    <div className={isMobile ? '' : 'sticky top-24'}>
      {isMobile && (
        <div className="mb-6 flex items-center justify-between border-b border-gray-100 pb-4">
          <h2 className="text-lg font-semibold">Фильтры</h2>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100">
            <CloseIcon />
          </button>
        </div>
      )}
      
      {/* Categories */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Категории</h3>
        <div className="space-y-1">
          <button
            onClick={() => {
              setSelectedCategory('all');
              setSelectedBrand('all');
            }}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              selectedCategory === 'all'
                ? 'bg-yellow-50 font-medium text-yellow-700'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Все товары
          </button>
          {categoriesList.map((cat) => {
            const isSelected = selectedCategory === cat.id
            const catBrands = isSelected ? (categoryBrandsMap[cat.id] || []) : []

            return (
              <div key={cat.id} className="space-y-0.5">
                <button
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setSelectedBrand('all');
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-yellow-50 font-medium text-yellow-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {cat.name}
                </button>
                
                {isSelected && catBrands.length > 0 && (
                  <div className="ml-3 mt-1 flex flex-col space-y-0.5 border-l-2 border-yellow-100 pl-3">
                    <button
                      onClick={() => setSelectedBrand('all')}
                      className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                        selectedBrand === 'all'
                          ? 'font-medium text-yellow-700'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      Общий каталог
                    </button>
                    {catBrands.map((brand) => (
                      <button
                        key={brand.id}
                        onClick={() => setSelectedBrand(brand.id)}
                        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                          selectedBrand === brand.id
                            ? 'font-medium text-yellow-700'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        {brand.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      
      {/* Brands */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Бренды</h3>
        <div className="space-y-1">
          <button
            onClick={() => setSelectedBrand('all')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              selectedBrand === 'all'
                ? 'bg-yellow-50 font-medium text-yellow-700'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Все бренды
          </button>
          {brandsList.map((brand) => (
            <button
              key={brand.id}
              onClick={() => setSelectedBrand(brand.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selectedBrand === brand.id
                  ? 'bg-yellow-50 font-medium text-yellow-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{brand.logo}</span>
              {brand.name}
            </button>
          ))}
        </div>
      </div>
      
      {/* Price Range */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Цена, ₽</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={priceRange[0]}
            onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            placeholder="От"
            min={minPrice}
            max={maxPrice}
          />
          <span className="text-gray-400">—</span>
          <input
            type="number"
            value={priceRange[1]}
            onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            placeholder="До"
            min={minPrice}
            max={maxPrice}
          />
        </div>
      </div>
      
      {/* In Stock */}
      <div className="mb-6">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-yellow-500 focus:ring-yellow-400"
          />
          <span className="text-sm text-gray-700">Только в наличии</span>
        </label>
      </div>
      
      {/* Reset */}
      <button
        onClick={onReset}
        className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
      >
        Сбросить фильтры
      </button>
      
      {isMobile && (
        <Button onClick={onClose} className="mt-4 w-full" size="lg">
          Показать товары
        </Button>
      )}
    </div>
  )
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  
  // ─── Данные (загружаются из API) ──────────────────────────────────────────
  const [displayProducts, setDisplayProducts] = useState<Product[]>([])
  const [displayCategories, setDisplayCategories] = useState<CatalogCategory[]>([])
  const [displayBrands, setDisplayBrands] = useState<CatalogBrand[]>([])
  const [categoryBrandsMap, setCategoryBrandsMap] = useState<Record<string, CatalogBrand[]>>({})

  // Filter states
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all')
  const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || 'all')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 999999999])
  const [inStockOnly, setInStockOnly] = useState(false)
  const [sort, setSort] = useState<SortOption>('popular')
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')

  // ─── Загрузка данных из API ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      try {
        // Категории и ПЕРВУЮ (маленькую) порцию товаров грузим ПАРАЛЛЕЛЬНО — на один
        // round-trip меньше до первой отрисовки (важно при высокой задержке: VPN/заграница).
        const FIRST_CHUNK = 36
        const CHUNK = 200
        const [catResp, firstProdResp] = await Promise.all([
          fetch(`${API_BASE_URL}/api/categories`),
          fetch(`${API_BASE_URL}/api/products?limit=${FIRST_CHUNK}&offset=0&only_active=true`),
        ])
        if (!catResp.ok) { setIsLoading(false); return }

        const catRaw = await catResp.json()
        const catData: ApiCategoryOut[] = Array.isArray(catRaw) ? catRaw : (catRaw.items ?? [])

        const brandIcons: Record<string, string> = {
          apple: '🍎', samsung: '📱', xiaomi: '📱', sony: '🎮',
          google: '🔍', huawei: '📱', oppo: '📱', lg: '📺',
          microsoft: '💻', asus: '💻', lenovo: '💻', hp: '💻',
          dell: '💻', nintendo: '🎮', whoop: '⌚', lego: '🧱',
        }
        const catMap = new Map<string, { slug: string; name: string }>(
          catData.map(c => [c.id, { slug: c.slug, name: c.name }])
        )

        // Пересчёт стейта из накопленных товаров (вызывается после каждой порции)
        const applyDerived = (rawItems: ApiProductOut[], isFirst: boolean) => {
          const newItems = rawItems.filter(p => (p.condition || 'new') !== 'used')
          const mapped = newItems.map(p => {
            const cat = p.category_id ? catMap.get(p.category_id) : undefined
            return mapApiProduct(p, cat?.slug ?? '', cat?.name ?? '')
          })

          const uniqueBrands = [...new Set(mapped.map(p => p.brand).filter(Boolean))]
          const apiBrands: CatalogBrand[] = uniqueBrands.map(b => ({
            id: b.toLowerCase(), name: b, logo: brandIcons[b.toLowerCase()] ?? '📦',
          }))

          const apiBrandsByCategory: Record<string, CatalogBrand[]> = {}
          for (const c of new Set(mapped.map(p => p.categorySlug).filter(Boolean))) {
            const brandsInCategory = [...new Set(mapped.filter(p => p.categorySlug === c).map(p => p.brand).filter(Boolean))]
            apiBrandsByCategory[c] = brandsInCategory.map(b => ({
              id: b.toLowerCase(), name: b, logo: brandIcons[b.toLowerCase()] ?? '📦',
            }))
          }

          const activeSlugs = new Set(mapped.map(p => p.categorySlug).filter(Boolean))
          const apiCategories: CatalogCategory[] = catData
            .filter(c => c.is_active)
            .map(c => {
              const base = mapApiCategory(c)
              return {
                ...base,
                count: mapped.filter(p => p.categorySlug === c.slug).length,
                quickFilters: base.quickFilters.length > 0 ? base.quickFilters : (DEFAULT_QUICK_FILTERS[c.slug] ?? []),
              }
            })
            .filter(c => (activeSlugs.has(c.id) || c.count > 0) && !c.name.toLowerCase().includes('б/у'))

          setDisplayProducts(mapped)
          setDisplayCategories(apiCategories)
          setDisplayBrands(apiBrands)
          setCategoryBrandsMap(apiBrandsByCategory)

          if (isFirst) {
            // Resolve category from URL alias (один раз, по первой порции)
            const urlCat = searchParams.get('category')
            if (urlCat && urlCat !== 'all') {
              const knownSlugs = new Set(apiCategories.map(c => c.id))
              if (!knownSlugs.has(urlCat)) {
                const ALIASES: Record<string, string[]> = {
                  smartphones: ['смартфон', 'phone', 'телефон'],
                  laptops: ['ноутбук', 'laptop', 'компьютер'],
                  tablets: ['планшет', 'tablet', 'ipad'],
                  watches: ['часы', 'watch', 'band'],
                  headphones: ['наушник', 'headphone', 'колонк', 'audio'],
                  accessories: ['аксессуар', 'accessor', 'чехол'],
                  gaming: ['игр', 'gaming', 'console', 'приставк'],
                  home: ['дом', 'home', 'бытов'],
                  outdoor: ['отдых', 'outdoor', 'спорт', 'активн'],
                  beauty: ['красот', 'beauty', 'уход', 'dyson'],
                  tv: ['тв', 'tv', 'аудио', 'телевизор'],
                }
                const keywords = ALIASES[urlCat] || [urlCat]
                const match = apiCategories.find(c =>
                  keywords.some(kw => c.id.includes(kw) || c.name.toLowerCase().includes(kw))
                )
                if (match) setSelectedCategory(match.id)
              }
            }
            setIsLoading(false)
          }
        }

        // Первую (маленькую) порцию уже загрузили параллельно с категориями — она даёт
        // мгновенную первую отрисовку. Остальное догружаем крупными порциями в фоне
        // (для клиентских фильтров/поиска), не блокируя первый рендер.
        let offset = 0
        let limit = FIRST_CHUNK
        let prodResp = firstProdResp
        const allRaw: ApiProductOut[] = []
        let chunkIndex = 0
        while (true) {
          if (!prodResp.ok) break

          const raw = await prodResp.json() as ApiPaginatedResponse<ApiProductOut> | ApiProductOut[]
          const items = Array.isArray(raw) ? raw : (raw.items ?? [])
          if (cancelled) return

          if (items.length > 0) {
            allRaw.push(...items)
            applyDerived(allRaw, chunkIndex === 0)
            chunkIndex++
          }

          const hasNext = Array.isArray(raw) ? items.length === limit : Boolean(raw.has_next)
          if (!hasNext || items.length === 0) break
          offset += items.length
          limit = CHUNK
          prodResp = await fetch(`${API_BASE_URL}/api/products?limit=${limit}&offset=${offset}&only_active=true`)
        }

        if (chunkIndex === 0) setIsLoading(false)
      } catch (err) {
        console.error('Failed to load catalog:', err)
        setIsLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [])

  // Sync filters from URL (e.g. when navigating from homepage category links)
  useEffect(() => {
    const cat = searchParams.get('category') || 'all'
    const brand = searchParams.get('brand') || 'all'
    const q = searchParams.get('q') || ''
    setSelectedCategory(cat)
    setSelectedBrand(brand)
    setSearchQuery(q)
  }, [searchParams.get('category'), searchParams.get('brand'), searchParams.get('q')])
  
  // Simulate loading
  useEffect(() => {
    setIsLoading(true)
    const timer = setTimeout(() => setIsLoading(false), 500)
    return () => clearTimeout(timer)
  }, [selectedCategory, selectedBrand, sort])
  
  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    if (selectedCategory !== 'all') params.set('category', selectedCategory)
    if (selectedBrand !== 'all') params.set('brand', selectedBrand)
    if (searchQuery) params.set('q', searchQuery)
    setSearchParams(params, { replace: true })
  }, [selectedCategory, selectedBrand, searchQuery, setSearchParams])
  
  const currentCategory = displayCategories.find(c => c.id === selectedCategory)

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let result = [...displayProducts]
    const hasSearch = searchQuery.trim().length > 0
    
    // While searching, ignore category/brand filters and search globally.
    if (!hasSearch) {
      // Category filter
      if (selectedCategory !== 'all') {
        result = result.filter(p => p.categorySlug === selectedCategory)
      }

      // Brand filter
      if (selectedBrand === 'android') {
        result = result.filter(p => !['apple'].includes(p.brand.toLowerCase()))
      } else if (selectedBrand !== 'all') {
        result = result.filter(p => p.brand.toLowerCase() === selectedBrand)
      }
    }
    
    // Price filter
    result = result.filter(p => p.price >= priceRange[0] && p.price <= priceRange[1])
    
    // Stock filter
    if (inStockOnly) {
      result = result.filter(p => p.inStock)
    }
    
    // Smart search
    if (searchQuery) {
      const normalizeSearchText = (value: string) =>
        value
          .toLowerCase()
          .replace(/[()\[\]{}.,/\\+\-_:;"']/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()

      const q = normalizeSearchText(searchQuery)
      // If query matches a quick filter tag — use exact substring match
      // and exclude products that match MORE specific sibling filters
      const isQuickFilter = currentCategory?.quickFilters.some(qf => qf.query === searchQuery)
      if (isQuickFilter) {
        // Find sibling filters that are more specific (contain this query as prefix)
        const moreSpecific = (currentCategory?.quickFilters ?? [])
          .filter(qf => qf.query !== searchQuery && qf.query.toLowerCase().startsWith(q))
          .map(qf => qf.query.toLowerCase())
        result = result.filter(p => {
          const hay = normalizeSearchText(`${p.name} ${p.brand} ${p.description} ${p.slug}`)
          if (!hay.includes(q)) return false
          // Exclude if it matches a more specific sibling tag
          if (moreSpecific.some(s => hay.includes(s))) return false
          return true
        })
      } else {
        // Manual search — token-based (every word must appear)
        const tokens = q.split(/\s+/).filter(Boolean)
        if (tokens.length) {
          result = result.filter(p => {
            const hay = normalizeSearchText(`${p.name} ${p.brand} ${p.description} ${p.slug}`)
            return tokens.every(t => hay.includes(t))
          })
        }
      }
    }
    
    // Sort
    switch (sort) {
      case 'price-asc':
        result.sort((a, b) => a.price - b.price)
        break
      case 'price-desc':
        result.sort((a, b) => b.price - a.price)
        break
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'new':
        result.sort((a, b) => (b.badge === 'new' ? 1 : 0) - (a.badge === 'new' ? 1 : 0))
        break
      default:
        result.sort((a, b) => (b.badge === 'hit' ? 1 : 0) - (a.badge === 'hit' ? 1 : 0))
    }
    
    return result
  }, [displayProducts, selectedCategory, selectedBrand, priceRange, inStockOnly, sort, searchQuery])

  // ─── Бесконечная прокрутка: рендерим порциями по PAGE_SIZE ──────────────────
  // Сбрасываем счётчик при смене фильтров (но НЕ при дозагрузке данных в фоне).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [selectedCategory, selectedBrand, priceRange[0], priceRange[1], inStockOnly, sort, searchQuery])

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  )
  const hasMore = visibleCount < filteredProducts.length

  // Подгружаем следующую порцию, когда «маяк» появляется в зоне видимости
  useEffect(() => {
    if (!hasMore) return
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) setVisibleCount(v => v + PAGE_SIZE)
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, filteredProducts.length])

  const resetFilters = () => {
    setSelectedCategory('all')
    setSelectedBrand('all')
    setPriceRange([0, 999999999])
    setInStockOnly(false)
    setSearchQuery('')
  }
  
  const activeFiltersCount = [
    selectedCategory !== 'all',
    selectedBrand !== 'all',
    priceRange[0] > 0 || priceRange[1] < 999999999,
    inStockOnly,
  ].filter(Boolean).length
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <Container className="py-6">
          {/* Breadcrumbs */}
          <nav className="mb-4 flex items-center gap-2 text-sm">
            <Link to="/" className="text-gray-500 hover:text-yellow-600">Главная</Link>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900">Каталог</span>
            {currentCategory && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-gray-900">{currentCategory.name}</span>
              </>
            )}
          </nav>
          
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                {currentCategory?.name || 'Все товары'}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {filteredProducts.length} {
                  filteredProducts.length === 1 ? 'товар' :
                  filteredProducts.length < 5 ? 'товара' : 'товаров'
                }
              </p>
            </div>
            
            {/* Search */}
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск товаров..."
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 sm:w-64"
              />
            </div>
          </div>
        </Container>
      </div>
      
      <Container className="py-8">
        <div className="flex gap-8">
          {/* Desktop Sidebar */}
          <aside className="hidden w-64 flex-shrink-0 lg:block">
            <FilterSidebar
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              selectedBrand={selectedBrand}
              setSelectedBrand={setSelectedBrand}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              inStockOnly={inStockOnly}
              setInStockOnly={setInStockOnly}
              onReset={resetFilters}
              categoriesList={displayCategories}
              brandsList={displayBrands}
              categoryBrandsMap={categoryBrandsMap}
            />
          </aside>
          
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile: horizontal category chips */}
            <div className="mb-4 lg:hidden">
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
                <button
                  onClick={() => {
                    setSelectedCategory('all');
                    setSelectedBrand('all');
                  }}
                  className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      selectedCategory === 'all'
                      ? 'bg-yellow-400 text-gray-900'
                      : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  Все
                </button>
                {displayCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setSelectedBrand('all');
                    }}
                    className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      selectedCategory === cat.id
                        ? 'bg-yellow-400 text-gray-900'
                        : 'bg-white text-gray-700 border border-gray-200'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick filter tags — на десктопе переносятся (всё видно), на мобиле горизонтальный скролл */}
            {currentCategory && currentCategory.quickFilters.length > 0 && (
              <div className="mb-4">
                <div className="flex flex-nowrap gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1 lg:flex-wrap lg:overflow-x-visible">
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedBrand('all') }}
                    className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                      !searchQuery && selectedBrand === 'all'
                        ? 'bg-gray-900 text-white shadow-sm'
                        : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    Все модели
                  </button>
                  {currentCategory.quickFilters.filter(qf => {
                    if (selectedBrand === 'android') {
                      return qf.brand && qf.brand !== 'apple'
                    }
                    return selectedBrand === 'all' || !qf.brand || qf.brand === selectedBrand
                  }).map((qf) => {
                    const isActive = searchQuery === qf.query && (!qf.brand || selectedBrand === qf.brand || (selectedBrand === 'android' && qf.brand !== 'apple'))
                    return (
                      <button
                        key={qf.label}
                        onClick={() => {
                          if (isActive) {
                            setSearchQuery('')
                            setSelectedBrand('all')
                          } else {
                            setSearchQuery(qf.query)
                            if (qf.brand) setSelectedBrand(qf.brand)
                            else setSelectedBrand('all')
                          }
                        }}
                        className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                          isActive
                            ? 'bg-gray-900 text-white shadow-sm'
                            : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {qf.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Toolbar: активные фильтры-теги + сортировка + вид — одной аккуратной строкой */}
            <div className="mb-6 rounded-xl bg-white p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Mobile filter button */}
                <button
                  onClick={() => setShowMobileFilters(true)}
                  className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white lg:hidden"
                >
                  <FilterIcon className="h-4 w-4" />
                  Фильтры
                  {activeFiltersCount > 0 && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-xs font-semibold text-gray-900">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                {/* Активные фильтры-теги (кликом — снять) */}
                {selectedCategory !== 'all' && (
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className="flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1.5 text-sm font-medium text-yellow-800 transition hover:bg-yellow-200"
                  >
                    {currentCategory?.name}
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                {selectedBrand !== 'all' && (
                  <button
                    onClick={() => setSelectedBrand('all')}
                    className="flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1.5 text-sm font-medium text-yellow-800 transition hover:bg-yellow-200"
                  >
                    {selectedBrand === 'android' ? 'Android' : displayBrands.find(b => b.id === selectedBrand)?.name || selectedBrand}
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                {inStockOnly && (
                  <button
                    onClick={() => setInStockOnly(false)}
                    className="flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1.5 text-sm font-medium text-yellow-800 transition hover:bg-yellow-200"
                  >
                    В наличии
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                {activeFiltersCount > 0 && (
                  <button
                    onClick={resetFilters}
                    className="text-sm font-medium text-gray-400 transition hover:text-gray-700"
                  >
                    Сбросить
                  </button>
                )}

                {/* Справа: сортировка + переключатель вида */}
                <div className="ml-auto flex items-center gap-3">
                  <div className="relative">
                    <button
                      onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300"
                    >
                      {sortOptions.find(o => o.value === sort)?.label}
                      <ChevronDownIcon className={`h-4 w-4 transition-transform ${sortDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {sortDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setSortDropdownOpen(false)} />
                        <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-gray-100 bg-white py-2 shadow-lg">
                          {sortOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setSort(option.value)
                                setSortDropdownOpen(false)
                              }}
                              className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                                sort === option.value
                                  ? 'bg-yellow-50 font-medium text-yellow-700'
                                  : 'text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* View toggle */}
                  <div className="hidden items-center gap-1 rounded-lg border border-gray-200 p-1 sm:flex">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`rounded-md p-2 transition-colors ${
                        viewMode === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <GridIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`rounded-md p-2 transition-colors ${
                        viewMode === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <ListIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Products Grid */}
            {isLoading ? (
              <div className={`grid ${
                viewMode === 'grid' 
                  ? 'grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-3' 
                  : 'grid-cols-1 gap-6'
              }`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredProducts.length > 0 ? (
              <>
                <div className={`grid ${
                  viewMode === 'grid'
                    ? 'grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-3'
                    : 'grid-cols-1 gap-6'
                }`}>
                  {visibleProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>

                {/* Бесконечная прокрутка: маяк + ручная кнопка (fallback) */}
                {hasMore && (
                  <div ref={loadMoreRef} className="mt-8 flex flex-col items-center gap-3">
                    <Button onClick={() => setVisibleCount(v => v + PAGE_SIZE)} variant="outline">
                      Показать ещё
                    </Button>
                    <span className="text-sm text-gray-400">
                      Показано {visibleProducts.length} из {filteredProducts.length}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
                <div className="mb-4 text-5xl">🔍</div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">Товары не найдены</h3>
                <p className="mb-6 text-gray-500">Попробуйте изменить параметры поиска или сбросить фильтры</p>
                <Button onClick={resetFilters} variant="outline">
                  Сбросить фильтры
                </Button>
              </div>
            )}
            
            {/* CTA */}
            <div className="mt-12 overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 p-8 text-center">
              <h2 className="mb-2 text-xl font-bold text-white">Не нашли нужный товар?</h2>
              <p className="mb-6 text-gray-400">Оставьте заявку и мы поможем подобрать то, что вам нужно</p>
              <Button href="https://t.me/takesmart_manager" size="lg">
                Написать менеджеру
              </Button>
            </div>
          </div>
        </div>
      </Container>
      
      {/* Mobile Filters Modal */}
      {showMobileFilters && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setShowMobileFilters(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-full max-w-sm overflow-y-auto bg-white p-6 lg:hidden">
            <FilterSidebar
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              selectedBrand={selectedBrand}
              setSelectedBrand={setSelectedBrand}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              inStockOnly={inStockOnly}
              setInStockOnly={setInStockOnly}
              onReset={resetFilters}
              isMobile
              onClose={() => setShowMobileFilters(false)}
              categoriesList={displayCategories}
              brandsList={displayBrands}
              categoryBrandsMap={categoryBrandsMap}
            />
          </div>
        </>
      )}
    </div>
  )
}
