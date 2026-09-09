// Код модели в конце названия: «… серебристый (Silver) (MDE54)» → MDE54.
// Единое правило с бэком (core/model_code.py и data-миграция v2w3x4y5z6a7): последняя
// скобочная группа из латиницы, цифр, дефиса и слэша длиной 3–12 символов, минимум одна
// цифра и хотя бы буква или дефис. «(2024)» (год) и «(Silver)» (цвет) кодом не считаются,
// «(492747-01)» (номер Dyson) — считается.
const CODE_TAIL = /\s*\(([A-Z0-9][A-Z0-9/-]{2,11})\)\s*$/

export function modelCodeFromName(name: string): string | null {
  const m = name.trimEnd().match(CODE_TAIL)
  if (!m) return null
  const code = m[1]
  return /\d/.test(code) && /[A-Z-]/.test(code) ? code : null
}

/** Название без кода в конце (если код там есть) */
export function stripModelCode(name: string): string {
  return modelCodeFromName(name) ? name.trimEnd().replace(CODE_TAIL, '').trimEnd() : name.trim()
}

/** Название с кодом в конце по правилу мастера групп: «база (КОД)»; без кода — просто база */
export function withModelCode(name: string, code: string | null): string {
  const base = stripModelCode(name)
  return code ? `${base} (${code})` : base
}

/** Ввод кода: латиница, цифры, дефис и слэш в верхнем регистре, до 20 символов */
export function normalizeModelCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9/-]/g, '').slice(0, 20)
}
