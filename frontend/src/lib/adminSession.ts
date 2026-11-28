import { API_BASE_URL } from './config'

export const TOKEN_KEY = 'takesmart_admin_token'
export const AUTH_CHANGED = 'takesmart-admin-session-changed'
let refreshInProgress: Promise<string | null> | undefined

export function storeToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  window.dispatchEvent(new Event(AUTH_CHANGED))
}

function refreshAccess(previous: string | null) {
  if (refreshInProgress) return refreshInProgress
  const renew = async () => {
    const current = localStorage.getItem(TOKEN_KEY)
    if (current !== previous || !current) return current
    const response = await fetch(`${API_BASE_URL}/api/v1/admin/refresh`, { method: 'POST', credentials: 'include' })
    if ([401, 404, 405, 422].includes(response.status)) return localStorage.getItem(TOKEN_KEY) === previous ? null : localStorage.getItem(TOKEN_KEY)
    if (!response.ok) throw new Error('Не удалось обновить сессию')
    const data: { access_token: string } = await response.json()
    if (localStorage.getItem(TOKEN_KEY) !== previous) return localStorage.getItem(TOKEN_KEY)
    storeToken(data.access_token)
    return data.access_token
  }
  refreshInProgress = (navigator.locks ? navigator.locks.request('takesmart-admin-refresh', renew) : renew())
    .then(value => value)
    .finally(() => { refreshInProgress = undefined })
  return refreshInProgress
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  if (response.status !== 401 || !token) return response
  const renewed = await refreshAccess(token)
  if (!renewed) return response
  headers.set('Authorization', `Bearer ${renewed}`)
  return fetch(url, { ...init, headers })
}
