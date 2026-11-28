export function cartItemKey(productId: string, variantId?: string): string {
  return variantId ? `${productId}:${variantId}` : productId
}
