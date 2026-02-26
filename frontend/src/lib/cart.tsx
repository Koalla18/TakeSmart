import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Product } from '../data/products'
import { mapApiProduct, type ApiProductOut } from '../data/products'
import { API_BASE_URL } from './config'

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

  // ─── Reconcile mock items with real API products ──────────────────────────
  // If cart was loaded from localStorage with mock numeric IDs, replace them
  // with real products fetched from API by slug. This happens transparently.
  useEffect(() => {
    const mockItems = items.filter(item => !UUID_REGEX.test(item.product.id))
    if (mockItems.length === 0) return

    Promise.allSettled(
      mockItems.map(async (cartItem) => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/products/slug/${cartItem.product.slug}`)
          if (!res.ok) return null
          const data: ApiProductOut = await res.json()
          const realProduct = mapApiProduct(data)
          return { oldId: cartItem.product.id, realProduct, quantity: cartItem.quantity }
        } catch {
          return null
        }
      })
    ).then(results => {
      const replacements = results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<{ oldId: string; realProduct: Product; quantity: number }>).value)

      if (replacements.length === 0) return

      setItems(current => {
        let updated = [...current]
        for (const { oldId, realProduct, quantity } of replacements) {
          updated = updated.map(item =>
            item.product.id === oldId
              ? { product: realProduct, quantity }
              : item
          )
        }
        // Deduplicate: if real product was already in cart, merge quantities
        const seen = new Map<string, CartItem>()
        for (const item of updated) {
          const existing = seen.get(item.product.id)
          if (existing) {
            seen.set(item.product.id, {
              ...existing,
              quantity: Math.min(existing.quantity + item.quantity, MAX_QUANTITY_PER_ITEM),
            })
          } else {
            seen.set(item.product.id, item)
          }
        }
        return Array.from(seen.values())
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  const addItem = (product: Product, quantity = 1): boolean => {
    // Проверка лимитов
    const existing = items.find(item => item.product.id === product.id)
    const currentTotal = items.reduce((sum, item) => sum + item.quantity, 0)
    
    if (existing) {
      const newQty = existing.quantity + quantity
      if (newQty > MAX_QUANTITY_PER_ITEM) return false
      if (currentTotal - existing.quantity + newQty > MAX_TOTAL_ITEMS) return false
    } else {
      if (quantity > MAX_QUANTITY_PER_ITEM) return false
      if (currentTotal + quantity > MAX_TOTAL_ITEMS) return false
      if (items.length >= MAX_POSITIONS) return false
    }
    
    setItems(current => {
      const exist = current.find(item => item.product.id === product.id)
      if (exist) {
        return current.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + quantity, MAX_QUANTITY_PER_ITEM) }
            : item
        )
      }
      return [...current, { product, quantity: Math.min(quantity, MAX_QUANTITY_PER_ITEM) }]
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
    if (quantity > MAX_QUANTITY_PER_ITEM) return false
    
    const currentItem = items.find(item => item.product.id === productId)
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
