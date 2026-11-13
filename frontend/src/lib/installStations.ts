import { useEffect, useMemo, useState } from 'react'
import { getAuthHeaders } from './auth'
import { API_BASE_URL } from './config'

// Помощник на Mac (public/station/takesmart_station.py) для PWA «TakeSmart — Заказы»:
// общие типы, запросы к /api/installs и опрос помощников на связи.

const STATIONS_POLL_MS = 3000

export interface Device { udid: string | null; model: string | null; ios_version: string | null; name: string | null; paired: boolean | null }
export interface Purchase { bundle_id: string; name: string; id: number | string | null; version: string | null; icon?: string | null; genre?: string | null; removed?: boolean | null }
export interface SessionApp { bundle_id: string; name: string; status: string; version: string | null; error: string | null; progress?: string | null }
export interface HelperConsole {
  login?: { status: 'idle' | 'working' | 'need_code' | 'ok' | 'error'; message: string | null; pending?: boolean }
  session?: { id: string | null; apps: SessionApp[]; status: string; started: string; finished?: boolean } | null
  installed?: Record<string, { name: string; version: string; owner?: string | null }>
  purchases_loading?: boolean
  tools_missing?: string[]
  notice?: { t: number; message: string; tone: string } | null
}
export interface Station {
  id: string; name: string; version: string | null; last_seen_at: string | null; online: boolean
  state: { device?: Device | null; apple?: { logged_in?: boolean; email?: string | null; name?: string | null } | null }
}
export interface ConsoleData { station: Station; console: HelperConsole; purchases: Purchase[] | null; purchases_version: number }
export type CommandType = 'login' | 'code' | 'resend_code' | 'reset_login' | 'logout' | 'refresh_purchases' | 'install' | 'cancel' | 'dismiss_session'

export const api = (path: string, init?: RequestInit) =>
  fetch(`${API_BASE_URL}/api/installs${path}`, { ...init, headers: { ...getAuthHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } })

export async function errorText(res: Response): Promise<string> {
  try { const d = await res.json(); return typeof d.detail === 'string' ? d.detail : `Ошибка ${res.status}` } catch { return `Ошибка ${res.status}` }
}

// ── Помощники на связи: опрос живёт всегда, чтобы вкладка открылась сама при подключении iPhone ──
export function useStations(): { stations: Station[] | null; connectedUdid: string | null } {
  const [stations, setStations] = useState<Station[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (document.hidden) return
      try { const r = await api('/stations'); if (r.ok && alive) setStations(await r.json()) } catch { /* сеть */ }
    }
    load()
    const t = window.setInterval(load, STATIONS_POLL_MS)
    return () => { alive = false; window.clearInterval(t) }
  }, [])
  const connectedUdid = useMemo(() => (stations || []).find(s => s.online && s.state?.device?.udid)?.state.device?.udid || null, [stations])
  return { stations, connectedUdid }
}
