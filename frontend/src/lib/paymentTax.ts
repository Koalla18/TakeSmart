export const DEFAULT_CARD_MARKUP_PERCENT = 16

export function paymentSurcharge(subtotal: number, percent = DEFAULT_CARD_MARKUP_PERCENT): number {
  return Math.round(subtotal * percent / 100)
}
