import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react'
import { API_BASE_URL } from './config'
import { authFetch, storeToken, TOKEN_KEY, AUTH_CHANGED } from './adminSession'

interface AuthContextType {
  token: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY)
  })

  const isAuthenticated = !!token

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      // Backend uses OAuth2 form-data at /api/v1/admin/token
      const body = new URLSearchParams()
      body.append('username', username)
      body.append('password', password)

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      const newToken = data.access_token
      storeToken(newToken)
      return true
    } catch (error) {
      console.error('Login error:', error)
      return false
    }
  }

  const logout = useCallback(() => {
    storeToken(null)
    const revoke = () => fetch(`${API_BASE_URL}/api/v1/admin/logout`, { method: 'POST', credentials: 'include' })
    void (navigator.locks ? navigator.locks.request('takesmart-admin-refresh', revoke) : revoke()).catch(() => {})
  }, [])

  useEffect(() => {
    const sync = () => setToken(localStorage.getItem(TOKEN_KEY))
    window.addEventListener(AUTH_CHANGED, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(AUTH_CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Проверяем сохранённую сессию при запуске.
  useEffect(() => {
    if (token) {
      authFetch(`${API_BASE_URL}/api/v1/admin/me`)
        .then((res) => {
          if (res.status === 401 && localStorage.getItem(TOKEN_KEY) === token) {
            logout()
          }
        })
        // Do NOT logout on network errors — backend may just be slow
        .catch(() => {})
    }
  }, [logout, token])

  return (
    <AuthContext.Provider value={{ token, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper for authenticated API calls
export function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}
