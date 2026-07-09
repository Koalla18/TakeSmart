import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Product } from '../data/products'
import { ymEcommerceAdd, ymReachGoal } from './metrika'

export interface CartItem {
  product: Product
  quantity: number
}

// ─── Ограничения корзины ─────────────────────────────────────────────────────
export const MAX_QUANTITY_PER_ITEM = 15
export const MAX_TOTAL_ITEMS = 15
export const MAX_POSITIONS = 20

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CartContextType {
  items: CartItem[]
  addItem: (product: Product, quantity?: number) => boolean // false если превышен лимит
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => boolean // false если превышен лимит
  clearCart: () => void
  getItemCount: () => number
  getTotal: () => number
  isInCart: (productId: string) => boolean
}

const CartContext = createContext<CartContextType | null>(null)

const CART_STORAGE_KEY = 'takesmart_cart'

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    // Load from localStorage on init
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
  }, [items])

  // ─── Purge stale mock items (non-UUID IDs from old builds) ────────────────
  useEffect(() => {
    const hasStale = items.some(item => !UUID_REGEX.test(item.product.id))
    if (hasStale) {
      setItems(current => current.filter(item => UUID_REGEX.test(item.product.id)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  const addItem = (product: Product, quantity = 1): boolean => {
    // Проверка лимитов
    const existing = items.find(item => item.product.id === product.id)
    const currentTotal = items.reduce((sum, item) => sum + item.quantity, 0)
    
    // Лимит на основе остатка на складе
    const stockLimit = product.stockQuantity != null ? product.stockQuantity : MAX_QUANTITY_PER_ITEM
    const effectiveMax = Math.min(MAX_QUANTITY_PER_ITEM, stockLimit)

    if (existing) {
      const newQty = existing.quantity + quantity
      if (newQty > effectiveMax) return false
      if (currentTotal - existing.quantity + newQty > MAX_TOTAL_ITEMS) return false
    } else {
      if (quantity > effectiveMax) return false
      if (currentTotal + quantity > MAX_TOTAL_ITEMS) return false
      if (items.length >= MAX_POSITIONS) return false
    }
    
    setItems(current => {
      const exist = current.find(item => item.product.id === product.id)
      if (exist) {
        return current.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + quantity, effectiveMax) }
            : item
        )
      }
      return [...current, { product, quantity: Math.min(quantity, effectiveMax) }]
    })

    // Аналитика: добавление в корзину (цель + e-commerce)
    ymReachGoal('add_to_cart', { id: product.id, name: product.name, price: product.price })
    ymEcommerceAdd({
      id: product.id,
      name: product.name,
      price: product.price,
      brand: product.brand || undefined,
      category: product.category || undefined,
      quantity,
    })

    return true
  }

  const removeItem = (productId: string) => {
    setItems(current => current.filter(item => item.product.id !== productId))
  }

  const updateQuantity = (productId: string, quantity: number): boolean => {
    if (quantity <= 0) {
      removeItem(productId)
      return true
    }
    
    // Проверка лимитов
    const currentItem = items.find(item => item.product.id === productId)
    const stockLimit = currentItem?.product.stockQuantity != null ? currentItem.product.stockQuantity : MAX_QUANTITY_PER_ITEM
    const effectiveMax = Math.min(MAX_QUANTITY_PER_ITEM, stockLimit)
    if (quantity > effectiveMax) return false
    
    const currentTotal = items.reduce((sum, item) => sum + item.quantity, 0)
    const diff = quantity - (currentItem?.quantity || 0)
    if (currentTotal + diff > MAX_TOTAL_ITEMS) return false
    
    setItems(current =>
      current.map(item =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    )
    return true
  }

  const clearCart = () => {
    setItems([])
  }

  const getItemCount = () => {
    return items.reduce((sum, item) => sum + item.quantity, 0)
  }

  const getTotal = () => {
    return items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  }

  const isInCart = (productId: string) => {
    return items.some(item => item.product.id === productId)
  }

  return (
    <CartContext.Provider value={{
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      getItemCount,
      getTotal,
      isInCart
    }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within CartProvider')
  }
  return context
}
