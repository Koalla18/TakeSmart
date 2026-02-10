import { Link } from 'react-router-dom'
import type { Product } from '../data/products'
import { formatPrice, getBadgeText } from '../data/products'
import { Badge } from './ui/Layout'

interface ProductCardProps {
  product: Product
  variant?: 'default' | 'compact'
}

export function ProductCard({ product, variant = 'default' }: ProductCardProps) {
  const badgeVariant = product.badge === 'hit' ? 'yellow' : product.badge === 'sale' ? 'error' : 'success'
  
  return (
    <Link
      to={`/product/${product.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition-all duration-300 hover:border-yellow-300 hover:shadow-xl hover:shadow-yellow-100/50"
    >
      {/* Badge */}
      {product.badge && (
        <div className="absolute left-4 top-4 z-10">
          <Badge variant={badgeVariant} size="md">
            {getBadgeText(product.badge)}
          </Badge>
        </div>
      )}
      
      {/* Image */}
      <div className="relative flex aspect-square items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-6 transition-all duration-300 group-hover:from-yellow-50 group-hover:to-yellow-100/50">
        <span className="text-7xl transition-transform duration-300 group-hover:scale-110">
          {product.image}
        </span>
        
        {/* Quick buy overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/5 group-hover:opacity-100">
          <span className="translate-y-4 rounded-xl bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            Подробнее
          </span>
        </div>
        
        {/* Out of stock overlay */}
        {!product.inStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <span className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
              Нет в наличии
            </span>
          </div>
        )}
      </div>
      
      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        {/* Category */}
        <div className="mb-1 text-xs font-medium text-yellow-600">
          {product.category}
        </div>
        
        {/* Name */}
        <h3 className="mb-3 line-clamp-2 flex-1 text-sm font-semibold text-gray-900 transition-colors group-hover:text-yellow-600 sm:text-base">
          {product.name}
        </h3>
        
        {/* Price */}
        <div className="flex items-end gap-2">
          <span className="text-lg font-bold text-gray-900 sm:text-xl">
            {formatPrice(product.price)}
          </span>
          {product.oldPrice && (
            <span className="text-sm text-gray-400 line-through">
              {formatPrice(product.oldPrice)}
            </span>
          )}
        </div>
        
        {/* Buy button for larger cards */}
        {variant === 'default' && (
          <button
            className="mt-4 w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-yellow-500 hover:text-gray-900"
            onClick={(e) => {
              e.preventDefault()
              // Add to cart logic
            }}
          >
            Заказать
          </button>
        )}
      </div>
    </Link>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <div className="aspect-square bg-gray-100" />
      <div className="p-4">
        <div className="mb-2 h-3 w-16 rounded bg-gray-100" />
        <div className="mb-1 h-4 rounded bg-gray-100" />
        <div className="mb-3 h-4 w-2/3 rounded bg-gray-100" />
        <div className="h-6 w-24 rounded bg-gray-100" />
      </div>
    </div>
  )
}
