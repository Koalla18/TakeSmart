import { Link } from 'react-router-dom'
import { useState } from 'react'
import type { Product } from '../data/products'
import { formatPrice, getBadgeText } from '../data/products'
import { Badge } from './ui/Layout'
import { useCart } from '../lib/cart'

interface ProductCardProps {
  product: Product
  variant?: 'default' | 'compact' | 'featured'
}

export function ProductCard({ product, variant = 'default' }: ProductCardProps) {
  const { addItem, isInCart } = useCart()
  const [isAdding, setIsAdding] = useState(false)
  const [showAdded, setShowAdded] = useState(false)
  
  const inCart = isInCart(product.id)
  const badgeVariant = product.badge === 'hit' ? 'yellow' : product.badge === 'sale' ? 'error' : 'success'
  
  const discount = product.oldPrice 
    ? Math.round((1 - product.price / product.oldPrice) * 100)
    : 0

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!product.inStock) return
    
    setIsAdding(true)
    addItem(product, 1)
    
    setTimeout(() => {
      setIsAdding(false)
      setShowAdded(true)
      setTimeout(() => setShowAdded(false), 2000)
    }, 300)
  }

  // Featured variant - large hero card
  if (variant === 'featured') {
    return (
      <div className="group relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        {/* Glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-yellow-400/20 via-amber-400/20 to-yellow-400/20 blur-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        
        <div className="relative grid md:grid-cols-2 gap-8 p-8 md:p-12">
          {/* Content */}
          <div className="flex flex-col justify-center order-2 md:order-1">
            {product.badge && (
              <div className="mb-4">
                <span className="inline-flex items-center gap-2 rounded-full bg-yellow-400/10 border border-yellow-400/20 px-4 py-1.5 text-sm font-medium text-yellow-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  {getBadgeText(product.badge)}
                </span>
              </div>
            )}
            
            <h3 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight">
              {product.name}
            </h3>
            
            <p className="text-gray-400 mb-6 text-lg line-clamp-2">
              {product.description}
            </p>
            
            <div className="flex items-end gap-4 mb-8">
              <span className="text-4xl font-bold text-white">
                {formatPrice(product.price)}
              </span>
              {product.oldPrice && (
                <div className="flex flex-col">
                  <span className="text-lg text-gray-500 line-through">
                    {formatPrice(product.oldPrice)}
                  </span>
                  <span className="text-sm font-medium text-green-400">
                    Выгода {formatPrice(product.oldPrice - product.price)}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={handleAddToCart}
                disabled={!product.inStock || isAdding}
                className="flex-1 relative overflow-hidden rounded-2xl bg-yellow-400 py-4 px-8 text-lg font-semibold text-gray-900 transition-all duration-300 hover:bg-yellow-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-400/25"
              >
                <span className={`transition-all duration-300 ${isAdding ? 'opacity-0' : 'opacity-100'}`}>
                  {inCart ? '✓ В корзине' : 'В корзину'}
                </span>
                {isAdding && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </span>
                )}
              </button>
              <Link
                to={`/product/${product.id}`}
                className="rounded-2xl border-2 border-white/20 py-4 px-8 text-lg font-semibold text-white transition-all duration-300 hover:bg-white/10 hover:border-white/30"
              >
                Подробнее
              </Link>
            </div>
          </div>
          
          {/* Image */}
          <div className="relative flex items-center justify-center order-1 md:order-2">
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/10 to-transparent rounded-full blur-3xl" />
            <span className="text-[12rem] md:text-[16rem] transition-transform duration-700 group-hover:scale-110 group-hover:rotate-3">
              {product.image}
            </span>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="group relative">
      {/* Card */}
      <div className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 transition-all duration-500 hover:border-gray-200 hover:shadow-2xl hover:shadow-gray-200/50 hover:-translate-y-1">
        
        {/* Badges */}
        <div className="absolute left-4 top-4 z-20 flex flex-col gap-2">
          {product.badge && (
            <Badge variant={badgeVariant} size="md">
              {getBadgeText(product.badge)}
            </Badge>
          )}
          {discount > 0 && (
            <span className="inline-flex items-center rounded-lg bg-red-500 px-2 py-1 text-xs font-bold text-white">
              -{discount}%
            </span>
          )}
        </div>
        
        {/* Favorite button */}
        <button 
          className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm text-gray-400 opacity-0 transition-all duration-300 hover:bg-white hover:text-red-500 group-hover:opacity-100"
          onClick={(e) => e.preventDefault()}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </button>
        
        {/* Image area */}
        <Link to={`/product/${product.id}`} className="block">
          <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-gray-50 via-white to-gray-50">
            {/* Animated background */}
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-50/0 to-yellow-100/0 transition-all duration-500 group-hover:from-yellow-50 group-hover:to-yellow-100/50" />
            
            {/* Product image */}
            <div className="relative flex h-full items-center justify-center p-8">
              <span className="text-8xl transition-all duration-500 group-hover:scale-110 group-hover:-rotate-3">
                {product.image}
              </span>
            </div>
            
            {/* Quick view overlay */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center p-4 opacity-0 transition-all duration-300 group-hover:opacity-100">
              <span className="rounded-full bg-gray-900/90 backdrop-blur-sm px-6 py-2 text-sm font-medium text-white">
                Быстрый просмотр
              </span>
            </div>
            
            {/* Out of stock overlay */}
            {!product.inStock && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-sm">
                <span className="rounded-2xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white">
                  Нет в наличии
                </span>
              </div>
            )}
          </div>
        </Link>
        
        {/* Content */}
        <div className="p-5">
          {/* Brand & Category */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-yellow-600">
              {product.brand}
            </span>
            <span className="text-xs text-gray-400">
              {product.category}
            </span>
          </div>
          
          {/* Name */}
          <Link to={`/product/${product.id}`}>
            <h3 className="mb-3 line-clamp-2 text-base font-semibold text-gray-900 transition-colors hover:text-yellow-600">
              {product.name}
            </h3>
          </Link>
          
          {/* Price row */}
          <div className="mb-4 flex items-end justify-between">
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-gray-900">
                {formatPrice(product.price)}
              </span>
              {product.oldPrice && (
                <span className="text-sm text-gray-400 line-through mb-0.5">
                  {formatPrice(product.oldPrice)}
                </span>
              )}
            </div>
          </div>
          
          {/* Buttons */}
          <div className="space-y-2">
            <button
              onClick={handleAddToCart}
              disabled={!product.inStock || isAdding}
              className={`relative w-full overflow-hidden rounded-xl py-3 text-sm font-semibold transition-all duration-300 ${
                inCart || showAdded
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-900 text-white hover:bg-yellow-400 hover:text-gray-900'
              } disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]`}
            >
              <span className={`flex items-center justify-center gap-2 transition-all duration-300 ${isAdding ? 'opacity-0' : 'opacity-100'}`}>
                {inCart || showAdded ? (
                  <>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Добавлено
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    В корзину
                  </>
                )}
              </span>
              {isAdding && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </span>
              )}
            </button>
            
            {/* Buy in 1 click */}
            <button
              onClick={() => {
                addItem(product)
                window.location.href = '/cart?quick=true'
              }}
              disabled={!product.inStock}
              className="w-full rounded-xl border-2 border-yellow-400 py-2.5 text-sm font-semibold text-yellow-600 hover:bg-yellow-400 hover:text-gray-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Купить в 1 клик
              </span>
            </button>
          </div>
          
          {/* Features */}
          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Гарантия
            </span>
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Быстрая доставка
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-3xl border border-gray-100 bg-white">
      <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-50" />
      <div className="p-5">
        <div className="mb-2 flex justify-between">
          <div className="h-3 w-16 rounded bg-gray-100" />
          <div className="h-3 w-12 rounded bg-gray-100" />
        </div>
        <div className="mb-1 h-5 rounded bg-gray-100" />
        <div className="mb-4 h-5 w-2/3 rounded bg-gray-100" />
        <div className="mb-4 h-8 w-28 rounded bg-gray-100" />
        <div className="h-11 rounded-xl bg-gray-100" />
      </div>
    </div>
  )
}
