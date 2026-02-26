import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { API_BASE_URL } from './config'

interface AuthContextType {
  token: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'takesmart_admin_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY)
  })

  const isAuthenticated = !!token

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      // Backend uses OAuth2 form-data at /admin/token
      const body = new URLSearchParams()
      body.append('username', username)
      body.append('password', password)

      const response = await fetch(`${API_BASE_URL}/admin/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      const newToken = data.access_token
      localStorage.setItem(TOKEN_KEY, newToken)
      setToken(newToken)
      return true
    } catch (error) {
      console.error('Login error:', error)
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  // Verify token on mount by calling any authenticated endpoint
  useEffect(() => {
    if (token) {
      // No dedicated verify endpoint — try fetching orders to check token validity
      fetch(`${API_BASE_URL}/api/orders?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (res.status === 401) {
            logout()
          }
        })
        // Do NOT logout on network errors — backend may just be slow
        .catch(() => {})
    }
  }, [token])

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
