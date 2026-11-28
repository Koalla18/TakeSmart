export type AdminLayoutMode = 'dock' | 'sidebar'
const LAYOUT_KEY = 'takesmart_admin_layout'

export function readLayoutMode(): AdminLayoutMode {
  try { return localStorage.getItem(LAYOUT_KEY) === 'sidebar' ? 'sidebar' : 'dock' } catch { return 'dock' }
}
export function storeLayoutMode(mode: AdminLayoutMode): void {
  try { localStorage.setItem(LAYOUT_KEY, mode) } catch { /* приватный режим — просто не запомним */ }
}
