import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchIcon, CloseIcon } from './ui/Icons'
import { API_BASE_URL } from '../lib/config'
import { formatPrice, type ApiProductOut } from '../data/products'

interface SearchProduct {
  id: string
  slug: string
  name: string
  brand: string
  model: string
  price: number
  oldPrice?: number
  image: string
  inStock: boolean
}

function mapSearchProduct(p: ApiProductOut): SearchProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand || '',
    model: p.model || '',
    price: Number(p.discount_price ?? p.price),
    oldPrice: p.discount_price != null ? Number(p.price) : undefined,
    image: p.main_image_url || '',
    inStock: p.stock_quantity > 0,
  }
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()\[\]{}.,/\\+\-_:;"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [products, setProducts] = useState<SearchProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cacheRef = useRef<SearchProduct[] | null>(null)

  // Fetch all products on first interaction (cached)
  const ensureProducts = useCallback(async () => {
    if (cacheRef.current) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/products?limit=2500&only_active=true`)
      if (res.ok) {
        const data = await res.json()
        const items: ApiProductOut[] = data.items ?? data
        cacheRef.current = items.map(mapSearchProduct)
        setProducts(cacheRef.current)
      }
    } catch {
      /* silently fail */
    } finally {
      setLoading(false)
    }
  }, [])

  // Smart token search
  const results = query.trim()
    ? (() => {
        const source = cacheRef.current || products
          const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean)
        return source
          .filter(p => {
              const hay = normalizeSearchText(`${p.name} ${p.brand} ${p.model} ${p.slug}`)
            return tokens.every(t => hay.includes(t))
          })
          .slice(0, 6)
      })()
    : []

  const showDropdown = isFocused && query.trim().length > 0

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleNavigate(slug: string) {
    setQuery('')
    setIsFocused(false)
    setHighlightedIndex(-1)
    navigate(`/product/${slug}`)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (highlightedIndex >= 0 && results[highlightedIndex]) {
      handleNavigate(results[highlightedIndex].slug)
    } else if (query.trim()) {
      setQuery('')
      setIsFocused(false)
      navigate(`/catalog?q=${encodeURIComponent(query.trim())}`)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsFocused(false)
      inputRef.current?.blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, -1))
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <form onSubmit={handleSubmit} className="relative">
        <div className={`flex items-center rounded-xl border bg-gray-50 transition-all duration-200 ${
          isFocused ? 'border-yellow-400 bg-white shadow-lg shadow-yellow-400/10 ring-2 ring-yellow-400/20' : 'border-gray-200 hover:border-gray-300'
        }`}>
          <SearchIcon className="ml-3 h-4 w-4 flex-shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlightedIndex(-1) }}
            onFocus={() => { setIsFocused(true); ensureProducts() }}
            onKeyDown={handleKeyDown}
            placeholder="Поиск товаров..."
            className="w-full bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="mr-2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>

      {/* Dropdown results */}
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/10">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
              <span className="ml-2 text-sm text-gray-400">Загрузка...</span>
            </div>
          ) : results.length > 0 ? (
            <div>
              <div className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-400">
                Товары
              </div>
              {results.map((product, i) => (
                <button
                  key={product.id}
                  onClick={() => handleNavigate(product.slug)}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === highlightedIndex ? 'bg-yellow-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt=""
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-300">
                        <SearchIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {product.name}
                    </div>
                    {product.brand && (
                      <div className="text-xs text-gray-400">{product.brand}</div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      {formatPrice(product.price)}
                    </div>
                    {product.oldPrice && (
                      <div className="text-xs text-gray-400 line-through">
                        {formatPrice(product.oldPrice)}
                      </div>
                    )}
                  </div>
                </button>
              ))}
              <button
                onClick={() => {
                  setIsFocused(false)
                  setQuery('')
                  navigate(`/catalog?q=${encodeURIComponent(query.trim())}`)
                }}
                className="flex w-full items-center justify-center gap-2 border-t border-gray-100 px-4 py-3 text-sm font-medium text-yellow-600 transition-colors hover:bg-yellow-50"
              >
                Показать все результаты
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <div className="mb-1 text-sm text-gray-500">Ничего не найдено</div>
              <div className="text-xs text-gray-400">Попробуйте изменить запрос</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Mobile search — fullscreen overlay */
export function MobileSearchButton() {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<SearchProduct[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cacheRef = useRef<SearchProduct[] | null>(null)

  async function ensureProducts() {
    if (cacheRef.current) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/products?limit=2500&only_active=true`)
      if (res.ok) {
        const data = await res.json()
        const items: ApiProductOut[] = data.items ?? data
        cacheRef.current = items.map(mapSearchProduct)
        setProducts(cacheRef.current)
      }
    } catch {
      /* silently fail */
    } finally {
      setLoading(false)
    }
  }

  function open() {
    setIsOpen(true)
    ensureProducts()
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function close() {
    setIsOpen(false)
    setQuery('')
  }

  const results = query.trim()
    ? (() => {
        const source = cacheRef.current || products
          const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean)
        return source
          .filter(p => {
              const hay = normalizeSearchText(`${p.name} ${p.brand} ${p.model} ${p.slug}`)
            return tokens.every(t => hay.includes(t))
          })
          .slice(0, 8)
      })()
    : []

  function handleNavigate(slug: string) {
    close()
    navigate(`/product/${slug}`)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      close()
      navigate(`/catalog?q=${encodeURIComponent(query.trim())}`)
    }
  }

  // Lock scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return (
    <>
      <button
        onClick={open}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 lg:hidden"
        aria-label="Поиск"
      >
        <SearchIcon className="h-5 w-5" />
      </button>

      {/* Fullscreen overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-white">
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
              <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-3">
                <SearchIcon className="h-5 w-5 flex-shrink-0 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Поиск товаров..."
                  className="flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
                />
              </form>
              <button
                onClick={close}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100"
              >
                Отмена
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
                </div>
              ) : query.trim() ? (
                results.length > 0 ? (
                  <div className="divide-y divide-gray-50">
                    {results.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => handleNavigate(product.slug)}
                        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors active:bg-gray-50"
                      >
                        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
                          {product.image ? (
                            <img src={product.image} alt="" className="h-full w-full object-contain p-1" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-gray-300">
                              <SearchIcon className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900">{product.name}</div>
                          {product.brand && <div className="text-xs text-gray-400">{product.brand}</div>}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <div className="text-sm font-bold text-gray-900">{formatPrice(product.price)}</div>
                          {product.oldPrice && (
                            <div className="text-xs text-gray-400 line-through">{formatPrice(product.oldPrice)}</div>
                          )}
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => { close(); navigate(`/catalog?q=${encodeURIComponent(query.trim())}`) }}
                      className="flex w-full items-center justify-center gap-2 px-4 py-4 text-sm font-medium text-yellow-600"
                    >
                      Показать все результаты в каталоге
                    </button>
                  </div>
                ) : (
                  <div className="px-4 py-12 text-center">
                    <div className="mb-1 text-sm text-gray-500">Ничего не найдено</div>
                    <div className="text-xs text-gray-400">Попробуйте изменить запрос</div>
                  </div>
                )
              ) : (
                <div className="px-4 py-12 text-center text-sm text-gray-400">
                  Начните вводить название товара
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
