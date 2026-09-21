// ─────────────────────────────────────────────────────────────────────────────
// Налог при безналичной оплате (карта и QR). Считается «от начисленного»:
// чтобы после налога осталась цена товара, сверху добавляется не R, а R/(1−R).
// Пример при 15%: цена 100 000 ₽ → к оплате 117 647 ₽, налог 17 647 ₽ (≈ +17,6%).
// МЕНЯТЬ СТАВКУ ЗДЕСЬ — корзина и страница «Доставка и оплата» пересчитаются сами.
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_TAX_RATE = 0.15

/** «15» — для подписей вида «налог 15%» */
export const PAYMENT_TAX_PCT = Math.round(PAYMENT_TAX_RATE * 100)

/** Налог сверх цены: gross = net / (1 − ставка); возвращает разницу в рублях */
export function taxSurcharge(net: number, taxRate: number = PAYMENT_TAX_RATE): number {
  if (taxRate <= 0 || net <= 0) return 0
  return Math.round(net / (1 - taxRate)) - net
}

/** Эффективная надбавка к ценнику: 15% → «17,6» */
export function effectivePercent(taxRate: number = PAYMENT_TAX_RATE): string {
  return ((taxRate / (1 - taxRate)) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}
