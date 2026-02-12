import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Container } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import { products, categories, brands } from '../data/products'
import { 
  ChevronDownIcon, 
  FilterIcon, 
  CloseIcon, 
  GridIcon,
  ListIcon,
  SearchIcon 
} from '../components/ui/Icons'

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
}) {
  const minPrice = 0
  const maxPrice = 300000
  
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
            onClick={() => setSelectedCategory('all')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              selectedCategory === 'all'
                ? 'bg-yellow-50 font-medium text-yellow-700'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Все товары
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-yellow-50 font-medium text-yellow-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {cat.name}
            </button>
          ))}
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
          {brands.map((brand) => (
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
  
  // Filter states
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all')
  const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || 'all')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 300000])
  const [inStockOnly, setInStockOnly] = useState(false)
  const [sort, setSort] = useState<SortOption>('popular')
  const [searchQuery, setSearchQuery] = useState('')
  
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
    setSearchParams(params, { replace: true })
  }, [selectedCategory, selectedBrand, setSearchParams])
  
  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let result = [...products]
    
    // Category filter
    if (selectedCategory !== 'all') {
      result = result.filter(p => p.categorySlug === selectedCategory)
    }
    
    // Brand filter
    if (selectedBrand !== 'all') {
      result = result.filter(p => p.brand.toLowerCase() === selectedBrand)
    }
    
    // Price filter
    result = result.filter(p => p.price >= priceRange[0] && p.price <= priceRange[1])
    
    // Stock filter
    if (inStockOnly) {
      result = result.filter(p => p.inStock)
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.brand.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
      )
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
  }, [selectedCategory, selectedBrand, priceRange, inStockOnly, sort, searchQuery])
  
  const resetFilters = () => {
    setSelectedCategory('all')
    setSelectedBrand('all')
    setPriceRange([0, 300000])
    setInStockOnly(false)
    setSearchQuery('')
  }
  
  const currentCategory = categories.find(c => c.id === selectedCategory)
  const activeFiltersCount = [
    selectedCategory !== 'all',
    selectedBrand !== 'all',
    priceRange[0] > 0 || priceRange[1] < 300000,
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
            />
          </aside>
          
          {/* Main Content */}
          <div className="flex-1">
            {/* Toolbar */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-4">
              {/* Mobile filter button */}
              <button
                onClick={() => setShowMobileFilters(true)}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 lg:hidden"
              >
                <FilterIcon className="h-4 w-4" />
                Фильтры
                {activeFiltersCount > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-xs font-semibold text-gray-900">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
              
              {/* Sort */}
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
                    <div className="fixed inset-0 z-10" onClick={() => setSortDropdownOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-2 w-48 rounded-xl border border-gray-100 bg-white py-2 shadow-lg">
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
            
            {/* Active filters tags */}
            {activeFiltersCount > 0 && (
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500">Активные фильтры:</span>
                {selectedCategory !== 'all' && (
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className="flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-800"
                  >
                    {currentCategory?.name}
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                {selectedBrand !== 'all' && (
                  <button
                    onClick={() => setSelectedBrand('all')}
                    className="flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-800"
                  >
                    {brands.find(b => b.id === selectedBrand)?.name}
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                {inStockOnly && (
                  <button
                    onClick={() => setInStockOnly(false)}
                    className="flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-800"
                  >
                    В наличии
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                <button
                  onClick={resetFilters}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Сбросить все
                </button>
              </div>
            )}
            
            {/* Products Grid */}
            {isLoading ? (
              <div className={`grid gap-6 ${
                viewMode === 'grid' 
                  ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' 
                  : 'grid-cols-1'
              }`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredProducts.length > 0 ? (
              <div className={`grid gap-6 ${
                viewMode === 'grid' 
                  ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' 
                  : 'grid-cols-1'
              }`}>
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
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
              <Button to="/cart" size="lg">
                Оставить заявку
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
            />
          </div>
        </>
      )}
    </div>
  )
}
