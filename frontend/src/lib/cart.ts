import { createContext, useContext } from 'react'
import type { Product } from '../data/products'

export interface CartItem {
  product: Product
  quantity: number
  variantId?: string
}

// ─── Ограничения корзины ─────────────────────────────────────────────────────
export const MAX_QUANTITY_PER_ITEM = 15
export const MAX_TOTAL_ITEMS = 15
export const MAX_POSITIONS = 20

interface CartContextType {
  items: CartItem[]
  addItem: (product: Product, quantity?: number, variantId?: string) => boolean
  removeItem: (key: string) => void
  refreshProducts: (products: Map<string, Product>) => void
  updateQuantity: (key: string, quantity: number) => boolean
  clearCart: () => void
  getItemCount: () => number
  getTotal: () => number
  isInCart: (productId: string) => boolean
}

export const CartContext = createContext<CartContextType | null>(null)

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within CartProvider')
  }
  return context
}
